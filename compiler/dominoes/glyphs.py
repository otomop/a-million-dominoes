"""The ten digits as single-weight strokes, used to paint the picture panels.

Each digit is a set of polylines in a box 0.64 wide and 1.0 tall (y up).
`mask(digit, u, v)` says whether the point (u, v) of that box is inked.
"""

import math

import numpy as np

HALF_WIDTH = 0.068
BOX_W = 0.64


def _arc(cx, cy, rx, ry, a0, a1, n=28):
    return [
        (
            cx + rx * math.cos(math.radians(a0 + (a1 - a0) * k / n)),
            cy + ry * math.sin(math.radians(a0 + (a1 - a0) * k / n)),
        )
        for k in range(n + 1)
    ]


def _bezier(p0, p1, p2, n=20):
    out = []
    for k in range(n + 1):
        t = k / n
        out.append(
            (
                (1 - t) ** 2 * p0[0] + 2 * t * (1 - t) * p1[0] + t * t * p2[0],
                (1 - t) ** 2 * p0[1] + 2 * t * (1 - t) * p1[1] + t * t * p2[1],
            )
        )
    return out


STROKES = {
    0: [_arc(0.32, 0.50, 0.23, 0.42, 0, 360, 48)],
    1: [[(0.15, 0.72), (0.36, 0.92), (0.36, 0.08)]],
    2: [_arc(0.31, 0.68, 0.23, 0.24, 165, -40) + [(0.09, 0.08), (0.57, 0.08)]],
    3: [_arc(0.29, 0.71, 0.21, 0.21, 150, -90) + _arc(0.30, 0.285, 0.225, 0.215, 90, -150)],
    4: [[(0.47, 0.08), (0.47, 0.92), (0.08, 0.34), (0.59, 0.34)]],
    5: [[(0.53, 0.92), (0.17, 0.92), (0.14, 0.53)] + _arc(0.30, 0.33, 0.25, 0.25, 127, -142)],
    6: [_arc(0.32, 0.31, 0.225, 0.23, 0, 360, 40), _bezier((0.50, 0.92), (0.10, 0.82), (0.095, 0.31))],
    7: [[(0.08, 0.92), (0.56, 0.92), (0.27, 0.08)]],
    8: [_arc(0.32, 0.71, 0.185, 0.21, 0, 360, 36), _arc(0.32, 0.285, 0.225, 0.215, 0, 360, 40)],
    9: [_arc(0.32, 0.69, 0.225, 0.23, 0, 360, 40), _bezier((0.545, 0.69), (0.54, 0.18), (0.14, 0.08))],
}

_SEGS = {}
for _d, _strokes in STROKES.items():
    a, b = [], []
    for s in _strokes:
        p = np.asarray(s, float)
        a.append(p[:-1])
        b.append(p[1:])
    _SEGS[_d] = (np.concatenate(a), np.concatenate(b))


def mask(digit, u, v):
    """Vectorised: True where (u, v) lies within HALF_WIDTH of a stroke of the digit."""
    u = np.asarray(u, float)
    v = np.asarray(v, float)
    A, B = _SEGS[digit]
    p = np.stack([u, v], -1)[..., None, :]
    ab = B - A
    t = np.clip(((p - A) * ab).sum(-1) / np.maximum((ab * ab).sum(-1), 1e-12), 0, 1)
    d = np.linalg.norm(p - (A + t[..., None] * ab), axis=-1)
    return d.min(-1) < HALF_WIDTH


if __name__ == "__main__":
    for dgt in range(10):
        rows = []
        for j in range(20):
            v = 1 - (j + 0.5) / 20
            us = (np.arange(14) + 0.5) / 14 * BOX_W
            rows.append("".join("#" if m else "." for m in mask(dgt, us, np.full(14, v))))
        print(dgt)
        print("\n".join(rows))
        print()
