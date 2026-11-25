"""Domino gadget geometry (millimetres).  Shared by the physics tests and the compiler.

Convention: signals flow in +x.  Rows are horizontal lines spaced ROW apart.
A 'Canvas' collects dominoes (x, y, yaw, z0) and static boxes (stairs, decks).
"""

import math

import numpy as np

H, W, T = 48.0, 24.0, 7.5
PITCH = 24.0
ROW = 48.0


class Canvas:
    def __init__(self):
        self.d = []  # dicts x, y, yaw, z0, tag
        self.statics = []  # dicts cx, cy, cz, hx, hy, hz, yaw

    def add(self, x, y, yaw, z0=0.0, tag=""):
        self.d.append(dict(x=float(x), y=float(y), yaw=float(yaw), z0=float(z0), tag=tag))
        return len(self.d) - 1

    def box(self, cx, cy, cz, hx, hy, hz, yaw=0.0):
        self.statics.append(dict(cx=cx, cy=cy, cz=cz, hx=hx, hy=hy, hz=hz, yaw=yaw))

    # ---- generic path: y(x) piecewise, dominoes at arc-length pitch ----
    def path(self, pts, pitch=PITCH, start_gap=PITCH, z0=0.0, tag="", end_exact=False):
        """pts: list of (x, y) with increasing x.  Between consecutive points the
        curve is a cosine S-blend if y changes, straight otherwise.  The first
        domino is placed start_gap after pts[0] (so the caller's previous domino
        sits at pts[0]).  Returns list of indices."""
        xs, ys = [], []
        for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:]):
            n = max(2, int((x1 - x0) / 0.5))
            s = np.linspace(0, 1, n, endpoint=False)
            xs.append(x0 + (x1 - x0) * s)
            ys.append(y0 + (y1 - y0) * (1 - np.cos(np.pi * s)) / 2)
        xs.append([pts[-1][0]])
        ys.append([pts[-1][1]])
        xs, ys = np.concatenate(xs), np.concatenate(ys)
        seg = np.hypot(np.diff(xs), np.diff(ys))
        arc = np.concatenate([[0], np.cumsum(seg)])
        L = arc[-1]
        if end_exact:
            n = max(1, int(round((L - start_gap) / pitch)) + 1)
            if n == 1:
                targets = np.array([L])
            else:
                p = (L - start_gap) / (n - 1)
                targets = start_gap + p * np.arange(n)
        else:
            targets = np.arange(start_gap, L + 1e-6, pitch)
        idx = []
        for tgt in targets:
            k = min(np.searchsorted(arc, tgt), len(xs) - 1)
            k0 = max(k - 1, 0)
            k1 = min(k + 1, len(xs) - 1)
            yaw = math.atan2(ys[k1] - ys[k0], xs[k1] - xs[k0])
            idx.append(self.add(xs[k], ys[k], yaw, z0, tag))
        return idx

    def straight(self, x0, y, n, pitch=PITCH, z0=0.0, tag=""):
        return [self.add(x0 + k * pitch, y, 0.0, z0, tag) for k in range(n)]


# ---------------------------------------------------------------- primitives
def split(cv, xJ, y, dy_a, dy_b, L=5 * PITCH, tag=""):
    """Incoming line's last domino J is at (xJ, y).  Two branch dominoes side by
    side at (xJ+PITCH, y+-13), then each S-bends to y+dy_a / y+dy_b by x = xJ+PITCH+L.
    Returns (indices_a, indices_b, x_end)."""
    off = 13.0
    a0 = cv.add(xJ + PITCH, y + off, 0.0, tag=tag)
    b0 = cv.add(xJ + PITCH, y - off, 0.0, tag=tag)
    xe = xJ + PITCH + L
    ia = [a0] + cv.path([(xJ + PITCH, y + off), (xe, y + dy_a)], tag=tag, end_exact=True)
    ib = [b0] + cv.path([(xJ + PITCH, y - off), (xe, y + dy_b)], tag=tag, end_exact=True)
    return ia, ib, xe


def merge(cv, xa, ya, yb, ym, L=5 * PITCH, tag=""):
    """Two lines whose last dominoes are at (xa, ya) and (xa, yb) converge to
    ym+-13 at x = xa+L, then both hit J at (xa+L+PITCH, ym).  Returns (ia, ib, J)."""
    off = 13.0
    hi, lo = (ya, yb) if ya > yb else (yb, ya)
    ia = cv.path([(xa, ya), (xa + L, ym + (off if ya > yb else -off))], tag=tag, end_exact=True)
    ib = cv.path([(xa, yb), (xa + L, ym + (off if yb > ya else -off))], tag=tag, end_exact=True)
    J = cv.add(xa + L + PITCH, ym, 0.0, tag=tag)
    return ia, ib, J


def kicker_inh(cv, x0, y_main, side, pre=8, post=4, gap=30.0, gap2=40.0, kick_gap=6.0, n_arc=3, tag=""):
    """INHIBIT gadget.  Main line in row y_main starting with its first domino at
    x0+PITCH (previous domino at x0).  After `pre` dominoes the target S_q stands
    with a local pitch `gap` on both sides.  The inhibitor line arrives in the row
    y_main + side*ROW travelling +x, turns towards the main row with radius R, and
    its last domino K faces the main row, kick_gap from S_q's face.
    Returns dict with main indices, Sq, inhibitor entry x, kicker index, out end."""
    main = cv.straight(x0 + PITCH, y_main, pre, tag=tag)
    xq = x0 + PITCH * pre + gap
    Sq = cv.add(xq, y_main, 0.0, tag=tag + "Sq")
    post_i = cv.straight(xq + gap2, y_main, post, tag=tag)
    # kicker: faces -side*y, centred on xq, base just off S_q's side face
    yK = y_main + side * (W / 2 + kick_gap + T / 2)
    yawK = -side * math.pi / 2
    # arc from row (y_main+side*ROW) heading +x to (xq, yK) heading -side*y
    yr = y_main + side * ROW
    # straight part of inhibitor row ends at x = xq - R; arc centre (xq - R, yr - side*R)
    Rr = abs(yr - yK)
    cx, cy = xq - Rr, yr - side * Rr
    arc = []
    for k in range(1, n_arc + 1):
        a = (math.pi / 2) * k / n_arc
        px = cx + Rr * math.sin(a)
        py = cy + side * Rr * math.cos(a)
        yaw = -side * a
        if k == n_arc:
            arc.append(cv.add(px, py, yawK, tag=tag + "K"))
        else:
            arc.append(cv.add(px, py, yaw, tag=tag))
    return dict(
        main=main, Sq=Sq, post=post_i, arc=arc, K=arc[-1], x_inh_turn=cx, y_inh=yr, x_out=xq + gap2 + PITCH * (post - 1)
    )


def headon_inh(cv, x_s1, y_main, side=+1, q=10, post=2, Rm=44.0, ang=60.0, tag=""):
    """INHIBIT by head-on collision (the card's mechanism).
    Segment S_1..S_{q+post} along y_main, S_1 at x_s1.  The main signal enters S_1
    from row y_main - side*ROW through a steep side entry (angle `ang`) that pushes
    S_1 towards +x.  The inhibitor enters S_q from row y_main + side*2*ROW through a
    steep side entry from the downstream side that pushes S_q towards -x; the
    backward wave consumes the segment, so a main wave arriving later meets fallen
    dominoes.  The steep entries are one-way: a wave running along the segment does
    not knock the entry lines.  Returns dict; the caller's main row line must end
    with a domino at main_start, the inhibitor row line at inh_start."""
    a = math.radians(ang)
    s = side
    seg = cv.straight(x_s1, y_main, q + post, tag=tag + "seg")
    S1 = np.array([x_s1, y_main])
    Sq = np.array([x_s1 + (q - 1) * PITCH, y_main])
    # main entry: heading +ang (towards the segment from the -side), CCW for side=+1
    dm = np.array([math.cos(a), s * math.sin(a)])
    Em = S1 - 30.0 * dm
    cm = Em + Rm * np.array([-dm[1], dm[0]]) * s  # centre on the inner side
    th_end = math.atan2(Em[1] - cm[1], Em[0] - cm[0])
    th_start = th_end - s * a
    n = 2
    main_arc = []
    for k in range(1, n + 1):
        th = th_start + s * a * k / n
        p = cm + Rm * np.array([math.cos(th), math.sin(th)])
        main_arc.append(cv.add(p[0], p[1], th + s * math.pi / 2, tag=tag + ("Em" if k == n else "m")))
    main_start = cm + Rm * np.array([math.cos(th_start), math.sin(th_start)])
    # inhibitor entry: heading 180+ang (towards -x and towards the segment), CW for side=+1
    di = np.array([-math.cos(a), -s * math.sin(a)])
    Ei = Sq - 30.0 * di
    turn = math.pi - a  # 120 degrees for ang=60
    yr = y_main + s * 2 * ROW
    Ri = abs(yr - Ei[1]) / (1 + math.cos(a))  # so the arc starts on row yr
    ci = Ei + Ri * np.array([di[1], -di[0]]) * s  # centre on the inner (right) side
    th_end_i = math.atan2(Ei[1] - ci[1], Ei[0] - ci[0])
    th_start_i = th_end_i + s * turn
    ni = max(2, int(round(Ri * turn / PITCH)))
    inh_arc = []
    for k in range(1, ni + 1):
        th = th_start_i - s * turn * k / ni
        p = ci + Ri * np.array([math.cos(th), math.sin(th)])
        inh_arc.append(cv.add(p[0], p[1], th - s * math.pi / 2, tag=tag + ("Ei" if k == ni else "i")))
    inh_start = ci + Ri * np.array([math.cos(th_start_i), math.sin(th_start_i)])
    return dict(
        seg=seg,
        out=seg[-1],
        x_out=x_s1 + (q + post - 1) * PITCH,
        main_arc=main_arc,
        inh_arc=inh_arc,
        main_start=main_start,
        inh_start=inh_start,
        Sq=seg[q - 1],
    )


KINK = (28.0, 17.0, 40.0)  # diode: next domino 28 ahead, 17 to the side, turned 40 deg back


def arc_dominoes(cv, center, R, th0, th1, n, ccw, tag=""):
    """n dominoes along a circular arc from angle th0 (exclusive) to th1 (inclusive)."""
    out = []
    for k in range(1, n + 1):
        th = th0 + (th1 - th0) * k / n
        p = (center[0] + R * math.cos(th), center[1] + R * math.sin(th))
        yaw = th + (math.pi / 2 if ccw else -math.pi / 2)
        out.append(cv.add(p[0], p[1], yaw, tag=tag))
    return out


def approach(cv, E, phi, y_row, n_straight=2, tag=""):
    """Line that leaves row y_row heading +x, turns along one circular arc to
    heading phi, runs n_straight dominoes straight and ends at point E (the last
    domino, heading phi).  Returns (indices, start point on the row)."""
    h = np.array([math.cos(phi), math.sin(phi)])
    P = np.asarray(E, float) - n_straight * PITCH * h  # arc end point
    if phi > 0:  # CCW
        R = (P[1] - y_row) / (1 - math.cos(phi))
        c = P + R * np.array([-math.sin(phi), math.cos(phi)])
        th1 = math.atan2(P[1] - c[1], P[0] - c[0])
        th0 = -math.pi / 2
        ccw = True
    else:  # CW
        R = (y_row - P[1]) / (1 - math.cos(phi))
        c = P + R * np.array([math.sin(phi), -math.cos(phi)])
        th1 = math.atan2(P[1] - c[1], P[0] - c[0])
        th0 = math.pi / 2
        ccw = False
    if not ccw and th1 > th0:
        th1 -= 2 * math.pi
    if ccw and th1 < th0:
        th1 += 2 * math.pi
    n = max(2, int(round(R * abs(th1 - th0) / PITCH)))
    idx = arc_dominoes(cv, c, R, th0, th1, n, ccw, tag=tag)
    if n_straight == 0:
        cv.d[idx[-1]]["yaw"] = phi
    for k in range(n_straight - 1, -1, -1):
        p = np.asarray(E, float) - k * PITCH * h
        idx.append(cv.add(p[0], p[1], phi, tag=tag))
    start = c + R * np.array([math.cos(th0), math.sin(th0)])
    return idx, start, R


def kink_source(target, target_yaw, side_sign):
    """Position/heading of the domino that drives `target` through a kink diode.
    side_sign=+1: the driving line lies to the left of the target's axis."""
    dx, dy, psi = KINK
    psi = math.radians(psi)
    yaw_a = target_yaw - side_sign * psi
    # in A's frame the target sits at (dx, -side_sign*dy)
    ca, sa = math.cos(yaw_a), math.sin(yaw_a)
    off = np.array([dx * ca + side_sign * dy * sa, dx * sa - side_sign * dy * ca])
    return np.asarray(target, float) - off, yaw_a


def diode_inh(cv, x_s1, y_main, side=+1, q=8, post=2, gap_after=40.0, inh_rows=3, main_rows=2, n_straight=2, tag=""):
    """INHIBIT by head-on collision with one-way kink entries.
    Segment S_1..S_q (pitch 24) then S_{q+1}.. after `gap_after`, in row y_main.
    side=+1: the main arrives in the row above (y_main+ROW) and drives S_1 (+x)
    through a kink; the inhibitor arrives inh_rows rows below, U-turns, and drives
    S_q towards -x through a kink.  side=-1 mirrors in y.  If both fire and the
    inhibitor wins the race to S_q, the backward wave consumes S_q..S_1 and the main
    meets fallen dominoes.  The caller's row lines must end with a domino at
    main_start / inh_start."""
    s = side
    seg = cv.straight(x_s1, y_main, q, tag=tag + "seg")
    xq = x_s1 + (q - 1) * PITCH
    seg += cv.straight(xq + gap_after, y_main, post, tag=tag + "seg")
    Am, ya = kink_source((x_s1, y_main), 0.0, s)  # main from the +s side
    m_idx, main_start, Rm = approach(
        cv, Am, ya, y_main + s * main_rows * ROW, n_straight if main_rows > 1 else 0, tag=tag + "m"
    )
    Ai, yi = kink_source((xq, y_main), math.pi, s)  # inhibitor from the -s side
    yi = math.atan2(math.sin(yi), math.cos(yi))
    i_idx, inh_start, Ri = approach(cv, Ai, yi, y_main - s * inh_rows * ROW, n_straight, tag=tag + "i")
    return dict(
        seg=seg,
        out=seg[-1],
        x_out=cv.d[seg[-1]]["x"],
        Sq=seg[q - 1],
        S1=seg[0],
        main_arc=m_idx,
        inh_arc=i_idx,
        main_start=main_start,
        inh_start=inh_start,
        Rm=Rm,
        Ri=Ri,
    )


def rinh(
    cv, x_r, y_main, side=+1, q=4, post=2, gap_after=40.0, inh_rows=2, main_rows=4, r_exit=48.0, n_straight=2, tag=""
):
    """Reversed INHIBIT (head-on collision, kink diodes).  The segment runs from
    S_1 (right, x_r) leftwards to S_q, then after `gap_after` a few more dominoes,
    then a U-turn (radius r_exit) back to +x in the exit row.  side=+1: main and
    inhibitor arrive from above, the exit leaves below.  The main overshoots to the
    right, U-turns and drives S_1 towards -x; the inhibitor drives S_q towards +x
    with a simple forward kink, so it naturally arrives first; its wave runs back
    along the segment and meets the main head-on.  Returns dict."""
    s = side
    seg = [cv.add(x_r - k * PITCH, y_main, math.pi, tag=tag + "seg") for k in range(q)]
    xq = x_r - (q - 1) * PITCH
    seg += [cv.add(xq - gap_after - k * PITCH, y_main, math.pi, tag=tag + "seg") for k in range(post)]
    xe = cv.d[seg[-1]]["x"]
    n = int(round(math.pi * r_exit / PITCH))
    c = (xe, y_main - s * r_exit)
    ex = []
    for k in range(1, n + 1):
        th = s * math.pi / 2 + s * math.pi * k / n
        p = (c[0] + r_exit * math.cos(th), c[1] + r_exit * math.sin(th))
        ex.append(cv.add(p[0], p[1], th + s * math.pi / 2, tag=tag + "ex"))
    exit_end = np.array([xe, y_main - s * 2 * r_exit])
    Ai, yi = kink_source((xq, y_main), 0.0, s)
    i_idx, inh_start, Ri = approach(cv, Ai, yi, y_main + s * inh_rows * ROW, n_straight, tag=tag + "i")
    Am, ym = kink_source((x_r, y_main), math.pi, -s)
    ym = math.atan2(math.sin(ym), math.cos(ym))
    m_idx, main_start, Rm = approach(cv, Am, ym, y_main + s * main_rows * ROW, n_straight, tag=tag + "m")
    return dict(
        seg=seg,
        Sq=seg[q - 1],
        S1=seg[0],
        ex=ex,
        exit_end=exit_end,
        main_arc=m_idx,
        inh_arc=i_idx,
        main_start=main_start,
        inh_start=inh_start,
        Rm=Rm,
        Ri=Ri,
    )


def bridge_swap(cv, x0, y_lo, y_hi, n_up=4, step=15.5, deck_len=6 * PITCH, tag=""):
    """Swap two adjacent rows.  Line A runs in row y_lo, climbs n_up stairs, crosses
    on a raised deck to row y_hi, descends.  Line B runs from y_hi to y_lo on the
    ground underneath the deck.  Previous dominoes of both lines sit at x0.
    Returns (A indices, B indices, x_end)."""
    A, B = [], []
    zt = n_up * step
    x = x0
    # climb: domino k stands on a block of height (k+1)*step
    for k in range(n_up):
        x += PITCH
        z = (k + 1) * step
        cv.box(x, y_lo, z / 2, PITCH / 2 - 0.5, 15.0, z / 2)
        A.append(cv.add(x, y_lo, 0.0, z0=z, tag=tag + "A"))
    # deck
    xd0, xd1 = x + PITCH / 2, x + PITCH / 2 + deck_len + PITCH
    deck_th = 6.0
    cv.box(
        (xd0 + xd1) / 2, (y_lo + y_hi) / 2, zt - deck_th / 2, (xd1 - xd0) / 2, abs(y_hi - y_lo) / 2 + 16, deck_th / 2
    )
    A += cv.path([(x, y_lo), (x + deck_len, y_hi), (x + deck_len + PITCH, y_hi)], z0=zt, tag=tag + "A", end_exact=True)
    x = x + deck_len + PITCH
    for k in range(n_up):
        x += PITCH
        z = (n_up - 1 - k) * step
        if z > 0:
            cv.box(x, y_hi, z / 2, PITCH / 2 - 0.5, 15.0, z / 2)
        A.append(cv.add(x, y_hi, 0.0, z0=z, tag=tag + "A"))
    xe = x
    # B: ground, stays in y_hi under the climb, S-bends under the deck, then y_lo
    B = cv.path(
        [(x0, y_hi), (x0 + n_up * PITCH, y_hi), (x0 + n_up * PITCH + deck_len + PITCH, y_lo), (xe, y_lo)],
        tag=tag + "B",
        end_exact=True,
    )
    return A, B, xe


def serpentine(cv, x, y, n_pairs, h, r=36.0, tag=""):
    """Delay detour for a line flowing +x in row y whose last domino is at (x, y):
    n_pairs bumps, each a quarter turn up, a leg of length h, a half turn over the
    top, a leg down and a quarter turn back into the row.  Each bump advances the
    line by 4r.  Returns the new indices; the last one is at (x + 4r*n_pairs, y)."""

    def arc(c, th0, th1):
        n = max(2, int(round(abs(th1 - th0) * r / 22.0)))
        return arc_dominoes(cv, c, r, th0, th1, n, th1 > th0, tag=tag)

    def leg(xl, y0, y1):
        n = max(1, int(round(abs(y1 - y0) / PITCH)))
        yaw = math.pi / 2 if y1 > y0 else -math.pi / 2
        return [cv.add(xl, y0 + (y1 - y0) * k / n, yaw, tag=tag) for k in range(1, n + 1)]

    out = []
    for _ in range(n_pairs):
        out += arc((x, y + r), -math.pi / 2, 0.0)
        out += leg(x + r, y + r, y + r + h)
        out += arc((x + 2 * r, y + r + h), math.pi, 0.0)
        out += leg(x + 3 * r, y + r + h, y + r)
        out += arc((x + 4 * r, y + r), math.pi, 3 * math.pi / 2)
        x += 4 * r
    return out
