"""Free routing: lines of dominoes that leave the row grid.

A Path is a polyline with rounded corners, sampled by arc length.  Dominoes are
placed along it at an even pitch, each facing along the path.  `offset` gives a
true parallel curve, so two lines can travel side by side through any turn.
"""

import math

import numpy as np

from . import eventsim as ev
from .gadgets import PITCH


class Path:
    def __init__(self, pts, radius=150.0):
        """pts: list of (x, y).  radius: corner radius, one number or one per inner vertex."""
        pts = [np.asarray(p, float) for p in pts]
        n = len(pts)
        radii = [float(radius)] * (n - 2) if np.isscalar(radius) else [float(r) for r in radius]
        if len(radii) != max(0, n - 2):
            raise ValueError("need one radius per inner vertex")
        self.pts, self.radii = pts, radii
        self.segs = []  # ('line', p0, p1, length) or ('arc', centre, r, a0, sweep, length)
        cur = pts[0]
        for k in range(1, n - 1):
            v = pts[k]
            d1 = v - pts[k - 1]
            d2 = pts[k + 1] - v
            l1, l2 = np.linalg.norm(d1), np.linalg.norm(d2)
            d1, d2 = d1 / l1, d2 / l2
            cross = d1[0] * d2[1] - d1[1] * d2[0]
            turn = math.atan2(cross, float(d1 @ d2))
            r = radii[k - 1]
            if abs(turn) < 1e-9 or r <= 0:
                self._line(cur, v)
                cur = v
                continue
            tl = r * math.tan(abs(turn) / 2)
            a = v - d1 * tl
            b = v + d2 * tl
            if np.linalg.norm(a - pts[k - 1]) < np.linalg.norm(cur - pts[k - 1]) - 1e-6 or tl > l2 + 1e-6:
                raise ValueError(f"corner {k} does not fit: radius {r:.0f}, turn {math.degrees(turn):.0f} deg")
            self._line(cur, a)
            left = np.array([-d1[1], d1[0]])
            c = a + left * r * (1 if turn > 0 else -1)
            a0 = math.atan2(a[1] - c[1], a[0] - c[0])
            self.segs.append(("arc", c, r, a0, turn, r * abs(turn)))
            cur = b
        self._line(cur, pts[-1])
        self.length = sum(s[-1] for s in self.segs)

    def _line(self, p0, p1):
        L = float(np.linalg.norm(p1 - p0))
        if L > 1e-9:
            self.segs.append(("line", p0, p1, L))

    def at(self, s):
        """Point and heading at arc length s."""
        s = min(max(s, 0.0), self.length)
        for seg in self.segs:
            L = seg[-1]
            if s <= L + 1e-9:
                if seg[0] == "line":
                    _, p0, p1, _ = seg
                    u = (p1 - p0) / L
                    p = p0 + u * s
                    return p[0], p[1], math.atan2(u[1], u[0])
                _, c, r, a0, sweep, _ = seg
                a = a0 + sweep * (s / L)
                return (
                    c[0] + r * math.cos(a),
                    c[1] + r * math.sin(a),
                    a + (math.pi / 2 if sweep > 0 else -math.pi / 2),
                )
            s -= L
        raise AssertionError

    def offset(self, d):
        """Parallel path, d to the left of the direction of travel (negative = right)."""
        pts, out, radii = self.pts, [], []
        n = len(pts)
        normals = []
        for k in range(n - 1):
            u = pts[k + 1] - pts[k]
            u = u / np.linalg.norm(u)
            normals.append(np.array([-u[1], u[0]]))
        out.append(pts[0] + normals[0] * d)
        for k in range(1, n - 1):
            n1, n2 = normals[k - 1], normals[k]
            out.append(pts[k] + (n1 + n2) * d / (1 + float(n1 @ n2)))
            u1 = np.array([n1[1], -n1[0]])
            u2 = np.array([n2[1], -n2[0]])
            turn = math.atan2(u1[0] * u2[1] - u1[1] * u2[0], float(u1 @ u2))
            r = self.radii[k - 1] - d * (1 if turn > 0 else -1)
            if r < 60:
                raise ValueError("offset makes a corner tighter than 60 mm")
            radii.append(r)
        out.append(pts[-1] + normals[-1] * d)
        return Path(out, radii)

    def lay(self, cv, start_gap=PITCH, end_gap=0.0, pitch=PITCH, tag=""):
        """Place dominoes from start_gap to length - end_gap.  The caller's previous
        domino sits at the path's start.  Returns the new indices."""
        span = self.length - end_gap - start_gap
        if span < -1e-6:
            raise ValueError("path shorter than its gaps")
        n = max(1, int(round(span / pitch)) + 1)
        step = span / (n - 1) if n > 1 else 0.0
        idx = []
        for k in range(n):
            x, y, yaw = self.at(start_gap + step * k)
            idx.append(cv.add(x, y, yaw, tag=tag))
        return idx


def chain_delay(cv, prev, idxs):
    """Delay of a simple chain as the event automaton computes it: each domino
    reaches the next after tau(distance along its own heading)."""
    t = 0.0
    p = cv.d[prev]
    for i in idxs:
        q = cv.d[i]
        along = (q["x"] - p["x"]) * math.cos(p["yaw"]) + (q["y"] - p["y"]) * math.sin(p["yaw"])
        t += float(ev.tau(max(along, 1.0)))
        p = q
    return t


def circle_points(rho, a0, a1, step_deg=5.0):
    """Points on a circle about the origin from angle a0 to a1 (radians), ends included."""
    n = max(1, int(math.ceil(abs(a1 - a0) / math.radians(step_deg))))
    return [(rho * math.cos(a0 + (a1 - a0) * k / n), rho * math.sin(a0 + (a1 - a0) * k / n)) for k in range(n + 1)]
