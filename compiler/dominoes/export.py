"""Write a compiled machine to the binary format the web page loads.

One file, ``machine.bin.gz``: gzip of

    bytes 0..3   b"AMD1"
    bytes 4..7   uint32 LE, length of the JSON header (padded so the blob is 8-aligned)
    header       UTF-8 JSON
    blob         typed-array sections, each 8-byte aligned; offsets are relative to the blob

All times are integers in ticks of 0.1 ms.  The hit graph is stored, not
recomputed in the browser, so the page runs exactly the automaton that the
Python validation ran.  See docs/format.md.
"""

import gzip
import json
import struct

import numpy as np

from . import eventsim as ev

TICK = 1e-4  # seconds per tick
XY_UNIT = 1 / 32  # mm per position unit
Z_UNIT = 15.5  # mm per height unit (one stair step)

KINDS = [
    "wire",
    "input",
    "split",
    "crossover",
    "gate",
    "inh-feed",
    "lane",
    "lane-start",
    "feeder",
    "arena",
    "panel-off",
    "panel-on",
    "panel-feed",
]
KIND_OF_CAT = {
    "wire": 0,
    "align": 0,
    "input": 1,
    "split": 2,
    "crossover": 3,
    "gate": 4,
    "inh-feed": 5,
    "readout": 6,
    "lane": 6,
    "lane-start": 7,
    "feeder": 8,
    "arena": 9,
    "panel-off": 10,
    "panel-on": 11,
    "panel-feed": 12,
}


def quantise_graph(G):
    """Return a copy of the hit graph whose delays are whole ticks (as float64)."""
    q = np.maximum(1, np.rint(G["dly"] / TICK)).astype(np.int64)
    if q.max() > 65535:
        raise ValueError("delay does not fit in uint16 ticks")
    H = dict(G)
    H["dly"] = q.astype(np.float64)
    return H


def simulate_ticks(Gq, pushes):
    """Run the automaton on a tick-quantised graph.  pushes: (index, dir, tick).
    Returns (fall tick per domino or -1, fall direction per domino)."""
    return ev.simulate(Gq, pushes)


def bits_to_hex(bits):
    b = np.packbits(np.asarray(bits, bool).astype(np.uint8), bitorder="little")
    return b.tobytes().hex()


def write_machine(path, x, y, yaw, z0, Gq, arm, kind, pushers, always, statics, meta):
    """x, y, z0 in mm; yaw in radians; Gq from quantise_graph.
    pushers: list of (domino, bit, value).  always: list of (domino, tick).
    statics: array (S, 7) of cx, cy, cz, hx, hy, hz, yaw (mm, radians)."""
    N = len(x)
    xi = np.rint(np.asarray(x) / XY_UNIT).astype(np.int64)
    yi = np.rint(np.asarray(y) / XY_UNIT).astype(np.int64)
    zi = np.rint(np.asarray(z0) / Z_UNIT)
    if np.abs(zi * Z_UNIT - z0).max() > 1e-6:
        raise ValueError("base heights are not multiples of the stair step")
    yawi = np.rint(np.mod(np.asarray(yaw) + np.pi, 2 * np.pi) / np.pi * 32768 - 32768).astype(np.int64)
    yawi = np.clip(yawi, -32768, 32767)
    indptr, dst = Gq["indptr"], Gq["dst"]
    deg = np.diff(indptr)
    if deg.max() > 255:
        raise ValueError("out-degree does not fit in uint8")
    src = np.repeat(np.arange(2 * N) // 2, deg)
    sec = {
        "dx": np.diff(xi, prepend=0).astype("<i4"),
        "dy": np.diff(yi, prepend=0).astype("<i4"),
        "yaw": yawi.astype("<i2"),
        "z": zi.astype("u1"),
        "arm": np.asarray(arm).astype("u1"),
        "kind": np.asarray(kind).astype("u1"),
        "deg": deg.astype("u1"),
        "edst": (dst - src).astype("<i4"),
        "edly": Gq["dly"].astype("<u2"),
        "edir": Gq["ddir"].astype("i1"),
        "pushIdx": np.array([p[0] for p in pushers], "<u4"),
        "pushBit": np.array([p[1] for p in pushers], "u1"),
        "pushVal": np.array([p[2] for p in pushers], "u1"),
        "alwaysIdx": np.array([a[0] for a in always], "<u4"),
        "alwaysTick": np.array([a[1] for a in always], "<i4"),
        "statics": np.asarray(statics, "<f4").reshape(-1),
    }
    blob = bytearray()
    table = {}
    for name, a in sec.items():
        while len(blob) % 8:
            blob.append(0)
        table[name] = dict(dtype=a.dtype.name, offset=len(blob), count=int(a.size))
        blob += a.tobytes()
    header = dict(meta)
    header.update(
        version=1,
        count=int(N),
        edges=int(len(dst)),
        units=dict(xy_mm=XY_UNIT, z_mm=Z_UNIT, yaw="radians = value * pi / 32768", tick_s=TICK),
        domino=dict(h=ev.H, w=ev.W, t=ev.T),
        kinds=KINDS,
        sections=table,
    )
    hj = json.dumps(header, separators=(",", ":")).encode()
    hj += b" " * ((-(8 + len(hj))) % 8)
    raw = b"AMD1" + struct.pack("<I", len(hj)) + hj + bytes(blob)
    with gzip.GzipFile(path, "wb", compresslevel=9, mtime=0) as f:
        f.write(raw)
    return len(raw)


def golden_case(Gq, pushers, always, bits, lanes, label=None):
    """Reference result for one input, used by the web tests."""
    pushes = [(i, 1, 0.0) for (i, b, v) in pushers if bool(bits[b]) == bool(v)]
    pushes += [(i, 1, float(t)) for (i, t) in always]
    ft, fd = simulate_ticks(Gq, pushes)
    fallen = ft >= 0
    fin = [int(ft[ln["finish"]]) for ln in lanes]
    rng = np.random.default_rng(int(fallen.sum()))
    probe = rng.choice(len(ft), 24, replace=False)
    return (
        dict(
            bits=bits_to_hex(bits),
            label=None if label is None else int(label),
            fallen=int(fallen.sum()),
            sumTicks=int(ft[fallen].sum()),
            sumDir=int(fd.sum()),
            finish=fin,
            probe=[[int(i), int(ft[i]), int(fd[i])] for i in probe],
        ),
        ft,
        fd,
    )


def read_machine(path):
    """Read a machine file back.  Returns (header, arrays) with positions in mm,
    yaw in radians and the hit graph in the same form the simulator takes."""
    raw = gzip.open(path, "rb").read()
    if raw[:4] != b"AMD1":
        raise ValueError("not a machine file")
    hlen = struct.unpack("<I", raw[4:8])[0]
    hdr = json.loads(raw[8 : 8 + hlen])
    blob = memoryview(raw)[8 + hlen :]
    a = {}
    for name, sct in hdr["sections"].items():
        dt = np.dtype(sct["dtype"]).newbyteorder("<")
        a[name] = np.frombuffer(blob, dt, sct["count"], sct["offset"])
    N = hdr["count"]
    out = dict(
        x=np.cumsum(a["dx"].astype(np.int64)) * hdr["units"]["xy_mm"],
        y=np.cumsum(a["dy"].astype(np.int64)) * hdr["units"]["xy_mm"],
        yaw=a["yaw"] * (np.pi / 32768),
        z0=a["z"] * hdr["units"]["z_mm"],
        arm=a["arm"],
        kind=a["kind"],
        statics=a["statics"].reshape(-1, 7),
        pushers=list(zip(a["pushIdx"].tolist(), a["pushBit"].tolist(), a["pushVal"].tolist())),
        always=list(zip(a["alwaysIdx"].tolist(), a["alwaysTick"].tolist())),
    )
    indptr = np.concatenate([[0], np.cumsum(a["deg"].astype(np.int64))])
    src = np.repeat(np.arange(2 * N) // 2, a["deg"])
    out["G"] = dict(
        N=N,
        indptr=indptr,
        dst=(a["edst"].astype(np.int64) + src),
        ddir=a["edir"].astype(np.int64),
        dly=a["edly"].astype(np.float64),
    )
    return hdr, out
