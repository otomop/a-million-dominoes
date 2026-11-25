r"""Train the final gate network on digits pushed through the canonical normalisation.

Run from the ``compiler`` folder (after ``python -I dominoes\prepare_data.py``):

    ..\.venv\Scripts\python.exe -m dominoes.train_final --out models/final.npz

The defaults are the recipe of ``models/final.npz``: five layers 2000, 2000, 2000,
1000, 500 (50 output gates per class), thresholds 1, 6, 11, 40 epochs, seed 0.

Budget.  The domino count depends on the number of gate instances after the
network is unrolled into trees (synth.tree_stats: and_inst + xor_inst) and on the
500 output gates, not on the hidden widths.  Wide hidden layers are therefore
free; what has to be paid for is every gate that ends up as a real two-input
operation.  The loss carries a small price per such gate (GateNet.lam), and
``--target-inst`` steers that price during training so that the unrolled
instance count ends near the target (2,300).

Training data (all through dominoes.preprocess, via the batch code in fastprep):
  opt    UCI optdigits.tra, three views of the same 3,823 digits:
           raw    the 8x8 counts as distributed
           frame  the original 32x32 bitmaps, small rotation/shear/scale/thickness
                  changes, refitted to full height (the frame optdigits uses)
           canon  the original bitmaps, augmented, through image_to_counts
  pen    UCI pendigits-orig training strokes (tablet pen trajectories) through
         strokes_to_counts, with rotation/scale/pen-width changes
  mnist  MNIST training images, binarised at a random grey level (stroke width),
         through image_to_counts

``--val 1`` holds out part of every training source for model selection and
never touches a test set.  ``--val 0`` (the default) trains on everything and
writes the network; test numbers come from ``python -m dominoes.eval_final``.

Model selection used ``--val 1`` only (760 optdigits.tra digits, 1,500 pendigits
training digits, the last 5,000 MNIST training images).  Mean validation accuracy
over the three sets, one seed unless noted, 20 epochs unless noted:
  normalisation   500,500,500, slant removal on / off             0.917 / 0.900 (2 seeds)
  free price      500,500,500 (1,500 inst)                         0.92
                  2000,1000,500 (1,826 inst)                       0.941
                  1000,1000,1000,500 (2,830 inst)                  0.951
                  2000,2000,1000,500 (3,511 inst)                  0.964
  price 1e-5      1000,1000,1000,500 (1,291 inst)                  0.953
                  2000,2000,1000,500 (1,170 inst)                  0.954
                  2000,2000,2000,1000,500 (1,352 inst)             0.963
  target 2,300    2000,2000,1000,500   thr 4,8,12                  0.957
                  4000,2000,1000,500   thr 4,8,12                  0.958
                  2000,2000,2000,1000,500  thr 4,8,12              0.963
                  4000,4000,2000,1000,500  thr 4,8,12              0.963
                  2000,2000,2000,2000,1000,500  thr 2,7,12         0.963
                  2000,2000,1000,500   thr 2,7,12 / 1,6,11 / 2,6,10   0.963 / 0.962 / 0.962
                  2000,2000,2000,1000,500  thr 2,7,12              0.965, 0.964 (2 seeds)
                  2000,2000,2000,1000,500  thr 1,6,11              0.968
                  same, thr 2,7,12, 40 epochs                      0.969
                  same, thr 2,7,12, optdigits views doubled        0.967
A fixed price of 1e-3 or more removes every gate (0 instances, 0.905: each output
is then a single input bit or its negation).
"""

import argparse
import os
import time

import numpy as np
import scipy.sparse as sp

from . import fastprep as F
from . import preprocess as P
from . import synth
from . import train as T

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), "data")
PREP = os.path.join(DATA, "prepared")

MNIST_GREY = 32  # binarisation used whenever MNIST is evaluated: grey > 32


def load_counts(name):
    d = np.loadtxt(os.path.join(DATA, name), delimiter=",")
    return d[:, :-1].reshape(-1, 8, 8).astype(np.int64), d[:, -1].astype(np.int64)


class Norm:
    """Normalisation constants (the canonical ones unless overridden for an ablation)."""

    def __init__(self, max_slant=P.MAX_SLANT, box_w=P.BOX_W, pen_r=P.PEN_R):
        self.box_w, self.box_h, self.pen_r = float(box_w), P.BOX_H, float(pen_r)
        self.max_aniso, self.max_slant = P.MAX_ANISO, float(max_slant)

    def strokes(self, pts, sptr, dptr, idx, pen_r=None, A=None):
        n = len(idx)
        pen = np.full(n, self.pen_r) if pen_r is None else pen_r
        A = F.identity(n) if A is None else A
        return F.strokes_batch(
            pts, sptr, dptr, np.asarray(idx, np.int64), self.box_w, self.box_h, pen, self.max_aniso, self.max_slant, A
        )

    def bitmaps(self, imgs):
        return F.bitmaps_batch(
            np.ascontiguousarray(imgs, np.uint8), self.box_w, self.box_h, self.max_aniso, self.max_slant
        )


def shift_x(img32, dx):
    """Shift each 32x32 image horizontally by dx[i] pixels (zero fill)."""
    out = np.zeros_like(img32)
    for d in np.unique(dx):
        m = dx == d
        if d == 0:
            out[m] = img32[m]
        elif d > 0:
            out[m, :, d:] = img32[m, :, :-d]
        else:
            out[m, :, :d] = img32[m, :, -d:]
    return out


def refit_frame(imgs):
    """Bitmaps -> 32x32 with the ink scaled to full height, aspect kept, bbox centred:
    the frame of the optdigits bitmaps (no slant removal).  Augmentation helper."""
    n = len(imgs)
    out = np.zeros((n, 32, 32), np.uint8)
    for q in range(n):
        a = imgs[q]
        rows = np.nonzero(a.any(1))[0]
        cols = np.nonzero(a.any(0))[0]
        if len(rows) == 0:
            continue
        h = rows[-1] - rows[0] + 1
        s = 32.0 / h
        cy = (rows[0] + rows[-1] + 1) / 2.0
        cx = (cols[0] + cols[-1] + 1) / 2.0
        v = np.floor(cy + (np.arange(32) + 0.5 - 16.0) / s).astype(int)
        u = np.floor(cx + (np.arange(32) + 0.5 - 16.0) / s).astype(int)
        ok_v = (v >= 0) & (v < a.shape[0])
        ok_u = (u >= 0) & (u < a.shape[1])
        out[q][np.ix_(ok_v, ok_u)] = a[np.ix_(v[ok_v], u[ok_u])]
    return out


def opt_views(rng, norm, imgs, y, counts, n_raw, n_frame, n_canon):
    """The three optdigits views.  Returns counts (n, 8, 8) and labels."""
    C, Y = [], []
    for _ in range(n_raw):
        C.append(counts)
        Y.append(y)
    n = len(y)
    for _ in range(n_frame):
        A = F.random_linear(rng, n, 3.0, 0.06, 0.04)
        w = F.affine_bitmaps(imgs, A, 48)
        w = F.thicken(w, rng.choice(np.array([0, 0, 0, 1, -1, -1]), n))
        C.append(F.counts_batch(shift_x(refit_frame(w), rng.integers(-1, 2, n))))
        Y.append(y)
    for k in range(n_canon):
        if k == 0:
            C.append(F.counts_batch(norm.bitmaps(imgs)))
            Y.append(y)
            continue
        A = F.random_linear(rng, n, 5.0, 0.10, 0.08)
        w = F.affine_bitmaps(imgs, A, 48)
        w = F.thicken(w, rng.choice(np.array([0, 0, 0, 1, -1, -1]), n))
        C.append(F.counts_batch(shift_x(norm.bitmaps(w), rng.integers(-1, 2, n))))
        Y.append(y)
    return np.concatenate(C), np.concatenate(Y)


def pen_views(rng, norm, pts, sptr, dptr, y, idx, n_aug):
    C = [F.counts_batch(norm.strokes(pts, sptr, dptr, idx))]
    Y = [y[idx]]
    n = len(idx)
    for _ in range(n_aug):
        A = F.random_linear(rng, n, 5.0, 0.10, 0.08)
        pen = rng.uniform(2.0, 3.0, n)
        im = norm.strokes(pts, sptr, dptr, idx, pen, A)
        C.append(F.counts_batch(shift_x(im, rng.integers(-1, 2, n))))
        Y.append(y[idx])
    return np.concatenate(C), np.concatenate(Y)


def mnist_views(rng, norm, grey, y, n_views):
    C, Y = [], []
    for _ in range(n_views):
        thr = rng.integers(16, 161, len(y))[:, None, None]
        C.append(F.counts_batch(norm.bitmaps(grey > thr)))
        Y.append(y)
    return np.concatenate(C), np.concatenate(Y)


def mnist_counts(norm, grey):
    """The fixed rule for evaluating MNIST: grey > MNIST_GREY, then image_to_counts."""
    return F.counts_batch(norm.bitmaps(grey > MNIST_GREY))


def build(a, rng, norm):
    """Returns training counts/labels and a dict of validation sets (empty when --val 0)."""
    src = a.sources.split(",")
    C, Y, val = [], [], {}
    o = np.load(os.path.join(PREP, "optdigits_orig.npz"))
    oimg = np.concatenate([o["tra_img"], o["cv_img"], o["wdep_img"]])
    oy = np.concatenate([o["tra_y"], o["cv_y"], o["wdep_y"]])
    ocnt, oy2 = load_counts("optdigits.tra")
    assert (oy == oy2).all() and (F.counts_batch(oimg) == ocnt).all()
    vr = np.random.default_rng(12345)  # validation split never depends on --seed
    keep = np.ones(len(oy), bool)
    if a.val:
        keep[vr.choice(len(oy), 760, replace=False)] = False
        val["opt-raw"] = (ocnt[~keep], oy[~keep])
    if "opt" in src:
        c, yy = opt_views(rng, norm, oimg[keep], oy[keep], ocnt[keep], a.opt_raw, a.opt_frame, a.opt_canon)
        C.append(c)
        Y.append(yy)

    z = np.load(os.path.join(PREP, "pendigits_orig.npz"))
    pts, sptr, dptr, py = F.pen_strokes(z, "tra")
    pidx = np.arange(len(py))
    if a.val:
        hold = vr.choice(len(py), 1500, replace=False)
        val["pen"] = (F.counts_batch(norm.strokes(pts, sptr, dptr, hold)), py[hold])
        pidx = np.setdiff1d(pidx, hold)
    if "pen" in src:
        c, yy = pen_views(rng, norm, pts, sptr, dptr, py, pidx, a.pen_aug)
        C.append(c)
        Y.append(yy)

    m = np.load(os.path.join(PREP, "mnist.npz"))
    mg, my = m["train_img"], m["train_y"]
    if a.val:
        val["mnist"] = (mnist_counts(norm, mg[55000:]), my[55000:])
        mg, my = mg[:55000], my[:55000]
    if "mnist" in src:
        c, yy = mnist_views(rng, norm, mg, my, a.mnist_views)
        C.append(c)
        Y.append(yy)
    return np.concatenate(C), np.concatenate(Y), val


# ops that need a real two-input gate (AND family and XOR/XNOR); the others are
# constants, wires or inverters and cost no dominoes of their own
REAL = np.array([0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1, 1, 0], np.float32)


class GateNet:
    """train.Net with sparse scatter (fast for wide layers) and an optional price on
    real gates: the loss gets ``lam * sum over gates of P(gate is a real two-input op)``,
    which pushes gates the task does not need towards wires and keeps the unrolled
    instance count inside the domino budget."""

    def __init__(self, n_in, widths, seed, lam=0.0):
        rng = np.random.default_rng(seed)
        self.conn, self.W, self.S = [], [], []
        self.lam = lam
        prev = n_in
        for w in widths:
            ia, ib = T.make_conn(rng, prev, w, None)
            self.conn.append((ia, ib))
            self.W.append(rng.normal(0, 1, (w, 16)).astype(np.float32))
            one, col = np.ones(w, np.float32), np.arange(w)
            self.S.append(
                (sp.csr_matrix((one, (ia, col)), shape=(prev, w)), sp.csr_matrix((one, (ib, col)), shape=(prev, w)))
            )
            prev = w
        self.m = [np.zeros_like(W) for W in self.W]
        self.v = [np.zeros_like(W) for W in self.W]
        self.t = 0

    def forward(self, X):
        self.cache = []
        h = X
        for (ia, ib), W in zip(self.conn, self.W):
            p = np.exp(W - W.max(1, keepdims=True))
            p /= p.sum(1, keepdims=True)
            K = p @ T.C
            a, b = h[:, ia], h[:, ib]
            ab = a * b
            out = K[:, 0] + K[:, 1] * a + K[:, 2] * b + K[:, 3] * ab
            self.cache.append((a, b, ab, p, K))
            h = out
        return h

    def backward(self, dout, lr):
        grads = [None] * len(self.W)
        for li in reversed(range(len(self.W))):
            a, b, ab, p, K = self.cache[li]
            dK = np.stack([dout.sum(0), (dout * a).sum(0), (dout * b).sum(0), (dout * ab).sum(0)], 1)
            dp = dK @ T.C.T
            if self.lam:
                dp = dp + self.lam * REAL
            grads[li] = p * (dp - (dp * p).sum(1, keepdims=True))
            if li > 0:
                da = dout * (K[:, 1] + K[:, 3] * b)
                db = dout * (K[:, 2] + K[:, 3] * a)
                Sa, Sb = self.S[li]
                dout = np.ascontiguousarray((Sa @ da.T + Sb @ db.T).T)
        self.t += 1
        b1, b2 = 0.9, 0.999
        for li, g in enumerate(grads):
            self.m[li] = b1 * self.m[li] + (1 - b1) * g
            self.v[li] = b2 * self.v[li] + (1 - b2) * g * g
            mh = self.m[li] / (1 - b1**self.t)
            vh = self.v[li] / (1 - b2**self.t)
            self.W[li] -= (lr * mh / (np.sqrt(vh) + 1e-8)).astype(np.float32)

    def ops(self):
        return [W.argmax(1) for W in self.W]

    def forward_discrete(self, Xb):
        h = np.asarray(Xb).astype(bool)
        for (ia, ib), op in zip(self.conn, self.ops()):
            h = T.eval_ops(op, h[:, ia], h[:, ib])
        return h


def instances(net):
    """Unrolled gate instances (and_inst + xor_inst) and the number of gates actually used."""
    Fo = synth.Forest(net.conn, net.ops())
    L = len(net.conn)
    roots = [Fo.lit(L - 1, j) for j in range(len(net.W[-1]))]
    st = synth.tree_stats(Fo, roots)
    return st


def predict(net, Xb):
    return T.group_scores(net.forward_discrete(Xb)).argmax(1)


def save(path, net, widths, thr, Xte, yte):
    ops = net.ops()
    pred = predict(net, Xte)
    acc = (pred == yte).mean()
    np.savez(
        path,
        widths=np.array(widths),
        thr=np.array(thr, dtype=np.float64),
        K=-1,
        **{f"ia{i}": c[0] for i, c in enumerate(net.conn)},
        **{f"ib{i}": c[1] for i, c in enumerate(net.conn)},
        **{f"op{i}": o for i, o in enumerate(ops)},
        Xte=Xte.astype(np.float32),
        yte=yte,
        pred=pred,
        acc=acc,
    )
    return acc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--widths", default="2000,2000,2000,1000,500")
    ap.add_argument("--thr", default=",".join(str(t) for t in P.THRESHOLDS))
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--tau", type=float, default=2.0)
    ap.add_argument("--lr", type=float, default=0.02)
    ap.add_argument("--bs", type=int, default=128)
    ap.add_argument("--lam", type=float, default=0.0, help="price on real gates (start value with --target-inst)")
    ap.add_argument(
        "--target-inst",
        type=int,
        default=2300,
        help="steer the price so that and_inst + xor_inst ends near this number (0: fixed price)",
    )
    ap.add_argument("--gain", type=float, default=2.0)
    ap.add_argument("--lam-min", type=float, default=1e-7)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--sources", default="opt,pen,mnist")
    ap.add_argument("--opt-raw", type=int, default=8)
    ap.add_argument("--opt-frame", type=int, default=12)
    ap.add_argument("--opt-canon", type=int, default=4)
    ap.add_argument("--pen-aug", type=int, default=9)
    ap.add_argument("--mnist-views", type=int, default=1)
    ap.add_argument("--val", type=int, default=0)
    ap.add_argument("--max-slant", type=float, default=P.MAX_SLANT, help="ablation only")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    widths = [int(x) for x in a.widths.split(",")]
    thr = [int(x) for x in a.thr.split(",")]
    assert widths[-1] % 10 == 0 and len(thr) == 3
    g = widths[-1] // 10
    tau = a.tau
    norm = Norm(max_slant=a.max_slant)
    rng = np.random.default_rng(1000 + a.seed)
    t0 = time.time()
    Ctr, ytr, val = build(a, rng, norm)
    Xtr = F.bits_batch(Ctr, thr)
    Xval = {k: (F.bits_batch(c, thr), y) for k, (c, y) in val.items()}
    print(
        f"train {len(ytr)} samples from {a.sources}; widths {widths} thr {thr} tau {tau:g} "
        f"max_slant {a.max_slant:g}; data built in {time.time() - t0:.0f}s",
        flush=True,
    )

    net = GateNet(Xtr.shape[1], widths, a.seed, a.lam if (a.lam or not a.target_inst) else 1e-5)
    steps_per_epoch = len(ytr) // a.bs
    total = a.epochs * steps_per_epoch
    step = 0
    for ep in range(a.epochs):
        perm = rng.permutation(len(ytr))
        for s in range(steps_per_epoch):
            idx = perm[s * a.bs : (s + 1) * a.bs]
            out = net.forward(Xtr[idx].astype(np.float32))
            sc = T.group_scores(out) / tau
            sc -= sc.max(1, keepdims=True)
            pr = np.exp(sc)
            pr /= pr.sum(1, keepdims=True)
            pr[np.arange(len(idx)), ytr[idx]] -= 1
            dout = np.repeat(pr / len(idx) / tau, g, axis=1)
            lr = a.lr * (0.05 + 0.95 * 0.5 * (1 + np.cos(np.pi * step / total)))
            net.backward(dout.astype(np.float32), lr)
            step += 1
            if a.target_inst and step % 100 == 0:
                st = instances(net)
                n_inst = st["and_inst"] + st["xor_inst"]
                net.lam = float(np.clip(net.lam * np.exp(a.gain * (n_inst / a.target_inst - 1.0)), a.lam_min, 1e-3))
        st = instances(net)
        info = f"inst {st['and_inst'] + st['xor_inst']} price {net.lam:.2e} ({time.time() - t0:.0f}s)"
        if Xval and (ep % 2 == 1 or ep == a.epochs - 1):
            msg = " ".join(f"{k} {(predict(net, X) == y).mean():.4f}" for k, (X, y) in Xval.items())
            print(f"ep {ep + 1} val {msg} {info}", flush=True)
        else:
            print(f"ep {ep + 1} {info}", flush=True)
    if Xval:
        res = {k: float((predict(net, X) == y).mean()) for k, (X, y) in Xval.items()}
        worst = {k: float(min((predict(net, X)[y == c] == c).mean() for c in range(10))) for k, (X, y) in Xval.items()}
        st = instances(net)
        print(
            "RESULT",
            a.sources,
            widths,
            thr,
            "slant",
            a.max_slant,
            "lam",
            a.lam,
            "target",
            a.target_inst,
            "tau",
            tau,
            "ep",
            a.epochs,
            "seed",
            a.seed,
            "inst",
            st["and_inst"] + st["xor_inst"],
            " ".join(f"{k} {v:.4f} (min class {worst[k]:.3f})" for k, v in res.items()),
            "mean",
            round(float(np.mean(list(res.values()))), 4),
            flush=True,
        )
    if a.out:
        cte, yte = load_counts("optdigits.tes")
        acc = save(a.out, net, widths, thr, F.bits_batch(cte, thr), yte)
        st = instances(net)
        print(
            "saved",
            a.out,
            "(gates %d)" % sum(widths),
            st,
            "and_inst + xor_inst =",
            st["and_inst"] + st["xor_inst"],
            "" if a.val else "optdigits.tes accuracy %.4f" % acc,
            flush=True,
        )


if __name__ == "__main__":
    main()
