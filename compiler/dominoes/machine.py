"""The whole machine.

Ten arms stand in a pinwheel around a hub.  Each arm holds one digit's logic
trees (flowing sideways) and its race lane (flowing inward).  The lanes run on
through feeders to a small core at the centre, where every lane splits in two:
one copy joins a common line (the first lane home fires it), the other is that
lane's own claim.  The common line fans back out and blocks every claim except
the one that arrived first, which topples its digit's picture panel.

Everything outside the trees is timed by simulation, not by estimate: the
machine is built once, each lane is run alone to measure its delays, and it is
built again with the lane starts and claim delays corrected.
"""

import math
import time
from dataclasses import dataclass

import numpy as np

from . import eventsim as ev
from .export import KIND_OF_CAT, TICK, quantise_graph
from .gadgets import PITCH, ROW, serpentine, split
from .glyphs import BOX_W
from .glyphs import mask as glyph_mask
from .lane import _arc, _vline, section_template, to_arm_frame
from .layout import LEAD_REQ, Compiler, Rail
from .paths import Path, chain_delay, circle_points
from .synth import Forest, load


@dataclass
class Params:
    n_bumps: int = 3  # detour bumps per vote section
    hb_rows: int = 21  # bump height in rows -> detour of about 6.3 s
    eps: float = 0.55  # head start between neighbouring digits (s), breaks ties as argmax does
    arm0_deg: float = 225.0  # digit 0's arm; the others follow clockwise
    arm_step_deg: float = 30.0  # twelve slots, two left empty to make the bay
    arm_gap: float = 1500.0  # minimum clearance between neighbouring arms (mm)
    rho0: float = 5000.0  # radius of the innermost feeder arc
    drho: float = 300.0
    y_in: float = 4000.0  # where the feeders enter the core
    start_row: float = 2400.0  # row length of the lane-start delay lines
    start_margin: float = 0.3  # slack on top of the required inhibitor lead (s)
    panel_taps: int = 30  # two picture columns per tap, 72 mm apart
    panel_col: float = 6200.0  # picture column length
    panel_pitch: float = 4700.0
    y_strip: float = -28500.0  # the panels' feeder row
    gate_pitch: float = 1200.0  # spacing of the ten finish gates
    box_pairs: int = 4  # bumps in each claim's delay box
    box_min: float = 1.9  # first-pass delay of the box (s)
    core_bumps: int = 12  # bumps that hold the common line back


def template_times(T):
    cv = T["cv"]
    G = ev.graph_from_canvas(cv)
    ft1, _ = ev.simulate(G, [(T["lane_in"], 1, 0.0)])
    ft0, _ = ev.simulate(G, [(T["lane_in"], 1, 5.0), (T["root_entry"], 1, 0.0)])
    return dict(
        short=float(ft1[T["lane_out"]]),
        long=float(ft0[T["lane_out"]] - 5.0),
        in_to_sq=float(ft1[T["Sq"]]),
        root_to_sq=float(ft0[T["Sq"]]),
    )


def transform(cv, n0, n1, s0, s1, rot, ox, oy, tx, ty):
    """Rotate dominoes n0..n1 and statics s0..s1 by rot about (ox, oy), then move (ox, oy) to (tx, ty)."""
    c, s = math.cos(rot), math.sin(rot)
    for d in cv.d[n0:n1]:
        x, y = d["x"] - ox, d["y"] - oy
        d["x"] = tx + c * x - s * y
        d["y"] = ty + s * x + c * y
        d["yaw"] += rot
    for b in cv.statics[s0:s1]:
        x, y = b["cx"] - ox, b["cy"] - oy
        b["cx"] = tx + c * x - s * y
        b["cy"] = ty + s * x + c * y
        b["yaw"] = b.get("yaw", 0.0) + rot


def start_line(B, x0, y_s, delay, row_len):
    """Delay line for a lane start.  It ends one pitch above the lane's first
    domino (x0, y_s), flowing -y; its first domino, tipped at t = 0, makes the
    lane's first domino fall `delay` seconds later.  Rows fold back above the arm."""
    cv = B.cv
    rise, gap = 300.0, 72.0
    n_rows = int(delay * 800.0 / row_len) + 3
    pts = []
    for i in range(n_rows - 1, -1, -1):
        y = y_s + rise + gap * i
        a, b = (x0 - row_len, x0) if i % 2 == 0 else (x0, x0 - row_len)
        pts += [(a, y), (b, y)]
    pts.append((x0, y_s))
    path = Path(pts, 36.0)
    step = float(ev.tau(PITCH))

    def lay(canvas, need):
        idx = path.lay(canvas, start_gap=path.length - need, end_gap=PITCH)
        return idx, chain_delay(canvas, idx[0], idx[1:]) + step

    from .gadgets import Canvas

    lo, hi = 2 * PITCH, path.length - 1.0
    for _ in range(40):
        mid = (lo + hi) / 2
        if lay(Canvas(), mid)[1] < delay:
            lo = mid
        else:
            hi = mid
    idx, got = lay(cv, hi)
    B.sync("lane-start")
    return idx[0], got


def build_arm(C, F, roots, js, T, tt, start_delay, P):
    """One digit's trees, lane and lane start, in the arm's own frame
    (trees flow +x, the lane runs down the right-hand edge in -y)."""
    B = C.B
    cv = B.cv
    B.sync("wire")
    n0, s0 = len(cv.d), len(cv.statics)
    B.x_origin = 0.0
    band = int(math.ceil((T["S_len"] + 2 * ROW) / ROW)) + 1
    top = 0
    rr = []
    widest = max((C.width(roots[j][0], {roots[j][1]}) for j in js if F.const(roots[j]) is None), default=0.0)
    for j in js:
        nid, neg = roots[j]
        cst = F.const((nid, neg))
        if cst is not None:
            rr.append(dict(j=j, const=cst, row=top))
            top -= band
            continue
        need = {neg}
        H = C.height(nid, need)
        B.x_origin = widest - C.width(nid, need) if C.right_align else 0.0
        outs = C.compile(nid, need, top, "T%d." % j)
        rr.append(dict(j=j, const=None, rail=outs[0], row=outs[0].row))
        top -= max(H + 1, band)
    B.x_origin = 0.0
    live = [r for r in rr if r["const"] is None]
    X_fe = max((r["rail"].x for r in live), default=0.0) + 100
    for r in live:
        B.extend(r["rail"], X_fe, cat="align")
    Y0 = []
    prev = None
    for r in rr:
        want = r["row"] * ROW + T["x_in"]
        y0 = want if prev is None else min(want, prev - T["S_len"] - 2 * ROW)
        Y0.append(y0)
        prev = y0
    drows = max(abs(r["row"] * ROW - (y0 - T["x_in"])) / ROW for r, y0 in zip(rr, Y0))
    L_s = max(400.0, 80.0 * drows + 200)
    X0 = X_fe + L_s - T["y_in"] + 48
    # ---- the lane
    B.sync("wire")
    y_s = Y0[0] + 2 * PITCH
    start = cv.add(X0, y_s, -math.pi / 2, tag="lanestart")
    prev_out, t_lane, need_start = start, 0.0, 0.0
    secs, const0 = [], []
    for r, y0 in zip(rr, Y0):
        py = cv.d[prev_out]["y"]
        ny = int(round((py - y0) / PITCH))
        chain = [cv.add(X0, py - (py - y0) * m / ny, -math.pi / 2, tag="lane") for m in range(1, ny)]
        off = len(cv.d)
        for d in T["cv"].d:
            cv.d.append(to_arm_frame(d, X0, y0))
        lane_in, lane_out = off + T["lane_in"], off + T["lane_out"]
        entry, sq = off + T["root_entry"], off + T["Sq"]
        B.sync("lane")
        t_in = t_lane + chain_delay(cv, prev_out, chain + [lane_in])
        t_sq = t_in + tt["in_to_sq"]
        if r["const"] is None:
            rail = r["rail"]
            ex, ey = cv.d[entry]["x"], cv.d[entry]["y"]
            idx = cv.path(
                [(rail.x, rail.row * ROW), (rail.x + L_s - 200, ey), (ex - PITCH, ey)], start_gap=PITCH, end_exact=True
            )
            B.sync("align")
            ready = rail.hi + B.delay(rail.last, idx + [entry]) + tt["root_to_sq"]
            need_start = max(need_start, ready + LEAD_REQ - t_sq)
        elif r["const"] == 0:
            const0.append(entry)
            need_start = max(need_start, tt["root_to_sq"] + LEAD_REQ - t_sq)
        secs.append(dict(j=r["j"], sq=sq, out=lane_out, entry=entry, const=r["const"]))
        t_lane = t_in + tt["short"]
        prev_out = lane_out
    y_end = Y0[-1] - T["S_len"] - 400
    py = cv.d[prev_out]["y"]
    ny = int(round((py - y_end) / PITCH))
    tail = [cv.add(X0, py - (py - y_end) * m / ny, -math.pi / 2, tag="lane") for m in range(1, ny + 1)]
    B.sync("lane")
    delay = max(start_delay if start_delay is not None else 0.0, need_start + P.start_margin)
    starter, got = start_line(B, X0, y_s, delay, P.start_row)
    n1, s1 = len(cv.d), len(cv.statics)
    xs = np.array([d["x"] for d in cv.d[n0:n1]])
    ys = np.array([d["y"] for d in cv.d[n0:n1]])
    return dict(
        n0=n0,
        n1=n1,
        s0=s0,
        s1=s1,
        X0=X0,
        y_end=y_end,
        umin=float(xs.min() - X0),
        umax=float(xs.max() - X0),
        vmax=float(ys.max() - y_end),
        start=start,
        starter=starter,
        lane_end=tail[-1],
        secs=secs,
        const0=const0,
        need_start=need_start,
        start_delay=got,
        t_lane=t_lane,
    )


def _corners(arm, R, phi, pad):
    er = np.array([math.cos(phi), math.sin(phi)])
    et = np.array([-er[1], er[0]])
    out = []
    for u, v in (
        (arm["umin"] - pad, -pad),
        (arm["umax"] + pad, -pad),
        (arm["umax"] + pad, arm["vmax"] + pad),
        (arm["umin"] - pad, arm["vmax"] + pad),
    ):
        out.append((R + v) * er - u * et)
    return np.array(out)


def inner_radius(arms, phis, P, r_min):
    """Smallest hub radius at which neighbouring arms keep their clearance."""
    R = r_min
    while True:
        polys = [_corners(a, R, phi, P.arm_gap / 2) for a, phi in zip(arms, phis)]
        if not any(ev.sat_overlap(polys[c], polys[c + 1]) for c in range(len(arms) - 1)):
            return R
        R += 250.0


def build_core(B, P):
    """The finish core in its own frame (flow +x): split every lane into a claim
    (m) and a vote on the common line (k), merge the ten k into one line, split
    it into ten blockers (b), and bring each blocker next to its claim."""
    cv = B.cv
    B.sync("wire")
    n0, s0 = len(cv.d), len(cv.statics)

    def level(rs):
        x = max(r.x for r in rs)
        for r in rs:
            B.extend(r, x)

    rails, ins = [], []
    for c in range(10):
        row = 2 * c + 1
        i = cv.add(0.0, row * ROW, 0.0, tag="core-in")
        B.sync("arena")
        f = Rail(row, 0.0, i, 0.0, 0.0, ("f", c))
        B.extend(f, 2 * PITCH)
        a, b = B.do_split(f, None, None)
        k, m = (a, b) if c < 5 else (b, a)
        k.label, m.label = ("k", c), ("m", c)
        rails += [k, m]
        ins.append(i)
    level(rails)
    asc = [("m", c) for c in range(5)] + [("k", c) for c in range(10)] + [("m", c) for c in range(5, 10)]
    cur = B.sort_rails(sorted(rails, key=lambda r: -r.row), asc[::-1], 19)
    ms, ks = cur[:5] + cur[15:], cur[5:15]
    for rows in (None, [12, 11, 10, 9, 8], [11, 10, 9], [10, 9]):
        if rows is not None:
            B.place(ks, rows)
        nxt, i = [], 0
        while i < len(ks):
            if i + 1 < len(ks) and ks[i].row - ks[i + 1].row == 1:
                nxt.append(B.do_merge(ks[i], ks[i + 1], ("k", -1)))
                i += 2
            else:
                nxt.append(ks[i])
                i += 1
        ks = nxt
        level(ks)
    common = ks[0].last
    # hold the common line back so that every claim, even the slowest, can be
    # timed to reach its gate just before its own blocker
    idx = serpentine(cv, ks[0].x, ks[0].row * ROW, P.core_bumps, 60.0)
    B.sync("arena")
    ks[0].last, ks[0].x = idx[-1], cv.d[idx[-1]]["x"]

    def split2(r):
        return list(B.do_split(r, ("b", -1), ("b", -1)))

    bs = split2(ks[0])
    B.place(bs, [11, 8])
    bs = split2(bs[0]) + [bs[1]]
    level(bs)
    B.place(bs, [13, 10, 6])
    bs = split2(bs[0]) + split2(bs[1]) + [bs[2]]
    level(bs)
    B.place(bs, [14, 12, 10, 8, 6])
    bs = [r for q in bs for r in split2(q)]
    level(bs)
    for r in bs:
        r.label = ("b", int(round(r.row)) - 5)
    level(ms + bs)
    asc2 = [lab for c in range(10) for lab in (("b", c), ("m", c))]
    cur = B.sort_rails(sorted(ms + bs, key=lambda r: -r.row), asc2[::-1], 19)
    level(cur)
    B.sync("arena")
    B.cat[n0:] = ["arena"] * (len(cv.d) - n0)
    length = cur[0].x
    outs = {r.label: r.last for r in cur}
    return dict(n0=n0, n1=len(cv.d), s0=s0, s1=len(cv.statics), ins=ins, common=common, outs=outs, length=length)


def build_panel(B, c, out, P):
    """Feeder along the top edge with a tap every 144 mm; each tap feeds a column
    down and back up.  The digit is painted on the columns."""
    cv = B.cv
    B.sync("arena")
    first = len(cv.d)
    xJ, yf = out.x, out.row * ROW
    y_top = yf - ROW - 72.0
    y_bot = y_top - P.panel_col
    cols = []
    for _ in range(P.panel_taps):
        _, _, xe = split(cv, xJ, yf, 0.0, -ROW, tag="pfeed")
        _arc(cv, (xe, y_top), 72.0, math.pi / 2, 0.0, "pfeed")
        B.sync("panel-feed")
        x1 = xe + 72.0
        col = _vline(cv, x1, y_top, y_bot, "pcol")
        col += _arc(cv, (x1 + 36.0, y_bot), 36.0, math.pi, 2 * math.pi, "pcol")
        col += _vline(cv, x1 + 72.0, y_bot, y_top - 80.0, "pcol")
        cols.append(col)
        B.cat += [None] * len(col)
        xJ = xe
    x_lo = cv.d[cols[0][0]]["x"] - 36.0
    x_hi = cv.d[cols[-1][-1]]["x"] + 36.0
    y_lo, y_hi = y_bot - 36.0, y_top
    gh = 0.84 * (y_hi - y_lo)
    cx = (x_lo + x_hi) / 2
    for col in cols:
        u = np.array([(cv.d[i]["x"] - cx) / gh + BOX_W / 2 for i in col])
        v = np.array([(cv.d[i]["y"] - y_lo - 0.08 * (y_hi - y_lo)) / gh for i in col])
        on = glyph_mask(c, u, v)
        for i, o in zip(col, on):
            B.cat[i] = "panel-on" if o else "panel-off"
    return dict(
        first=first, count=len(cv.d) - first, cx=cx, cy=(y_lo + y_hi) / 2, w=x_hi - x_lo, h=y_hi - y_lo, yaw=0.0
    )


class Machine:
    def __init__(self, net_path, params=None, right_align=True):
        self.P = params or Params()
        self.right_align, self.wmemo = right_align, {}
        self.z, conn, ops = load(net_path)
        self.F = Forest(conn, ops)
        self.conn, self.ops = conn, ops
        L = len(conn)
        n_out = len(ops[-1])
        self.g = n_out // 10
        self.roots = [self.F.lit(L - 1, j) for j in range(n_out)]
        self.T = section_template(self.P.n_bumps, hb_rows=self.P.hb_rows)
        self.tt = template_times(self.T)
        self.order = None

    # ---- tree order: earliest-ready first, so the lanes can start early
    def tree_order(self):
        C = Compiler(self.F, self.right_align, self.wmemo)
        order = []
        for c in range(10):
            keyed = []
            for j in range(c * self.g, (c + 1) * self.g):
                nid, neg = self.roots[j]
                if self.F.const((nid, neg)) is not None:
                    keyed.append((-1e9, j))
                    continue
                r = C.compile(nid, {neg}, 0, "O%d." % j)[0]
                keyed.append((r.hi if self.right_align else r.hi - r.x / 800.0, j))
            order.append([j for _, j in sorted(keyed)])
        self.order = order
        return order

    def build(self, start_delays=None, box_delays=None, verbose=True):
        P = self.P
        t0 = time.time()
        if self.order is None:
            self.tree_order()
        C = Compiler(self.F, self.right_align, self.wmemo)
        B = C.B
        cv = B.cv
        self.C, self.B, self.cv = C, B, cv
        arms = []
        for c in range(10):
            sd = None if start_delays is None else start_delays[c]
            arms.append(build_arm(C, self.F, self.roots, self.order[c], self.T, self.tt, sd, P))
        phis = [math.radians(P.arm0_deg - P.arm_step_deg * c) for c in range(10)]
        # the stage has to fit inside the hub's bay
        x_left = [(c - 4.5) * P.panel_pitch - P.panel_taps * 72.0 for c in range(10)]
        stage_far = math.hypot(
            max(abs(x_left[0]) + 600.0, x_left[9] + P.panel_taps * 144.0), abs(P.y_strip) + 200.0 + P.panel_col
        )
        R = inner_radius(arms, phis, P, max(20000.0, stage_far + 1500.0))
        for a, phi in zip(arms, phis):
            transform(
                cv,
                a["n0"],
                a["n1"],
                a["s0"],
                a["s1"],
                phi - math.pi / 2,
                a["X0"],
                a["y_end"],
                R * math.cos(phi),
                R * math.sin(phi),
            )
        arm_of = np.full(len(cv.d), 255, np.uint8)
        for c, a in enumerate(arms):
            arm_of[a["n0"] : a["n1"]] = c
        owner = [(len(cv.d), 255)]  # (first index, arm) for everything added from here on
        # ---- core
        core = build_core(B, P)
        transform(cv, core["n0"], core["n1"], core["s0"], core["s1"], -math.pi / 2, 0.0, 0.0, -10 * ROW, P.y_in)
        pos = lambda i: (cv.d[i]["x"], cv.d[i]["y"])
        # ---- feeders
        feeders = []
        for c in range(10):
            owner.append((len(cv.d), c))
            rho = P.rho0 + P.drho * (c if c < 5 else 9 - c)
            xc, yin = pos(core["ins"][c])
            ring = circle_points(rho, phis[c], math.acos(xc / rho), 5.0)
            pts = [pos(arms[c]["lane_end"])] + ring + [(xc, yin)]
            path = Path(pts, [150.0] + [300.0] * (len(ring) - 2) + [150.0])
            idx = path.lay(cv, start_gap=PITCH, end_gap=PITCH, tag="feeder")
            B.sync("feeder")
            feeders.append(idx)
        # ---- each claim meets its blocker at a gate just below the core (claim on the
        # left of travel, blocker on the right); the one claim that passes runs on to its panel
        starts = []
        for c in range(10):
            pb, pm = pos(core["outs"][("b", c)]), pos(core["outs"][("m", c)])
            starts.append(((pb[0] + pm[0]) / 2, pb[1]))
        xg = [(c - 4.5) * P.gate_pitch for c in range(10)]
        y_gate = starts[0][1] - 3500.0
        west = [c for c in range(10) if xg[c] < starts[c][0]]
        east = [c for c in range(10) if c not in west]
        rank = {c: k for k, c in enumerate(west)}
        rank.update({c: k for k, c in enumerate(east[::-1])})
        gates, panels, wins, gate_ranges = [], [], [], []
        box_delays = box_delays or [P.box_min] * 10
        for c in range(10):
            owner.append((len(cv.d), c))
            S = starts[c]
            ctr = Path(
                [S, (S[0], S[1] - 300.0 - 200.0 * rank[c]), (xg[c], y_gate + 1000.0), (xg[c], y_gate)], [150.0, 150.0]
            )
            im = ctr.offset(+24.0).lay(cv, tag="claim")
            ib = ctr.offset(-24.0).lay(cv, tag="block")
            B.sync("arena")
            # the gate is built flowing +x in its own frame, then turned to flow south
            n_d, s_d = len(cv.d), len(cv.statics)
            m = Rail(0.5, 0.0, im[-1], 0.0, 0.0, ("dm", c))
            b = Rail(-0.5, 0.0, ib[-1], 0.0, 0.0, ("db", c))
            B.place([m, b], [0.5, -1.5])
            B.do_delay(m, box_delays[c], n_pairs=P.box_pairs)
            x0 = max(m.x, b.x)
            B.extend(m, x0)
            B.extend(b, x0)
            out, x_end, _ = B.do_rinh(m, b, x0, ("win", c), q_fixed=4)
            g = B.last_gadget
            gates.append(
                dict(
                    main_last=g["main_arc"][-1],
                    inh_last=g["inh_arc"][-1],
                    sq=g["Sq"],
                    dm=chain_delay(cv, g["main_arc"][-1], g["seg"][: g["q"]]),
                    di=chain_delay(cv, g["inh_arc"][-1], [g["Sq"]]),
                )
            )
            B.extend(out, x_end + 100.0)
            B.sync("arena")
            B.cat[n_d:] = ["arena"] * (len(cv.d) - n_d)
            transform(cv, n_d, len(cv.d), s_d, len(cv.statics), -math.pi / 2, 0.0, 0.0, xg[c], y_gate)
            gate_ranges.append((n_d, len(cv.d)))
            wins.append(out.last)
            po = pos(out.last)
            xa = x_left[c] - 216.0 - 200.0  # a quarter turn straight into the feeder row
            route = Path(
                [po, (po[0], po[1] - 400.0), (xa, P.y_strip + 900.0), (xa, P.y_strip), (x_left[c] - 216.0, P.y_strip)],
                [150.0, 150.0, 200.0],
            )
            idx = route.lay(cv, tag="winline")
            B.sync("arena")
            feed = Rail(P.y_strip / ROW, cv.d[idx[-1]]["x"], idx[-1], 0.0, 0.0, ("feed", c))
            panels.append(build_panel(B, c, feed, P))
        self.gate_ranges = gate_ranges
        owner.append((len(cv.d), None))
        arm_of = np.concatenate([arm_of, np.full(len(cv.d) - len(arm_of), 255, np.uint8)])
        for (a0, c), (a1, _) in zip(owner[:-1], owner[1:]):
            arm_of[a0:a1] = c
        self.arms, self.phis, self.R, self.core = arms, phis, R, core
        self.feeders, self.gates, self.panels, self.wins = feeders, gates, panels, wins
        self.arm_of, self.box_delays = arm_of, list(box_delays)
        self.x = np.array([d["x"] for d in cv.d])
        self.y = np.array([d["y"] for d in cv.d])
        self.yaw = np.array([d["yaw"] for d in cv.d])
        self.z0 = np.array([d["z0"] for d in cv.d])
        self.kind = np.array([KIND_OF_CAT[k] for k in B.cat], np.uint8)
        self.always = [a["starter"] for a in arms] + [e for a in arms for e in a["const0"]]
        if verbose:
            print(f"built {len(cv.d)} dominoes, hub radius {R / 1000:.1f} m, {time.time() - t0:.1f} s")
        return self

    # ---- simulation helpers
    def graph(self):
        t0 = time.time()
        self.G = ev.build_graph(self.x, self.y, self.yaw, self.z0)
        self.Gq = quantise_graph(self.G)
        print(f"hit graph: {len(self.G['dst'])} edges, {time.time() - t0:.1f} s")
        return self.Gq

    def pushes(self, bits):
        p = [(i, 1, 0.0) for (i, b, v) in self.B.pushers if bool(bits[b]) == bool(v)]
        return p + [(i, 1, 0.0) for i in self.always]

    def run(self, bits, jitter=0.0, seed=0):
        """Returns (winner or None, list of lanes whose panel fell, fall ticks)."""
        if jitter:
            ft, fd = ev.simulate(self.Gq, self.pushes(bits), jitter=jitter, seed=seed)
        else:
            ft, fd = ev.simulate(self.Gq, self.pushes(bits))
        won = [c for c in range(10) if ft[self.wins[c]] >= 0]
        return (won[0] if len(won) == 1 else None), won, ft, fd

    def calibrate(self):
        """Run each lane alone and measure, in seconds: when the common line fires,
        and how far ahead of its own blocker each claim reaches its gate."""
        tC, lead, bias = [], [], []
        for c in range(10):
            ft, _ = ev.simulate(self.Gq, [(self.arms[c]["starter"], 1, 0.0)])
            g = self.gates[c]
            t_main = ft[g["main_last"]] * TICK + g["dm"]
            t_block = ft[g["inh_last"]] * TICK + g["di"]
            tC.append(ft[self.core["common"]] * TICK)
            lead.append(t_main - t_block)  # negative: the claim gets there first
            bias.append(int(ft[self.core["common"]] - ft[self.core["ins"][c]]))
        self.finish_bias = bias
        return np.array(tC), np.array(lead)

    def corrections(self):
        """New lane-start and claim-box delays from a calibration run."""
        P = self.P
        tC, lead = self.calibrate()
        T0 = max(tC[c] - P.eps * c for c in range(10))
        starts = [self.arms[c]["start_delay"] + (T0 + P.eps * c - tC[c]) for c in range(10)]
        boxes = [self.box_delays[c] + (-P.eps / 2 - lead[c]) for c in range(10)]
        return starts, boxes, tC, lead

    def validate(self, X, pred, jitter=0.0, seed=0, limit=None):
        """Winner by fallen panel against the network's own answer."""
        n = len(X) if limit is None else min(limit, len(X))
        agree = none = multi = 0
        bad, last = [], 0
        for d in range(n):
            w, won, ft, _ = self.run(X[d], jitter, seed * 100003 + d)
            agree += int(w == pred[d])
            none += int(len(won) == 0)
            multi += int(len(won) > 1)
            last = max(last, int(ft.max()))
            if w != pred[d]:
                bad.append((d, won, int(pred[d])))
        return dict(n=n, agree=agree, none=none, multi=multi, bad=bad[:10], last_s=last * TICK)
