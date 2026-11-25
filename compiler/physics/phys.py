"""Python side of the rigid-body tests: build scenes, add noise, run Rapier."""

import json, subprocess, os, tempfile, math
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
H, W, T = 48.0, 24.0, 7.5


def run(scenes, params=None):
    if params:
        for s in scenes:
            s["params"] = {**params, **s.get("params", {})}
    fd, fin = tempfile.mkstemp(suffix=".json", dir=os.path.join(HERE, "tmp"))
    os.close(fd)
    fout = fin.replace(".json", "_out.json")
    with open(fin, "w") as f:
        json.dump(scenes, f)
    subprocess.run(["node", os.path.join(HERE, "phys.js"), fin, fout], check=True)
    with open(fout) as f:
        res = json.load(f)
    os.remove(fin)
    os.remove(fout)
    return res


def run_parallel(scenes, params=None, nproc=16):
    """Split scenes across node processes."""
    from concurrent.futures import ThreadPoolExecutor

    chunks = [scenes[i::nproc] for i in range(nproc)]
    with ThreadPoolExecutor(nproc) as ex:
        outs = list(ex.map(lambda c: run(c, params) if c else [], chunks))
    res = [None] * len(scenes)
    for k, c in enumerate(chunks):
        for j, r in enumerate(outs[k]):
            res[k + j * nproc] = r
    return res


def noisy(dominoes, rng, pos_sd=0.02 * H, yaw_sd_deg=2.0):
    out = []
    for d in dominoes:
        e = dict(d)
        e["x"] = d["x"] + rng.normal(0, pos_sd)
        e["y"] = d["y"] + rng.normal(0, pos_sd)
        e["yaw"] = d["yaw"] + math.radians(rng.normal(0, yaw_sd_deg))
        out.append(e)
    return out


def chain(p0, p1, pitch, start_offset=0.0, z0=0.0, include_end=True):
    """Dominoes from p0 towards p1 at the given pitch, facing p1."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    L = np.linalg.norm(p1 - p0)
    u = (p1 - p0) / L
    yaw = math.atan2(u[1], u[0])
    n = int(math.floor((L - start_offset) / pitch + 1e-9)) + (1 if include_end else 0)
    return [
        dict(
            x=float(p0[0] + u[0] * (start_offset + k * pitch)),
            y=float(p0[1] + u[1] * (start_offset + k * pitch)),
            yaw=yaw,
            z0=z0,
        )
        for k in range(n)
    ]


def arc(center, r, a0, a1, pitch, z0=0.0, ccw=True):
    """Dominoes along a circular arc, facing along the direction of travel."""
    L = abs(a1 - a0) * r
    n = max(1, int(round(L / pitch)))
    out = []
    for k in range(n + 1):
        a = a0 + (a1 - a0) * k / n
        x, y = center[0] + r * math.cos(a), center[1] + r * math.sin(a)
        yaw = a + (math.pi / 2 if a1 > a0 else -math.pi / 2)
        out.append(dict(x=x, y=y, yaw=yaw, z0=z0))
    return out
