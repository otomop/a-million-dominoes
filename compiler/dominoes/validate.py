"""Geometry check (no two dominoes overlap) and the network's own gate outputs."""


import numpy as np

from . import eventsim as ev
from .gadgets import T, W
from .train import eval_ops


def overlaps(x, y, yaw, z0):
    from scipy.spatial import cKDTree

    tr = cKDTree(np.c_[x, y])
    pairs = tr.query_pairs(26.0, output_type="ndarray")
    if len(pairs) == 0:
        return 0, []
    I, J = pairs[:, 0], pairs[:, 1]
    same = np.abs(z0[I] - z0[J]) < 40
    I, J = I[same], J[same]
    P = ev._corners(x[I], y[I], np.cos(yaw[I]), np.sin(yaw[I]), T / 2, W / 2)
    Q = ev._corners(x[J], y[J], np.cos(yaw[J]), np.sin(yaw[J]), T / 2, W / 2)
    ok = ev._sat(P, Q)
    return int(ok.sum()), list(zip(I[ok][:5], J[ok][:5]))


def gate_outputs(z, X):
    widths = z["widths"]
    L = len(widths)
    h = X.astype(bool)
    for l in range(L):
        h = eval_ops(z[f"op{l}"], h[:, z[f"ia{l}"]], h[:, z[f"ib{l}"]])
    return h
