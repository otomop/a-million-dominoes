"""Compile a trained network into the machine, check it, and write the files the page loads.

python -m dominoes.build --net models/final.npz --out ../web/public --report ../docs/validation.json
"""

import argparse
import json
import math
import os
import time
from collections import Counter

import numpy as np

from .export import TICK, golden_case, write_machine
from .machine import Machine
from .synth import tree_stats
from .validate import overlaps


def meta(M, counts):
    P, cv = M.P, M.cv

    def pos(i):
        return [round(float(M.x[i]), 1), round(float(M.y[i]), 1)]

    lanes, arms = [], []
    for c in range(10):
        a = M.arms[c]
        panel = {k: (int(v) if k in ("first", "count") else round(float(v), 1)) for k, v in M.panels[c].items()}
        lanes.append(
            dict(
                digit=c,
                start=int(a["starter"]),
                finish=int(M.core["ins"][c]),
                finishBias=int(M.finish_bias[c]),
                marks=[int(s["out"]) for s in a["secs"]] + [int(a["lane_end"]), int(M.core["ins"][c])],
                win=int(M.wins[c]),
                panel=panel,
            )
        )
        phi = M.phis[c]
        er = np.array([math.cos(phi), math.sin(phi)])
        et = np.array([-er[1], er[0]])
        label = (M.R + a["vmax"] + 6000.0) * er - (a["umin"] / 2) * et
        arms.append(
            dict(
                digit=c,
                angle=round(phi, 6),
                inner=pos(a["lane_end"]),
                outer=pos(a["start"]),
                label=[round(float(label[0]), 1), round(float(label[1]), 1)],
                width=round(-a["umin"], 1),
                length=round(a["vmax"], 1),
            )
        )

    def box(ranges, pad=300.0):
        idx = np.concatenate([np.arange(a, b) for a, b in ranges])
        x0, x1 = M.x[idx].min() - pad, M.x[idx].max() + pad
        y0, y1 = M.y[idx].min() - pad, M.y[idx].max() + pad
        return dict(
            cx=round(float(x0 + x1) / 2, 1),
            cy=round(float(y0 + y1) / 2, 1),
            w=round(float(x1 - x0), 1),
            h=round(float(y1 - y0), 1),
            yaw=0.0,
        )

    arena = box([(M.core["n0"], M.core["n1"])] + M.gate_ranges)
    stage = box([(p["first"], p["first"] + p["count"]) for p in M.panels])
    cat = M.B.cat
    north = int(np.argmin(np.abs(np.array(M.phis) - math.pi / 2)))
    arm = M.arms[north]

    def first(pred, r):
        for i in range(arm["n0"] + (arm["n1"] - arm["n0"]) // 3, arm["n1"]):
            if pred(i):
                return dict(x=pos(i)[0], y=pos(i)[1], r=r)
        return None

    vote = pos(arm["secs"][len(arm["secs"]) // 2]["sq"])
    tour = [
        ("Starter dominoes", first(lambda i: cat[i] == "input", 900.0)),
        ("A blocking gate", first(lambda i: cat[i] == "gate" and cv.d[i]["tag"] == "seg", 600.0)),
        ("An OR merge", first(lambda i: cat[i] == "gate" and cv.d[i]["tag"] == "", 500.0)),
        ("A bridge", first(lambda i: cat[i] == "crossover" and M.z0[i] > 40, 700.0)),
        ("A split", first(lambda i: cat[i] == "split", 500.0)),
        ("A vote on the race lane", dict(x=vote[0], y=vote[1], r=1500.0)),
        ("The finish", dict(x=arena["cx"], y=arena["cy"], r=round(max(arena["w"], arena["h"]) * 0.6, 1))),
        ("The answer panels", dict(x=stage["cx"], y=stage["cy"], r=round(stage["w"] * 0.55, 1))),
    ]
    z = M.z
    return dict(
        layout="pinwheel",
        model=dict(
            grid=8,
            thresholds=[float(t) for t in z["thr"]],
            bits=int(z["Xte"].shape[1]),
            bitOrder="bit = t*64 + row*8 + col; 1 if count > thresholds[t]",
            centre="bbox-floor",
            layers=[int(w) for w in z["widths"]],
        ),
        lanes=lanes,
        arms=arms,
        arena=arena,
        stage=stage,
        tour=[dict(name=n, **t) for n, t in tour if t],
        hub=dict(radius=round(M.R, 1)),
        bounds=dict(minX=float(M.x.min()), maxX=float(M.x.max()), minY=float(M.y.min()), maxY=float(M.y.max())),
        timing=dict(
            delta_s=round(M.tt["long"] - M.tt["short"], 4),
            eps_s=P.eps,
            selfLead_s=P.eps / 2,
            allShort_s=round(float(M.T0), 3),
        ),
        counts=counts,
    )


def compile_machine(net, verbose=True):
    """Build, time and rebuild.  Returns the machine with its hit graph."""
    M = Machine(net)
    M.build(verbose=verbose)
    M.graph()
    starts, boxes, _, _ = M.corrections()
    M.build(starts, boxes, verbose=verbose)
    M.graph()
    tC, lead = M.calibrate()
    off = tC - M.P.eps * np.arange(10)
    M.T0 = off.max()
    M.cal = dict(lane_spread_s=float(off.max() - off.min()), self_lead_s=[round(float(v), 4) for v in lead])
    if M.cal["lane_spread_s"] > 0.06 or np.abs(lead + M.P.eps / 2).max() > 0.03:
        raise RuntimeError(f"timing did not converge: {M.cal}")
    return M


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--net", required=True)
    ap.add_argument("--out", default=None)
    ap.add_argument("--report", default=None)
    ap.add_argument("--limit", type=int, default=None, help="validate only the first N test digits")
    ap.add_argument("--jitter-runs", type=int, default=2)
    ap.add_argument("--golden", type=int, default=16)
    a = ap.parse_args()
    t0 = time.time()
    M = compile_machine(a.net)
    lead = np.array(M.cal["self_lead_s"])
    print(f"calibration: lane spread {M.cal['lane_spread_s']:.3f} s, self lead {lead.min():.3f} to {lead.max():.3f} s")
    nov, ex = overlaps(M.x, M.y, M.yaw, M.z0)
    print("overlapping dominoes:", nov)
    if nov:
        raise RuntimeError(f"overlaps: {ex}")
    z = M.z
    X, pred, y = z["Xte"], z["pred"], z["yte"]
    val = {}
    r = M.validate(X, pred, limit=a.limit)
    val["nominal"] = r
    print(
        f"nominal: {r['agree']}/{r['n']} match the network; none {r['none']}, several {r['multi']}; "
        f"last fall {r['last_s']:.0f} s"
    )
    for k in range(a.jitter_runs):
        r = M.validate(X, pred, jitter=0.1, seed=k + 1, limit=a.limit)
        val[f"jitter{k + 1}"] = r
        print(f"timing noise of 10 percent, run {k + 1}: {r['agree']}/{r['n']}; none {r['none']}, several {r['multi']}")
    n = len(M.x)
    counts = dict(
        dominoes=n,
        edges=int(len(M.G["dst"])),
        starters=len(M.B.pushers),
        byKind=dict(Counter(M.B.cat)),
        gates=dict(M.B.stats),
        tree=tree_stats(M.F, M.roots),
    )
    acc = float((pred == y).mean())
    print(f"dominoes {n} | network accuracy on held-out writers {acc:.4f} | {time.time() - t0:.0f} s")
    if a.out:
        hdr = meta(M, counts)
        statics = np.array(
            [[s["cx"], s["cy"], s["cz"], s["hx"], s["hy"], s["hz"], s.get("yaw", 0.0)] for s in M.cv.statics]
        )
        always = [(i, 0) for i in M.always]
        path = os.path.join(a.out, "machine.bin.gz")
        raw = write_machine(path, M.x, M.y, M.yaw, M.z0, M.Gq, M.arm_of, M.kind, M.B.pushers, always, statics, hdr)
        print(f"machine.bin.gz: {raw / 1e6:.1f} MB raw, {os.path.getsize(path) / 1e3:.0f} kB compressed")
        cases = []
        for d in range(a.golden):
            case, ft, _ = golden_case(M.Gq, M.B.pushers, always, X[d], hdr["lanes"], y[d])
            won = [c for c in range(10) if ft[M.wins[c]] >= 0]
            case["winner"] = won[0] if len(won) == 1 else None
            case["network"] = int(pred[d])
            cases.append(case)
        with open(os.path.join(a.out, "golden.json"), "w") as f:
            json.dump(dict(tick_s=TICK, cases=cases), f)
    if a.report:
        rep = dict(
            net=os.path.basename(a.net),
            accuracy_heldout=acc,
            counts=counts,
            calibration=M.cal,
            validation=val,
            hub_radius_m=M.R / 1000,
            field_m=[float(M.x.max() - M.x.min()) / 1000, float(M.y.max() - M.y.min()) / 1000],
            timing=dict(delta_s=M.tt["long"] - M.tt["short"], eps_s=M.P.eps, all_short_s=float(M.T0)),
        )
        with open(a.report, "w") as f:
            json.dump(rep, f, indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o))
    return M


if __name__ == "__main__":
    main()
