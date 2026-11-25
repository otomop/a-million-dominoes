"""Physics test of the reversed INHIBIT gadget."""

import json
import math
import sys

import numpy as np

from dominoes.gadgets import *

from . import phys

rng = np.random.default_rng(17)
NT = int(sys.argv[1]) if len(sys.argv) > 1 else 10
q = int(sys.argv[2]) if len(sys.argv) > 2 else 4


def build(side):
    cv = Canvas()
    g = rinh(cv, 600.0, 0.0, side=side, q=q, tag="inh")
    ms, is_ = g["main_start"], g["inh_start"]
    x0 = 200.0
    ml = cv.path([(x0, ms[1]), (ms[0], ms[1])], start_gap=0, end_exact=True)
    il = cv.path([(x0, is_[1]), (is_[0], is_[1])], start_gap=0, end_exact=True)
    ee = g["exit_end"]
    out = cv.straight(ee[0] + PITCH, ee[1], 6, tag="out")
    return cv, g, ml, il, out


scenes, meta = [], []
for side in [+1, -1]:
    for case, sks in [("M", [0]), ("I", [0]), ("MI", [-300, 0, 150, 300, 450])]:
        for sk in sks:
            for tr in range(NT):
                cv, g, ml, il, outl = build(side)
                pushes = []
                if "M" in case:
                    pushes.append(dict(i=ml[0], t=0.3, dir=1))
                if "I" in case:
                    pushes.append(dict(i=il[0], t=0.3 + sk / 1000, dir=1))
                ds = phys.noisy(cv.d, rng) if tr > 0 else cv.d
                scenes.append(dict(dominoes=ds, statics=[], pushes=pushes, params=dict(T=2.6)))
                meta.append(
                    dict(side=side, case=case, sk=sk, out=outl[-1], ml=ml, il=il, Sq=g["Sq"], S1=g["S1"], seg=g["seg"])
                )
out = phys.run_parallel(scenes, nproc=22)
json.dump(dict(meta=meta, out=out), open(f"physics/tmp/p7_rinh_q{q}.json", "w"))
from collections import defaultdict

agg = defaultdict(lambda: [0, 0, []])
for m, r in zip(meta, out):
    ft = np.array(r["fallT"])
    fired = ft[m["out"]] >= 0
    back = (any(ft[i] >= 0 for i in m["ml"]) and "M" not in m["case"]) or (
        any(ft[i] >= 0 for i in m["il"]) and "I" not in m["case"]
    )
    note = ("fired" if fired else "blocked") + (" BACKFLOW" if back else "")
    if m["case"] == "M":
        ok = fired and not back
        note += f" t_out={ft[m['out']]:.3f} t_Sq={ft[m['Sq']]:.3f} t_S1={ft[m['S1']]:.3f}"
    elif m["case"] == "I":
        ok = (not fired) and not back
        note += f" t_Sq={ft[m['Sq']]:.3f} t_S1={ft[m['S1']]:.3f}"
    else:
        ok = None
    k = (m["side"], m["case"], m["sk"])
    agg[k][0] += (1 if ok else 0) if ok is not None else (0 if fired else 1)
    agg[k][1] += 1
    agg[k][2].append(note)
for k in sorted(agg, key=str):
    lab = "correct" if k[1] != "MI" else "blocked"
    print(k, f"{agg[k][0]}/{agg[k][1]} {lab}", agg[k][2][:2])
