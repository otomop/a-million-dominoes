"""Difflogic-style logic-gate network, trained in numpy (CPU).

Each gate reads two fixed inputs from the previous layer and learns a softmax
over the 16 two-input Boolean functions (real-valued relaxation).  After
training every gate is discretised to its argmax function.  The output layer
is split into 10 equal groups; the class score is the popcount of its group
and the prediction is argmax (ties -> lowest class index, as numpy.argmax).

Connections:
  layer 1      : random pairs from the input bits (free in dominoes: every
                 gate gets private copies of the input pushers)
  layers >= 2  : random pairs inside a window of +-K positions around the
                 gate's proportional position (K=None -> unrestricted)
"""

import argparse
import gzip
import time

import numpy as np

# op_i(a,b) = C0 + C1 a + C2 b + C3 ab   (difflogic order)
C = np.array(
    [
        [0, 0, 0, 0],  # 0  FALSE
        [0, 0, 0, 1],  # 1  A AND B
        [0, 1, 0, -1],  # 2  A AND NOT B
        [0, 1, 0, 0],  # 3  A
        [0, 0, 1, -1],  # 4  NOT A AND B
        [0, 0, 1, 0],  # 5  B
        [0, 1, 1, -2],  # 6  XOR
        [0, 1, 1, -1],  # 7  OR
        [1, -1, -1, 1],  # 8  NOR
        [1, -1, -1, 2],  # 9  XNOR
        [1, 0, -1, 0],  # 10 NOT B
        [1, 0, -1, 1],  # 11 A OR NOT B
        [1, -1, 0, 0],  # 12 NOT A
        [1, -1, 0, 1],  # 13 NOT A OR B
        [1, 0, 0, -1],  # 14 NAND
        [1, 0, 0, 0],  # 15 TRUE
    ],
    dtype=np.float32,
)


def load_digits(path, thresholds):
    d = np.loadtxt(gzip.open(path), delimiter=",")
    X, y = d[:, :-1], d[:, -1].astype(int)
    rng = np.random.default_rng(0)
    perm = rng.permutation(len(y))
    X, y = X[perm], y[perm]
    bits = np.concatenate([(X > t) for t in thresholds], axis=1).astype(np.float32)
    ntr = 1437
    return bits[:ntr], y[:ntr], bits[ntr:], y[ntr:], X[:ntr], X[ntr:]


def make_conn(rng, n_in, n_out, K):
    if K is None:
        c = np.concatenate([rng.permutation(n_in) for _ in range((2 * n_out) // n_in + 2)])[: 2 * n_out]
        a, b = c[0::2].copy(), c[1::2].copy()
    else:
        a = np.empty(n_out, int)
        b = np.empty(n_out, int)
        for j in range(n_out):
            ctr = int((j + 0.5) * n_in / n_out)
            lo, hi = max(0, ctr - K), min(n_in, ctr + K + 1)
            a[j], b[j] = rng.choice(np.arange(lo, hi), 2, replace=False)
    for j in range(n_out):
        while a[j] == b[j]:
            b[j] = rng.integers(n_in)
    return a, b


class Net:
    def __init__(self, n_in, widths, K, seed):
        rng = np.random.default_rng(seed)
        self.conn, self.W = [], []
        prev = n_in
        for li, w in enumerate(widths):
            self.conn.append(make_conn(rng, prev, w, None if li == 0 else K))
            self.W.append(rng.normal(0, 1, (w, 16)).astype(np.float32))
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
            K = p @ C
            a, b = h[:, ia], h[:, ib]
            out = K[:, 0] + K[:, 1] * a + K[:, 2] * b + K[:, 3] * a * b
            self.cache.append((h, a, b, p, K))
            h = out
        return h

    def backward(self, dout, lr):
        grads = [None] * len(self.W)
        for li in reversed(range(len(self.W))):
            h, a, b, p, K = self.cache[li]
            ia, ib = self.conn[li]
            dK = np.stack([dout.sum(0), (dout * a).sum(0), (dout * b).sum(0), (dout * a * b).sum(0)], 1)
            dp = dK @ C.T
            dW = p * (dp - (dp * p).sum(1, keepdims=True))
            grads[li] = dW
            if li > 0:
                da = dout * (K[:, 1] + K[:, 3] * b)
                db = dout * (K[:, 2] + K[:, 3] * a)
                dh = np.zeros_like(h)
                n_in = h.shape[1]
                # scatter-add over columns
                dh += da @ onehot(ia, n_in)
                dh += db @ onehot(ib, n_in)
                dout = dh
        self.t += 1
        b1, b2 = 0.9, 0.999
        for li, g in enumerate(grads):
            self.m[li] = b1 * self.m[li] + (1 - b1) * g
            self.v[li] = b2 * self.v[li] + (1 - b2) * g * g
            mh = self.m[li] / (1 - b1**self.t)
            vh = self.v[li] / (1 - b2**self.t)
            self.W[li] -= lr * mh / (np.sqrt(vh) + 1e-8)

    def ops(self):
        return [W.argmax(1) for W in self.W]

    def forward_discrete(self, Xb):
        h = Xb.astype(bool)
        for (ia, ib), op in zip(self.conn, self.ops()):
            h = eval_ops(op, h[:, ia], h[:, ib])
        return h


_oh = {}


def onehot(idx, n):
    key = (id(idx), n)
    if key not in _oh:
        M = np.zeros((len(idx), n), np.float32)
        M[np.arange(len(idx)), idx] = 1
        _oh[key] = M
    return _oh[key]


def eval_ops(op, a, b):
    a = a.astype(np.int8)
    b = b.astype(np.int8)
    Ci = C[op].astype(np.int8)
    v = Ci[:, 0] + Ci[:, 1] * a + Ci[:, 2] * b + Ci[:, 3] * a * b
    return v.astype(bool)


def group_scores(out, ncls=10):
    B, n = out.shape
    return out.reshape(B, ncls, n // ncls).sum(2)


def train(widths, K, thresholds, epochs, tau, seed, lr=0.01, bs=64, log=True):
    Xtr, ytr, Xte, yte, _, _ = load_digits("data/digits.csv.gz", thresholds)
    net = Net(Xtr.shape[1], widths, K, seed)
    rng = np.random.default_rng(seed + 1)
    best = (0, None)
    for ep in range(epochs):
        perm = rng.permutation(len(ytr))
        for s in range(0, len(ytr), bs):
            idx = perm[s : s + bs]
            out = net.forward(Xtr[idx])
            sc = group_scores(out) / tau
            sc -= sc.max(1, keepdims=True)
            pr = np.exp(sc)
            pr /= pr.sum(1, keepdims=True)
            pr[np.arange(len(idx)), ytr[idx]] -= 1
            dsc = pr / len(idx) / tau
            g = widths[-1] // 10
            dout = np.repeat(dsc, g, axis=1)
            net.backward(dout.astype(np.float32), lr)
        if ep % 10 == 9 or ep == epochs - 1:
            acc_d = (group_scores(net.forward_discrete(Xte)).argmax(1) == yte).mean()
            acc_tr = (group_scores(net.forward_discrete(Xtr)).argmax(1) == ytr).mean()
            acc_r = (group_scores(net.forward(Xte)).argmax(1) == yte).mean()
            if log:
                print(
                    f"ep {ep + 1} relaxed-test {acc_r:.3f} discrete-train {acc_tr:.3f} discrete-test {acc_d:.3f}",
                    flush=True,
                )
    return net, (Xtr, ytr, Xte, yte)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--widths", default="500,500,500")
    ap.add_argument("--K", type=int, default=-1)
    ap.add_argument("--thr", default="4,8,12")
    ap.add_argument("--epochs", type=int, default=200)
    ap.add_argument("--tau", type=float, default=10)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    widths = [int(x) for x in a.widths.split(",")]
    thr = [float(x) for x in a.thr.split(",")]
    t0 = time.time()
    net, (Xtr, ytr, Xte, yte) = train(widths, None if a.K < 0 else a.K, thr, a.epochs, a.tau, a.seed)
    ops = net.ops()
    pred = group_scores(net.forward_discrete(Xte)).argmax(1)
    acc = (pred == yte).mean()
    hist = np.bincount(np.concatenate(ops), minlength=16)
    print(
        "gates",
        sum(widths),
        "layers",
        len(widths),
        "K",
        a.K,
        "test acc (discrete)",
        round(float(acc), 4),
        "time",
        round(time.time() - t0, 1),
    )
    print("op histogram", hist.tolist())
    if a.out:
        np.savez(
            a.out,
            widths=np.array(widths),
            thr=np.array(thr),
            K=a.K,
            **{f"ia{i}": c[0] for i, c in enumerate(net.conn)},
            **{f"ib{i}": c[1] for i, c in enumerate(net.conn)},
            **{f"op{i}": o for i, o in enumerate(ops)},
            Xte=Xte,
            yte=yte,
            pred=pred,
            acc=acc,
        )
