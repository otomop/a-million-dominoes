"""Rigid-body check of the finish gate's timing window.

At the finish, every lane's claim meets a blocker fired by the first lane home.
The winner's claim is timed to reach the gate 0.25 s before its own blocker and
must pass; a lane that lost by 0.5 s meets a blocker 0.25 s ahead of it and must
be stopped; a lane that lost by 0.69 s or more meets one at least 0.44 s ahead.

`lead` is how long before the claim the blocker reaches the collision domino.
"""

import json
import sys

import numpy as np

from dominoes.gadgets import PITCH, Canvas, rinh

from . import phys

NATURAL_LEAD = 0.446  # blocker's lead when both lines are tipped together (q = 4)


def build():
    cv = Canvas()
    g = rinh(cv, 600.0, 0.0, side=+1, q=4, tag="inh")
    ms, is_ = g["main_start"], g["inh_start"]
    ml = cv.path([(200.0, ms[1]), (ms[0], ms[1])], start_gap=0, end_exact=True)
    il = cv.path([(200.0, is_[1]), (is_[0], is_[1])], start_gap=0, end_exact=True)
    ee = g["exit_end"]
    out = cv.straight(ee[0] + PITCH, ee[1], 6, tag="out")
    return cv, ml, il, out


def main(trials=100):
    rng = np.random.default_rng(29)
    leads = [0.44, 0.25, 0.10, -0.10, -0.25, -0.40, -0.60]
    scenes, meta = [], []
    for lead in leads:
        for _ in range(trials):
            cv, ml, il, out = build()
            late = NATURAL_LEAD - lead
            pushes = [dict(i=ml[0], t=0.3, dir=1), dict(i=il[0], t=0.3 + late, dir=1)]
            scenes.append(dict(dominoes=phys.noisy(cv.d, rng), statics=[], pushes=pushes, params=dict(T=3.2)))
            meta.append((lead, out[-1]))
    res = phys.run_parallel(scenes, nproc=20)
    table = {}
    for (lead, o), r in zip(meta, res):
        passed = r["fallT"][o] >= 0
        k = table.setdefault(lead, [0, 0])
        k[0] += int(passed)
        k[1] += 1
    for lead in leads:
        p, n = table[lead]
        print(f"blocker lead {lead:+.2f} s: claim passed {p}/{n}, blocked {n - p}/{n}")
    json.dump({str(k): v for k, v in table.items()}, open(sys.argv[1], "w") if len(sys.argv) > 1 else sys.stdout)


if __name__ == "__main__":
    main()
