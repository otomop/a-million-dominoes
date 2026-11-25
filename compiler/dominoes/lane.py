"""The race lane: one vote section per output gate.

Inside a section the lane splits into a short path, which runs through a
blocking gate, and a long detour.  The output gate's "is 0" line is the
blocker: if the gate says 0 the short path is cut and the lane loses the
length of the detour.  So a lane's finish time counts the gates that voted
against its digit.
"""

import math

from .gadgets import PITCH, ROW, Canvas, merge, rinh, split
from .layout import RINH_RIGHT, RINH_X_LEFT


def _arc(cv, c, r, th0, th1, tag):
    n = max(2, int(round(abs(th1 - th0) * r / 22.0)))
    out = []
    for k in range(1, n + 1):
        th = th0 + (th1 - th0) * k / n
        ccw = th1 > th0
        out.append(
            cv.add(
                c[0] + r * math.cos(th), c[1] + r * math.sin(th), th + (math.pi / 2 if ccw else -math.pi / 2), tag=tag
            )
        )
    return out


def _vline(cv, x, y0, y1, tag):
    """vertical chain from y0 (exclusive) to y1 (inclusive), heading sign(y1-y0)."""
    n = max(1, int(round(abs(y1 - y0) / PITCH)))
    yaw = math.pi / 2 if y1 > y0 else -math.pi / 2
    return [cv.add(x, y0 + (y1 - y0) * k / n, yaw, tag=tag) for k in range(1, n + 1)]


def _hline(cv, x0, x1, y, tag):
    n = max(1, int(round((x1 - x0) / PITCH)))
    return [cv.add(x0 + (x1 - x0) * k / n, y, 0.0, tag=tag) for k in range(1, n + 1)]


def section_template(n_pairs, hb_rows=10, q=6, r=36.0):
    """One lane section in a local frame (flow +x).  Lane in at (0,0), out at (S_len,0)."""
    cv = Canvas()
    lane_in = cv.add(0.0, 0.0, 0.0, tag="lane")
    pre = _hline(cv, 0.0, 2 * PITCH, 0.0, "lane")
    xJ = cv.d[pre[-1]]["x"]
    ia, ib, xs = split(cv, xJ, 0.0, ROW, 0.0, tag="lane")
    x0 = xs + PITCH
    R = -4
    x_r = x0 + RINH_X_LEFT + 24 * (q - 1)
    g = rinh(cv, x_r, R * ROW, side=+1, q=q, tag="sec")
    cv.path([(xs, 0.0), tuple(g["main_start"])], start_gap=PITCH, end_exact=True, tag="lane")
    # root (inhibitor) approach from below: vertical line, CW quarter turn (radius 72), along row -2
    rt = 72.0
    x_is = g["inh_start"][0]
    x_in = x_is - rt - 48
    y_in = -9 * ROW
    root_entry = cv.add(x_in, y_in, math.pi / 2, tag="rootin")
    _vline(cv, x_in, y_in, -2 * ROW - rt, "root")
    _arc(cv, (x_in + rt, -2 * ROW - rt), rt, math.pi, math.pi / 2, "root")
    cv.path([(x_in + rt, -2 * ROW), tuple(g["inh_start"])], start_gap=PITCH, end_exact=True, tag="root")
    # bypass: from (xs, ROW) heading +x; quarter turn up, serpentine of vertical legs, back to +x at row 3
    y_lo = 3 * ROW
    y_hi = (3 + hb_rows) * ROW
    x = xs
    _hline(cv, xs, xs + PITCH, ROW, "byp")
    x = xs + PITCH
    # rise to y_lo along a cosine S-bend
    cv.path([(x, ROW), (x + 160, y_lo)], start_gap=PITCH, end_exact=True, tag="byp")
    x += 160
    for p in range(n_pairs):
        _arc(cv, (x, y_lo + r), r, -math.pi / 2, 0.0, "byp")  # CCW to heading +y
        _vline(cv, x + r, y_lo + r, y_hi - r, "byp")
        _arc(cv, (x + 2 * r, y_hi - r), r, math.pi, 0.0, "byp")  # CW over the top, heading -y
        _vline(cv, x + 3 * r, y_hi - r, y_lo + r, "byp")
        _arc(cv, (x + 4 * r, y_lo + r), r, math.pi, 3 * math.pi / 2, "byp")  # CCW back to heading +x
        x += 4 * r
    x_down = max(x + PITCH, x_r + RINH_RIGHT + 24)
    _hline(cv, x, x_down, y_lo, "byp")
    # parallel S-bends: bypass 3 -> 0, exit -6 -> -1, then merge -> row 0
    ee = g["exit_end"]
    cv.path([tuple(ee), (x_down, ee[1])], start_gap=PITCH, end_exact=True, tag="lane")
    L = 440.0
    cv.path([(x_down, y_lo), (x_down + L, 0.0)], start_gap=PITCH, end_exact=True, tag="byp")
    cv.path([(x_down, ee[1]), (x_down + L, -ROW)], start_gap=PITCH, end_exact=True, tag="lane")
    ia2, ib2, J = merge(cv, x_down + L, 0.0, -ROW, 0.0, tag="lane")
    xJ2 = cv.d[J]["x"]
    out = _hline(cv, xJ2, xJ2 + 2 * PITCH, 0.0, "lane")
    return dict(
        cv=cv,
        lane_in=lane_in,
        lane_out=out[-1],
        root_entry=root_entry,
        Sq=g["Sq"],
        J=J,
        S_len=cv.d[out[-1]]["x"],
        x_in=x_in,
        y_in=y_in,
    )


def to_arm_frame(d, X0, Y0):
    """A vote section is designed flowing +x; in an arm the lane flows -y."""
    return dict(x=X0 + d["y"], y=Y0 - d["x"], yaw=d["yaw"] - math.pi / 2, z0=d["z0"], tag=d["tag"])
