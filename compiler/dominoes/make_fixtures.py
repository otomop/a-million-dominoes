"""Write the preprocessing fixtures and the example digits for the page.

    ..\\.venv\\Scripts\\python.exe -m dominoes.make_fixtures [models/final.npz [other.npz ...]]

fixtures/preprocess_cases.json
    {"thresholds": [...], "constants": {...}, "cases": [{name, strokes, counts, bits, image}, ...]}
    40 cases.  ``strokes`` is a list of polylines of [x, y]; ``counts`` the 64 ink
    counts, row-major, as returned by preprocess.strokes_to_counts; ``bits`` the 192
    input bits (after centring and thresholding) packed little-endian (bit i is bit
    i & 7 of byte i >> 3) in hex; ``image`` the 32x32 normalised image, one string
    per row ('#' = ink), only as a debugging aid for ports.
    "countsCases": [{name, counts, bits}, ...] are extra grids that are not centred
    (strokes always give a nearly centred grid), to test counts -> bits on its own.

../web/public/examples.json
    30 entries {label, counts}: three digits per class from optdigits.tes that every
    network given on the command line reads correctly (largest winning margin first).
"""

import json
import os
import sys

import numpy as np

from . import preprocess as P
from .eval_final import scores
from .sample_strokes import SHAPES, place
from .train_final import load_counts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAD = 280.0  # nominal drawing pad, only used to build edge cases


def densify(rng, strokes, step, jitter):
    """Split every segment into pieces about ``step`` long and move the points a little,
    like a hand-held pointer.  Generation only; the stored coordinates are what counts."""
    out = []
    for st in strokes:
        q = [st[0]]
        for k in range(len(st) - 1):
            (x0, y0), (x1, y1) = st[k], st[k + 1]
            n = max(1, int(np.hypot(x1 - x0, y1 - y0) / step))
            for i in range(1, n + 1):
                t = i / n
                q.append(
                    (
                        x0 + t * (x1 - x0) + float(rng.normal(0, jitter)),
                        y0 + t * (y1 - y0) + float(rng.normal(0, jitter)),
                    )
                )
        out.append(q)
    return out


def build_cases():
    rng = np.random.default_rng(20261124)
    cases = []
    sizes = [38.0, 61.5, 90.0, 133.3, 170.0, 211.25, 256.0]
    for k, (label, name, strokes) in enumerate(SHAPES):
        if name == "four-u":
            continue
        size = sizes[k % len(sizes)]
        ox = round(float(rng.uniform(0, PAD - size * 100 / 150)), 2 if k % 3 else 0)
        oy = round(float(rng.uniform(0, PAD - size)), 2 if k % 3 else 0)
        s = place(strokes, size, ox, oy)
        if k % 2:
            s = densify(rng, s, size / 14.0, size / 150.0)
        cases.append(
            (f"digit {label} ({name}), {size:g} tall at ({ox:g}, {oy:g})" + (", jittered" if k % 2 else ""), s)
        )
    seven = SHAPES[16][2]
    three = SHAPES[7][2]
    six = SHAPES[14][2]
    eight = SHAPES[18][2]
    five = SHAPES[12][2]
    zero = SHAPES[0][2]
    four = SHAPES[9][2]
    two = SHAPES[5][2]
    cases += [
        ("one single-point stroke", [[(140.5, 96.25)]]),
        ("two single-point strokes, one above the other", [[(100.0, 50.0)], [(100.0, 150.0)]]),
        # two drawings whose 8x8 grid is moved one cell by the centring step (floor rule)
        (
            "narrow cross: centring moves the grid one cell left",
            [[(61.9, 10.0), (61.9, 250.0)], [(20.0, 55.9), (73.3, 54.1)]],
        ),
        (
            "flat cross: centring moves the grid one cell up",
            [[(10.0, 44.5), (250.0, 44.5)], [(64.2, 30.0), (66.0, 62.7)]],
        ),
        (
            "dot-sized scribble (0.4 pad units)",
            [[(200.0, 200.0), (200.2, 200.1), (200.1, 200.4), (200.3, 200.3), (200.05, 200.15)]],
        ),
        ("digit 7 one millionth of a pad unit tall", place(seven, 1e-6, 0.5, 0.5)),
        (
            "very wide drawing: flat zigzag",
            [[(4.0, 140.0), (60.0, 143.0), (120.0, 138.5), (180.0, 144.0), (240.0, 139.0), (276.0, 142.0)]],
        ),
        ("exactly horizontal line", [[(10.0, 140.0), (270.0, 140.0)]]),
        (
            "very tall drawing: thin wobble",
            [[(140.0, 2.0), (142.5, 70.0), (139.0, 140.0), (143.0, 210.0), (141.0, 278.0)]],
        ),
        ("exactly vertical line", [[(33.0, 12.0), (33.0, 268.0)]]),
        (
            "digit 0 touching all four pad edges",
            [[((x - 8.0) * PAD / 84.0, (y - 5.0) * PAD / 141.0) for x, y in zero[0]]],
        ),
        (
            "digit 4 with points on the pad corners",
            [[(PAD, 0.0), (0.0, 190.0), (PAD, 190.0)], [(210.0, 95.0), (210.0, PAD)], [(0.0, 0.0)], [(PAD, PAD)]],
        ),
        ("digit 5 plus a single-point stroke", place(five, 120.0, 30.0, 40.0) + [[(150.0, 44.0)]]),
        ("digit 8 with repeated points", [[p for p in place(eight, 150.0, 60.0, 60.0)[0] for _ in (0, 1)]]),
        ("digit 2 with an empty stroke in the list", [[]] + place(two, 99.0, 17.0, 23.0)),
        ("no strokes", []),
        ("digit 3 at large coordinates", place(three, 180.0, 1000000.25, 2000000.5)),
        ("digit 6 at negative coordinates", place(six, 75.0, -400.5, -310.125)),
        ("diagonal line steeper than the slant limit removes", [[(0.0, 0.0), (200.0, 100.0)]]),
    ]
    return cases


def centring_cases(thr):
    """Grids that are not centred, to test the centring step on its own (counts -> bits)."""
    rng = np.random.default_rng(7)
    base = [P.strokes_to_counts(place(SHAPES[k][2], 150.0, 0.0, 0.0)) for k in (0, 4, 9, 16, 20)]
    out = []
    moves = [(0, 1), (0, -1), (1, 0), (-1, 0), (2, -2), (-3, 1), (0, 3), (1, 2), (0, 0), (-1, -1), (3, 0), (0, -3)]
    for k, (dy, dx) in enumerate(moves):
        c = base[k % len(base)]
        g = np.zeros((8, 8), dtype=np.int64)
        for i in range(8):
            for j in range(8):
                if 0 <= i - dy < 8 and 0 <= j - dx < 8:
                    g[i, j] = c[i - dy, j - dx]
        if k % 3 == 2:  # drop a row or column so that the ink span has odd length
            g[int(rng.integers(0, 8)), :] = 0
            g[:, 0] = 0
        out.append(
            dict(
                name=f"grid moved by ({dy}, {dx})" + (", one row and the first column cleared" if k % 3 == 2 else ""),
                counts=[int(v) for v in g.reshape(-1)],
                bits=P.bits_to_hex(P.counts_to_bits(g, thr)),
            )
        )
    out.append(
        dict(name="empty grid", counts=[0] * 64, bits=P.bits_to_hex(P.counts_to_bits(np.zeros((8, 8), int), thr)))
    )
    one = np.zeros((8, 8), dtype=np.int64)
    one[7, 0] = 16
    out.append(
        dict(
            name="one full cell in the bottom-left corner",
            counts=[int(v) for v in one.reshape(-1)],
            bits=P.bits_to_hex(P.counts_to_bits(one, thr)),
        )
    )
    return out


def write_fixtures(thr):
    cases = build_cases()
    assert len(cases) == 40
    out = []
    for name, strokes in cases:
        strokes = [[[float(x), float(y)] for x, y in st] for st in strokes]
        img = P.strokes_to_image(strokes)
        counts = P.strokes_to_counts(strokes)
        assert (P.block_counts(img) == counts).all()
        bits = P.counts_to_bits(counts, thr)
        out.append(
            dict(
                name=name,
                strokes=strokes,
                counts=[int(v) for v in counts.reshape(-1)],
                bits=P.bits_to_hex(bits),
                image=["".join("#" if v else "." for v in row) for row in img],
            )
        )
    os.makedirs(os.path.join(ROOT, "fixtures"), exist_ok=True)
    path = os.path.join(ROOT, "fixtures", "preprocess_cases.json")
    doc = dict(
        thresholds=[int(t) for t in thr],
        constants=dict(
            size=P.SIZE,
            grid=P.GRID,
            boxW=P.BOX_W,
            boxH=P.BOX_H,
            penR=P.PEN_R,
            maxAniso=P.MAX_ANISO,
            maxSlant=P.MAX_SLANT,
        ),
        bitOrder="bit = t*64 + row*8 + col; 1 if centred count > thresholds[t]; hex is little-endian packed",
        cases=out,
        countsCases=centring_cases(thr),
    )
    with open(path, "w", newline="\n") as f:
        json.dump(doc, f, separators=(",", ":"))
        f.write("\n")
    print("wrote", path, len(out), "cases;", sum(1 for c in out if sum(c["counts"]) == 0), "with no ink")
    return out


def write_examples(paths):
    cte, yte = load_counts("optdigits.tes")
    margin = np.full(len(yte), 10**9)
    ok = np.ones(len(yte), bool)
    for path in paths:
        z = np.load(path)
        thr = [int(t) for t in z["thr"]]
        X = np.stack([P.counts_to_bits(c, thr) for c in cte])
        sc = scores(z, X).astype(int)
        pred = sc.argmax(1)
        ok &= pred == yte
        own = sc[np.arange(len(yte)), yte]
        other = sc.copy()
        other[np.arange(len(yte)), yte] = -1
        margin = np.minimum(margin, own - other.max(1))
    ex = []
    for c in range(10):
        idx = np.nonzero(ok & (yte == c))[0]
        idx = idx[np.argsort(-margin[idx], kind="stable")][:3]
        assert len(idx) == 3
        for i in idx:
            ex.append(dict(label=int(c), counts=[int(v) for v in cte[i].reshape(-1)]))
    path = os.path.join(os.path.dirname(ROOT), "web", "public", "examples.json")
    with open(path, "w", newline="\n") as f:
        json.dump(ex, f, separators=(",", ":"))
        f.write("\n")
    print(
        "wrote",
        path,
        len(ex),
        "examples; smallest winning margin",
        int(min(margin[ok])),
        "among all correct,",
        "chosen margins >=",
        int(min(margin[[i for i in range(len(yte)) if any(e["counts"] == cte[i].reshape(-1).tolist() for e in ex)]])),
    )


if __name__ == "__main__":
    paths = sys.argv[1:] or [os.path.join(ROOT, "models", "final.npz")]
    z = np.load(paths[0])
    write_fixtures([int(t) for t in z["thr"]])
    write_examples(paths)
