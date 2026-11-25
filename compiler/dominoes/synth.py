"""Logic synthesis: trained gate network -> forest of simplified trees.

Each output gate becomes a binary tree (gates duplicated instead of routed).
Simplifications: buffers/inverters become literal flags, constants fold,
identical children fold.  Node kinds:
  ('in', bit)                     input bit (dual-rail pusher pair)
  ('const', v)
  ('and', X, nx, Y, ny, nout)     out = (X^nx AND Y^ny) ^ nout
  ('xor', X, Y, nout)             out = X xor Y xor nout
A literal is (node, neg).
"""

from functools import lru_cache

import numpy as np

# op -> (kind, params): for AND family: (nx, ny, nout)
AND_FAM = {
    1: (0, 0, 0),
    2: (0, 1, 0),
    4: (1, 0, 0),
    8: (1, 1, 0),
    14: (0, 0, 1),
    13: (0, 1, 1),
    11: (1, 0, 1),
    7: (1, 1, 1),
}


def load(path):
    z = np.load(path)
    L = len(z["widths"])
    conn = [(z[f"ia{i}"], z[f"ib{i}"]) for i in range(L)]
    ops = [z[f"op{i}"] for i in range(L)]
    return z, conn, ops


class Forest:
    def __init__(self, conn, ops):
        self.conn, self.ops = conn, ops
        self.nodes = {}  # canonical tuple -> id
        self.kind = []  # id -> tuple
        self.memo = {}

    def mk(self, t):
        if t not in self.nodes:
            self.nodes[t] = len(self.kind)
            self.kind.append(t)
        return self.nodes[t]

    def lit(self, layer, j):
        """Return literal (node_id, neg) for gate j of layer (layer -1 = input bit j)."""
        key = (layer, j)
        if key in self.memo:
            return self.memo[key]
        if layer < 0:
            r = (self.mk(("in", int(j))), 0)
        else:
            ia, ib = self.conn[layer]
            op = int(self.ops[layer][j])
            if op == 0:
                r = (self.mk(("const", 0)), 0)
            elif op == 15:
                r = (self.mk(("const", 1)), 0)
            elif op in (3, 12):
                a = self.lit(layer - 1, ia[j])
                r = (a[0], a[1] ^ (op == 12))
            elif op in (5, 10):
                b = self.lit(layer - 1, ib[j])
                r = (b[0], b[1] ^ (op == 10))
            elif op in (6, 9):
                r = self.xor(self.lit(layer - 1, ia[j]), self.lit(layer - 1, ib[j]), int(op == 9))
            else:
                nx, ny, no = AND_FAM[op]
                r = self.andg(self.lit(layer - 1, ia[j]), nx, self.lit(layer - 1, ib[j]), ny, no)
        self.memo[key] = r
        return r

    def const(self, lit):
        k = self.kind[lit[0]]
        return None if k[0] != "const" else (k[1] ^ lit[1])

    def andg(self, A, nx, B, ny, no):
        a = (A[0], A[1] ^ nx)
        b = (B[0], B[1] ^ ny)
        ca, cb = self.const(a), self.const(b)
        if ca == 0 or cb == 0:
            return (self.mk(("const", 0)), no)
        if ca == 1:
            return (b[0], b[1] ^ no)
        if cb == 1:
            return (a[0], a[1] ^ no)
        if a[0] == b[0]:
            return (a[0], a[1] ^ no) if a[1] == b[1] else (self.mk(("const", 0)), no)
        # canonical order
        if a[0] > b[0]:
            a, b = b, a
        return (self.mk(("and", a[0], a[1], b[0], b[1])), no)

    def xor(self, A, B, no):
        ca, cb = self.const(A), self.const(B)
        if ca is not None and cb is not None:
            return (self.mk(("const", ca ^ cb ^ no)), 0)
        if ca is not None:
            return (B[0], B[1] ^ ca ^ no)
        if cb is not None:
            return (A[0], A[1] ^ cb ^ no)
        if A[0] == B[0]:
            return (self.mk(("const", A[1] ^ B[1] ^ no)), 0)
        a, b = (A, B) if A[0] < B[0] else (B, A)
        return (self.mk(("xor", a[0], b[0])), a[1] ^ b[1] ^ no)

    def eval(self, nid, x, cache):
        if nid in cache:
            return cache[nid]
        k = self.kind[nid]
        if k[0] == "in":
            v = bool(x[k[1]])
        elif k[0] == "const":
            v = bool(k[1])
        elif k[0] == "and":
            v = (self.eval(k[1], x, cache) ^ bool(k[2])) and (self.eval(k[3], x, cache) ^ bool(k[4]))
        else:
            v = self.eval(k[1], x, cache) ^ self.eval(k[2], x, cache)
        cache[nid] = v
        return v


def tree_stats(F, roots):
    """Unrolled (duplicated) tree sizes: count gate instances when every use is a copy."""

    @lru_cache(None)
    def cnt(nid):
        k = F.kind[nid]
        if k[0] == "in":
            return (0, 0, 1)
        if k[0] == "const":
            return (0, 0, 0)
        a = cnt(k[1])
        b = cnt(k[3] if k[0] == "and" else k[2])
        return (a[0] + b[0] + (k[0] == "and"), a[1] + b[1] + (k[0] == "xor"), a[2] + b[2])

    tot = np.zeros(3, int)
    for r in roots:
        tot += np.array(cnt(r[0]))
    return dict(and_inst=int(tot[0]), xor_inst=int(tot[1]), leaves=int(tot[2]))


if __name__ == "__main__":
    import sys

    for path in sys.argv[1:]:
        z, conn, ops = load(path)
        F = Forest(conn, ops)
        L = len(conn)
        n_out = len(ops[-1])
        roots = [F.lit(L - 1, j) for j in range(n_out)]
        # verify against the discretised network on the test set
        Xte, yte, pred = z["Xte"], z["yte"], z["pred"]
        g = n_out // 10
        ok = 0
        ties = 0
        for i in range(len(yte)):
            cache = {}
            out = np.array([F.eval(r[0], Xte[i], cache) ^ bool(r[1]) for r in roots])
            sc = out.reshape(10, g).sum(1)
            ok += int(sc.argmax() == pred[i])
            ties += int((sc == sc.max()).sum() > 1)
        st = tree_stats(F, roots)
        kinds = [k[0] for k in F.kind]
        print(
            path,
            "shared nodes: and",
            kinds.count("and"),
            "xor",
            kinds.count("xor"),
            "in",
            kinds.count("in"),
            "| unrolled",
            st,
            "| const roots",
            sum(F.const(r) is not None for r in roots),
            f"| matches net {ok}/{len(yte)} | test ties {ties}",
        )
