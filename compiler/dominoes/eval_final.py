"""Evaluate a trained network against the pass marks.

    ..\\.venv\\Scripts\\python.exe -m dominoes.eval_final models/final.npz [more.npz ...]

Prints, for each network:
  * optdigits.tes through the canonical bits (overall, per class)
  * MNIST test digits through image_to_counts (first 5,000; grey > 32)
  * pendigits-orig test strokes through strokes_to_counts
  * the hand-written stroke shapes at three sizes and two pad positions
  * tree_stats of the unrolled forest
and once: determinism of strokes_to_counts and the fixture file, if present.
"""

import json
import os
import sys

import numpy as np

from . import fastprep as F
from . import preprocess as P
from . import synth
from .sample_strokes import SHAPES, place
from .train import eval_ops, group_scores
from .train_final import MNIST_GREY, PREP, Norm, load_counts, mnist_counts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def scores(z, X):
    h = np.asarray(X).astype(bool)
    for l in range(len(z["widths"])):
        h = eval_ops(z[f"op{l}"], h[:, z[f"ia{l}"]], h[:, z[f"ib{l}"]])
    return group_scores(h)


def predict(z, X):
    return scores(z, X).argmax(1)


def report(name, pred, y):
    per = [float((pred[y == c] == c).mean()) for c in range(10)]
    print(
        f"  {name}: {(pred == y).mean() * 100:.2f}% ({int((pred == y).sum())}/{len(y)})  "
        f"per class {' '.join(f'{c}:{p * 100:.1f}' for c, p in enumerate(per))}  min {min(per) * 100:.1f}"
    )
    return float((pred == y).mean()), per


SIZES = (40.0, 137.0, 300.0)
POSITIONS = ((12.0, 9.0), (171.3, 96.7))


def stroke_sanity(z, thr, verbose=True):
    changes = wrong = total = 0
    for label, name, strokes in SHAPES:
        preds = []
        for size in SIZES:
            for ox, oy in POSITIONS:
                bits = P.counts_to_bits(P.strokes_to_counts(place(strokes, size, ox, oy)), thr)
                preds.append(int(predict(z, bits[None])[0]))
        total += 1
        changes += int(len(set(preds)) > 1)
        wrong += int(preds[0] != label)
        if verbose and (len(set(preds)) > 1 or preds[0] != label):
            print(f"    {name}: label {label}, predictions {preds}")
    print(
        f"  hand-written shapes: {total} shapes x {len(SIZES)} sizes x {len(POSITIONS)} positions; "
        f"shapes whose prediction changes with size or position: {changes}; "
        f"shapes read correctly (first rendering): {total - wrong}/{total}"
    )
    return changes, total - wrong, total


def tree_stats(path):
    z, conn, ops = synth.load(path)
    Fo = synth.Forest(conn, ops)
    L = len(conn)
    roots = [Fo.lit(L - 1, j) for j in range(len(ops[-1]))]
    st = synth.tree_stats(Fo, roots)
    kinds = [k[0] for k in Fo.kind]
    return st, kinds.count("and"), kinds.count("xor"), sum(Fo.const(r) is not None for r in roots)


def determinism():
    """strokes_to_counts twice on real pen strokes and on the shapes; then the fixture file."""
    z = np.load(os.path.join(PREP, "pendigits_orig.npz"))
    pts, sptr, dptr, y = F.pen_strokes(z, "tes")
    bad = n = 0
    for d in range(0, len(y), 7):
        s = F.digit_strokes(pts, sptr, dptr, d)
        a = P.strokes_to_counts(s)
        b = P.strokes_to_counts([list(reversed(list(reversed(st)))) for st in s])
        bad += int((a != b).any())
        n += 1
    for label, name, strokes in SHAPES:
        s = place(strokes, 137.0, 12.0, 9.0)
        bad += int((P.strokes_to_counts(s) != P.strokes_to_counts(s)).any())
        n += 1
    print(f"determinism: {n} drawings rendered twice, differing: {bad}")
    fx = os.path.join(ROOT, "fixtures", "preprocess_cases.json")
    if os.path.exists(fx):
        with open(fx) as f:
            J = json.load(f)
        bad = 0
        for c in J["cases"]:
            counts = P.strokes_to_counts(c["strokes"])
            bits = P.counts_to_bits(counts, J["thresholds"])
            bad += int(counts.reshape(-1).tolist() != c["counts"] or P.bits_to_hex(bits) != c["bits"])
        extra = J.get("countsCases", [])
        for c in extra:
            bits = P.counts_to_bits(np.array(c["counts"]).reshape(8, 8), J["thresholds"])
            bad += int(P.bits_to_hex(bits) != c["bits"])
        print(
            f"fixtures: {len(J['cases'])} stroke cases and {len(extra)} counts cases recomputed in this "
            f"process, differing: {bad}"
        )


def main(paths):
    norm = Norm()
    cte, yte = load_counts("optdigits.tes")
    m = np.load(os.path.join(PREP, "mnist.npz"))
    mc = mnist_counts(norm, m["test_img"])
    mc127 = F.counts_batch(norm.bitmaps(m["test_img"] > 127))
    my = m["test_y"]
    pz = np.load(os.path.join(PREP, "pendigits_orig.npz"))
    pts, sptr, dptr, py = F.pen_strokes(pz, "tes")
    pc = F.counts_batch(norm.strokes(pts, sptr, dptr, np.arange(len(py))))
    for path in paths:
        z = np.load(path)
        thr = [int(t) for t in z["thr"]]
        print(f"{path}: widths {z['widths'].tolist()} ({int(z['widths'].sum())} gates), thresholds {thr}")
        Xte = np.stack([P.counts_to_bits(c, thr) for c in cte])
        same = bool((Xte == z["Xte"].astype(np.uint8)).all() and (z["yte"] == yte).all())
        pred = predict(z, Xte)
        same = same and bool((pred == z["pred"]).all())
        report("optdigits.tes (canonical bits)", pred, yte)
        print(f"    stored Xte/yte/pred equal the reference computation: {same}")
        report(f"MNIST test, first 5,000, grey > {MNIST_GREY}", predict(z, F.bits_batch(mc[:5000], thr)), my[:5000])
        report(f"MNIST test, all 10,000, grey > {MNIST_GREY}", predict(z, F.bits_batch(mc, thr)), my)
        report("MNIST test, first 5,000, grey > 127", predict(z, F.bits_batch(mc127[:5000], thr)), my[:5000])
        report("pendigits-orig test strokes", predict(z, F.bits_batch(pc, thr)), py)
        stroke_sanity(z, thr)
        st, n_and, n_xor, n_const = tree_stats(path)
        print(
            f"  tree_stats: {st}  and_inst + xor_inst = {st['and_inst'] + st['xor_inst']}  "
            f"(shared nodes: and {n_and}, xor {n_xor}; constant outputs {n_const})"
        )
    determinism()


if __name__ == "__main__":
    main(sys.argv[1:] or [os.path.join(ROOT, "models", "final.npz")])
