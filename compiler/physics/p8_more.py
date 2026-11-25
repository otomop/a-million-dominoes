"""More rigid-body trials: split, merge, bridge (100 noisy each) and the full lane section."""

import json
import math

import numpy as np

from dominoes.gadgets import *
from dominoes.lane import section_template
from dominoes.machine import Params

from . import phys

rng = np.random.default_rng(23)
NT = 100
scenes, meta = [], []


def emit(cv, pushes, info, T=2.5):
    scenes.append(dict(dominoes=phys.noisy(cv.d, rng), statics=cv.statics, pushes=pushes, params=dict(T=T)))
    meta.append(info)


for tr in range(NT):
    cv = Canvas()
    inp = cv.straight(0, 0, 8)
    ia, ib, xe = split(cv, PITCH * 7, 0, ROW, 0)
    a2 = cv.straight(xe + PITCH, ROW, 6)
    b2 = cv.straight(xe + PITCH, 0, 6)
    emit(cv, [dict(i=inp[0], t=0, dir=1)], dict(g="split", ok=lambda ft, a=a2[-1], b=b2[-1]: ft[a] >= 0 and ft[b] >= 0))
for case in ["A", "B", "AB"]:
    for tr in range(NT):
        cv = Canvas()
        a = cv.straight(0, ROW, 8)
        b = cv.straight(0, 0, 8)
        ia, ib, J = merge(cv, PITCH * 7, ROW, 0, 0)
        out = cv.straight(cv.d[J]["x"] + PITCH, 0, 6)
        sk = rng.uniform(-0.1, 0.1)
        p = []
        if "A" in case:
            p.append(dict(i=a[0], t=0.15, dir=1))
        if "B" in case:
            p.append(dict(i=b[0], t=0.15 + sk, dir=1))
        other = b if case == "A" else (a if case == "B" else [])
        emit(
            cv,
            p,
            dict(g="merge_" + case, ok=lambda ft, o=out[-1], oth=other: ft[o] >= 0 and all(ft[i] < 0 for i in oth)),
        )
for case in ["A", "B", "AB"]:
    for tr in range(NT):
        cv = Canvas()
        a = cv.straight(0, 0, 6)
        b = cv.straight(0, ROW, 6)
        A, B, xe = bridge_swap(cv, PITCH * 5, 0, ROW)
        a2 = cv.straight(xe + PITCH, ROW, 5)
        b2 = cv.straight(xe + PITCH, 0, 5)
        sk = rng.uniform(-0.3, 0.3)
        p = []
        if "A" in case:
            p.append(dict(i=a[0], t=0.35, dir=1))
        if "B" in case:
            p.append(dict(i=b[0], t=0.35 + sk, dir=1))
        ea, eb = ("A" in case), ("B" in case)
        emit(
            cv,
            p,
            dict(
                g="bridge_" + case,
                ok=lambda ft, oa=a2[-1], ob=b2[-1], ea=ea, eb=eb: (ft[oa] >= 0) == ea and (ft[ob] >= 0) == eb,
            ),
            T=3.0,
        )
# lane section: gate=1 (no inhibitor) -> short; gate=0 (inhibitor early) -> long; both must reach lane_out
P = Params()
T = section_template(P.n_bumps, hb_rows=P.hb_rows)  # the machine's own vote section
for case in ["short", "long"]:
    for tr in range(NT):
        cv = Canvas()
        cv.d = [dict(d) for d in T["cv"].d]
        cv.statics = []
        p = [dict(i=T["lane_in"], t=(2.0 if case == "long" else 0.0), dir=1)]
        if case == "long":
            p.append(dict(i=T["root_entry"], t=0.0, dir=1))
        emit(
            cv,
            p,
            dict(
                g="lane_" + case,
                ok=lambda ft, o=T["lane_out"]: ft[o] >= 0,
                out=T["lane_out"],
                t0=(2.0 if case == "long" else 0.0),
            ),
            T=15.0,
        )
print("scenes", len(scenes), flush=True)
out = phys.run_parallel(scenes, nproc=20)
from collections import defaultdict

agg = defaultdict(lambda: [0, 0, []])
for m, r in zip(meta, out):
    ft = np.array(r["fallT"])
    ok = bool(m["ok"](ft))
    agg[m["g"]][0] += ok
    agg[m["g"]][1] += 1
    if "out" in m and ft[m["out"]] >= 0:
        agg[m["g"]][2].append(ft[m["out"]] - m["t0"])
for k, v in agg.items():
    extra = f" lane time mean {np.mean(v[2]):.2f}s sd {np.std(v[2]):.3f}" if v[2] else ""
    print(k, f"{v[0]}/{v[1]}", extra)
json.dump({k: v[:2] for k, v in agg.items()}, open("physics/tmp/p8_more.json", "w"))
