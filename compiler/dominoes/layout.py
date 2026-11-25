"""Place-and-route: forest of simplified trees -> placed dominoes.

Every signal is a horizontal 'rail' (a line of dominoes in a row, rows ROW apart)
flowing in +x.  A gate instance occupies a band of rows; its two children are
stacked inside the band (X above Y).  Gate program: split rails that are used
twice, sort rails into the order the gadgets need with bridge swaps
(odd-even transposition), place rails into gadget slots with S-bends, run
reversed-inhibit (RINH) and merge gadgets side by side, merge XOR pairs,
compact the outputs.  Static timing (min/max arrival per rail, using the same
delay model as the event simulator) sizes every RINH segment so the inhibitor
arrives early enough.  Each instance is a private copy (trees are unrolled), so
there is no global routing."""


import numpy as np

from . import eventsim as ev
from .gadgets import *

LEAD_REQ = 0.55  # required inhibitor lead at S_q (s); physics-validated design point ~0.45 s + margin
RINH_X_LEFT = 24 + 141  # x_q - x0 so that the inhibitor approach fits after x0
RINH_RIGHT = 100  # right extent beyond S_1


class Rail:
    __slots__ = ("row", "x", "last", "lo", "hi", "label")

    def __init__(self, row, x, last, lo, hi, label):
        self.row, self.x, self.last, self.lo, self.hi, self.label = row, x, last, lo, hi, label


class Builder:
    def __init__(self):
        self.cv = Canvas()
        self.pushers = []  # (domino index, bit, value)
        self.stats = dict(rinh=0, merge=0, split=0, swap=0, q_total=0, q_max=0)
        self.cat = []  # category per domino (for the breakdown)
        self.cur_cat = "wire"
        self.x_origin = 0.0

    # ---------- bookkeeping
    def _tag(self, n0):
        self.cat += [self.cur_cat] * (len(self.cv.d) - n0)

    def P(self, i):
        d = self.cv.d[i]
        return np.array([d["x"], d["y"]])

    def delay(self, prev, idxs):
        t = 0.0
        p = prev
        for i in idxs:
            t += float(ev.tau(np.linalg.norm(self.P(i) - self.P(p))))
            dz = self.cv.d[i]["z0"] - self.cv.d[p]["z0"]
            if dz > 0:
                t += 0.034e-3 * self.cv.d[i]["z0"] ** 2
            p = i
        return t

    # ---------- primitives on rails
    def new_rail(self, row, x, bit, value, label):
        n0 = len(self.cv.d)
        self.cur_cat = "input"
        x = x + self.x_origin
        i = self.cv.add(x, row * ROW, 0.0, tag="in")
        self._tag(n0)
        self.pushers.append((i, bit, value))
        return Rail(row, x, i, 0.0, 0.0, label)

    def extend(self, r, x_to, cat="wire"):
        if x_to - r.x < 12:
            return
        n0 = len(self.cv.d)
        self.cur_cat = cat
        idx = self.cv.path([(r.x, r.row * ROW), (x_to, r.row * ROW)], start_gap=PITCH, end_exact=True)
        self._tag(n0)
        d = self.delay(r.last, idx)
        r.last = idx[-1]
        r.x = self.cv.d[idx[-1]]["x"]
        r.lo += d
        r.hi += d

    def place(self, rails, rows, cat="wire"):
        """S-bend each rail (all at the same x) to its target row; order preserving."""
        x0 = max(r.x for r in rails)
        for r in rails:
            self.extend(r, x0, cat)
        k = max(abs(r.row - t) for r, t in zip(rails, rows))
        if k == 0:
            return
        L = max(96.0, 80.0 * k)
        n0 = len(self.cv.d)
        self.cur_cat = cat
        for r, t in zip(rails, rows):
            idx = self.cv.path([(x0, r.row * ROW), (x0 + L, t * ROW)], start_gap=PITCH, end_exact=True)
            d = self.delay(r.last, idx)
            r.last = idx[-1]
            r.x = self.cv.d[idx[-1]]["x"]
            r.row = t
            r.lo += d
            r.hi += d
        self._tag(n0)

    def do_split(self, r, label_a, label_b):
        """r at row; copies at rows r.row and r.row-1 (row below must be free)."""
        n0 = len(self.cv.d)
        self.cur_cat = "split"
        xJ, y = r.x, r.row * ROW
        ia, ib, xe = split(self.cv, xJ, y, 0.0, -ROW)
        self._tag(n0)
        da = self.delay(r.last, ia)
        db = self.delay(r.last, ib)
        a = Rail(r.row, self.cv.d[ia[-1]]["x"], ia[-1], r.lo + da, r.hi + da, label_a)
        b = Rail(r.row - 1, self.cv.d[ib[-1]]["x"], ib[-1], r.lo + db, r.hi + db, label_b)
        self.stats["split"] += 1
        return a, b

    def do_swap(self, upper, lower):
        n0 = len(self.cv.d)
        self.cur_cat = "crossover"
        x0 = upper.x
        A, B, xe = bridge_swap(self.cv, x0, lower.row * ROW, upper.row * ROW)
        self._tag(n0)
        dA = self.delay(lower.last, A)
        dB = self.delay(upper.last, B)
        lower.last, lower.x, lower.lo, lower.hi, lower.row = (
            A[-1],
            self.cv.d[A[-1]]["x"],
            lower.lo + dA,
            lower.hi + dA,
            upper.row,
        )
        upper.last, upper.x, upper.lo, upper.hi = B[-1], self.cv.d[B[-1]]["x"], upper.lo + dB, upper.hi + dB
        upper.row = upper.row - 1
        self.stats["swap"] += 1

    def do_merge(self, a, b, label):
        """a above b, adjacent rows, same x.  Output at a.row."""
        n0 = len(self.cv.d)
        self.cur_cat = "gate"
        ia, ib, J = merge(self.cv, a.x, a.row * ROW, b.row * ROW, a.row * ROW)
        self._tag(n0)
        da = self.delay(a.last, ia + [J])
        db = self.delay(b.last, ib + [J])
        self.stats["merge"] += 1
        return Rail(a.row, self.cv.d[J]["x"], J, min(a.lo + da, b.lo + db), max(a.hi + da, b.hi + db), label)

    def do_rinh(self, m, i, x0, label, q_fixed=None):
        """m at row R+4, i at row R+2 (R = m.row-4).  Sizes q from static timing,
        or uses q_fixed.  The gadget's indices are left in self.last_gadget."""
        R = m.row - 4
        # trial geometry to measure delays, then pick q
        # lead grows by ~2*tau(24) per extra segment domino; jump close to the answer first
        q = q_fixed or 4
        for it in range(200):
            tmp = Canvas()
            x_r = x0 + RINH_X_LEFT + 24 * (q - 1)
            g = rinh(tmp, x_r, R * ROW, side=+1, q=q)

            # main delay to S_q (lo) and inhibitor delay to S_q (hi), measured on the temp canvas
            def pd(start, idxs):
                t = 0.0
                p = np.asarray(start)
                for k in idxs:
                    pk = np.array([tmp.d[k]["x"], tmp.d[k]["y"]])
                    t += float(ev.tau(np.linalg.norm(pk - p)))
                    p = pk
                return t

            # main: from its row line end (main_start) along arc -> S_1 .. S_q
            d_m_row = (g["main_start"][0] - m.x) / PITCH * float(ev.tau(PITCH))
            d_i_row = (g["inh_start"][0] - i.x) / PITCH * float(ev.tau(PITCH))
            d_m = d_m_row + pd(g["main_start"], g["main_arc"] + g["seg"][:q])
            d_i = d_i_row + pd(g["inh_start"], g["inh_arc"] + [g["Sq"]])
            lead = (m.lo + d_m) - (i.hi + d_i)
            if q_fixed or lead >= LEAD_REQ:
                break
            q += max(1, int((LEAD_REQ - lead) / (2 * float(ev.tau(PITCH)))))
        n0 = len(self.cv.d)
        self.cur_cat = "gate"
        g = rinh(self.cv, x_r, R * ROW, side=+1, q=q)
        g["q"] = q
        self.last_gadget = g
        self._tag(n0)
        self.cur_cat = "gate"
        n1 = len(self.cv.d)
        # connect the row lines to the gadget's start points
        mi = self.cv.path([(m.x, m.row * ROW), tuple(g["main_start"])], start_gap=PITCH, end_exact=True)
        ii = self.cv.path([(i.x, i.row * ROW), tuple(g["inh_start"])], start_gap=PITCH, end_exact=True)
        self.cur_cat = "inh-feed"
        self._tag(n1)
        path_m = mi + g["main_arc"] + g["seg"] + g["ex"]
        d_out_lo = self.delay(m.last, path_m)
        self.stats["rinh"] += 1
        self.stats["q_total"] += q
        self.stats["q_max"] = max(self.stats["q_max"], q)
        out = Rail(R - 2, self.cv.d[g["ex"][-1]]["x"], g["ex"][-1], m.lo + d_out_lo, m.hi + d_out_lo, label)
        x_end = x_r + RINH_RIGHT
        return out, x_end, lead

    def sync(self, cat):
        """Give every domino added directly to the canvas since the last tag this category."""
        self.cat += [cat] * (len(self.cv.d) - len(self.cat))

    def do_delay(self, r, seconds, n_pairs=4, h_max=4000.0):
        """Insert a serpentine above the rail so that the delay from its current last
        domino to its new last domino is `seconds` (to within a few ms).  The rail
        advances 144 mm per bump whatever the delay, so nothing downstream moves."""
        from .paths import chain_delay

        def trial(h):
            tmp = Canvas()
            p = tmp.add(r.x, r.row * ROW, 0.0)
            return chain_delay(tmp, p, serpentine(tmp, r.x, r.row * ROW, n_pairs, h))

        lo, hi = PITCH, h_max
        if trial(lo) > seconds + 0.02:
            raise ValueError(f"delay {seconds:.3f} s is below the minimum {trial(lo):.3f} s for {n_pairs} bumps")
        if trial(hi) < seconds:
            raise ValueError("delay too long for the box")
        for _ in range(40):
            mid = (lo + hi) / 2
            if trial(mid) < seconds:
                lo = mid
            else:
                hi = mid
        h = (lo + hi) / 2
        n0 = len(self.cv.d)
        idx = serpentine(self.cv, r.x, r.row * ROW, n_pairs, h)
        self.sync("wire")
        d = chain_delay(self.cv, r.last, idx)
        r.last = idx[-1]
        r.x = self.cv.d[idx[-1]]["x"]
        r.lo += d
        r.hi += d
        return d, h

    # ---------- sorting with bridges
    def sort_rails(self, rails, target_labels, top):
        pos = {}
        for k, lab in enumerate(target_labels):
            pos.setdefault(lab, []).append(k)
        # assign target positions to duplicates in order of appearance
        used = {}
        key = []
        for r in rails:
            lst = pos[r.label]
            u = used.get(r.label, 0)
            key.append(lst[u])
            used[r.label] = u + 1
        order = list(range(len(rails)))
        cur = rails[:]
        kk = key[:]
        stage = 0
        while kk != sorted(kk):
            pairs = [j for j in range(stage % 2, len(cur) - 1, 2) if kk[j] > kk[j + 1]]
            stage += 1
            if not pairs:
                continue
            self.place(cur, [top - j for j in range(len(cur))])
            x0 = max(r.x for r in cur)
            for r in cur:
                self.extend(r, x0)
            for j in pairs:
                self.do_swap(cur[j], cur[j + 1])
                cur[j], cur[j + 1] = cur[j + 1], cur[j]
                kk[j], kk[j + 1] = kk[j + 1], kk[j]
            x1 = max(r.x for r in cur)
            for r in cur:
                self.extend(r, x1)
        return cur


def swaps_needed(seq_labels, target):
    pos = {}
    for k, lab in enumerate(target):
        pos.setdefault(lab, []).append(k)
    used = {}
    key = []
    for lab in seq_labels:
        u = used.get(lab, 0)
        key.append(pos[lab][u])
        used[lab] = u + 1
    return sum(1 for a in range(len(key)) for b in range(a + 1, len(key)) if key[a] > key[b])


class Compiler:
    def __init__(self, F, right_align=True, wmemo=None):
        self.F = F
        self.B = Builder()
        self.leads = []
        self.trace = []
        self.right_align = right_align
        self.wmemo = {} if wmemo is None else wmemo
        self.swap = self.wmemo.setdefault("swap", {})

    def kind(self, nid):
        """A gate's node, with its operands ordered so that the one that arrives
        later is the main signal and the earlier one is the blocker.  AND and XOR
        are symmetric, and a blocker that is early costs nothing, whereas a main
        that is early has to be held back with a longer gate."""
        k = self.F.kind[nid]
        if not self.right_align or k[0] not in ("and", "xor"):
            return k
        if nid not in self.swap:
            a, b = (k[1], k[3]) if k[0] == "and" else (k[1], k[2])
            self.swap[nid] = self.width(a, {0, 1}) < self.width(b, {0, 1})
        if not self.swap[nid]:
            return k
        return ("and", k[3], k[4], k[1], k[2]) if k[0] == "and" else ("xor", k[2], k[1])

    def width(self, nid, need):
        """How far a subtree's outputs end beyond its own leaves when it is compiled
        alone.  Used to start shallow subtrees further along instead of padding
        their outputs with wire: leaves are starter dominoes and can stand anywhere."""
        if self.F.kind[nid][0] == "in":
            return 0.0
        key = (nid, frozenset(need))
        if key not in self.wmemo:
            dry = Compiler(self.F, True, self.wmemo)
            self.wmemo[key] = max(r.x for r in dry.compile(nid, set(need), 0, "W"))
        return self.wmemo[key]

    # rows needed for each instance (bottom-up), with needed output values
    def need_children(self, nid, need):
        k = self.kind(nid)
        if k[0] == "and":
            _, X, nx, Y, ny = k
            nX = set()
            nY = {ny}
            if 1 in need:
                nX.add(1 ^ nx)
            if 0 in need:
                nX.add(nx)
            return [(X, nX), (Y, nY)]
        if k[0] == "xor":
            return [(k[1], {0, 1}), (k[2], {0, 1})]
        return []

    def height(self, nid, need):
        k = self.kind(nid)
        if k[0] == "in":
            return len(need)
        ch = self.need_children(nid, need)
        hs = sum(self.height(c, n) for c, n in ch)
        if k[0] == "and":
            hp = 11 if len(need) == 2 else (8 if 1 in need else 3)
        else:
            hp = 34 if len(need) == 2 else 18
        return max(hs, hp)

    def compile(self, nid, need, top, inst_tag):
        """Returns list of output rails (labels (inst_tag, value)) and band height."""
        k = self.kind(nid)
        B = self.B
        if k[0] == "in":
            rails = []
            for j, v in enumerate(sorted(need, reverse=True)):
                rails.append(B.new_rail(top - j, 0.0, k[1], v, (inst_tag, v)))
            for r in rails:
                self.trace.append((nid, r.label[1], r, "in"))
            return rails
        ch = self.need_children(nid, need)
        HX = self.height(ch[0][0], ch[0][1])
        x_org = B.x_origin
        if self.right_align:
            wX, wY = self.width(ch[0][0], ch[0][1]), self.width(ch[1][0], ch[1][1])
            B.x_origin = x_org + max(wX, wY) - wX
        rX = self.compile(ch[0][0], ch[0][1], top, inst_tag + "X")
        if self.right_align:
            B.x_origin = x_org + max(wX, wY) - wY
        rY = self.compile(ch[1][0], ch[1][1], top - HX, inst_tag + "Y")
        B.x_origin = x_org
        rails = rX + rY
        x0 = max(r.x for r in rails)
        for r in rails:
            B.extend(r, x0, cat="align")
        if k[0] == "and":
            outs = self.prog_and(k, need, rX, rY, top, inst_tag)
        else:
            outs = self.prog_xor(need, rX, rY, top, inst_tag)
        for r in outs:
            self.trace.append((nid, r.label[1], r, k[0]))
        return outs

    def lab(self, r):
        return r.label[1]

    def prog_and(self, k, need, rX, rY, top, tag):
        _, X, nx, Y, ny = k
        B = self.B
        # relabel: 'm' = X value (1^nx), 'g' = X value nx, 'i' = Y value ny
        for r in rX:
            r.label = (tag, "m" if r.label[1] == (1 ^ nx) else "g")
        for r in rY:
            r.label = (tag, "i")
        rails = rX + rY
        if need == {0, 1}:
            # split i
            B.place(rails, [top - j for j in range(len(rails))])
            ri = rails[-1]
            a, b = B.do_split(ri, (tag, "i"), (tag, "i"))
            rails = rails[:-1] + [a, b]
            x1 = max(r.x for r in rails)
            for r in rails:
                B.extend(r, x1)
            target = ["m", "i", "g", "i"]
            rails = (
                B.sort_rails_lab(rails, target, top) if hasattr(B, "sort_rails_lab") else self.sort(rails, target, top)
            )
            m, i1, g, i2 = rails
            B.place(rails, [top, top - 2, top - 8, top - 9])
            x0 = max(r.x for r in rails)
            for r in rails:
                B.extend(r, x0)
            o1, xe1, lead = B.do_rinh(m, i1, x0, (tag, 1))
            self.leads.append(lead)
            o0 = B.do_merge(g, i2, (tag, 0))
            xe = max(xe1, o0.x)
            B.extend(o1, xe)
            B.extend(o0, xe)
            outs = [o1, o0]
        elif need == {1}:
            target = ["m", "i"]
            rails = self.sort(rails, target, top)
            m, i1 = rails
            B.place(rails, [top, top - 2])
            x0 = max(r.x for r in rails)
            for r in rails:
                B.extend(r, x0)
            o1, xe1, lead = B.do_rinh(m, i1, x0, (tag, 1))
            self.leads.append(lead)
            B.extend(o1, xe1)
            outs = [o1]
        else:
            target = ["g", "i"]
            rails = self.sort(rails, target, top)
            B.place(rails, [top, top - 1])
            o0 = B.do_merge(rails[0], rails[1], (tag, 0))
            outs = [o0]
        B.place(outs, [top - j for j in range(len(outs))])
        return outs

    def sort(self, rails, target, top):
        for r in rails:
            r.label = (r.label[0], r.label[1])
        # sort by label using the Builder's bridge sorter
        lab_rails = rails
        tl = [(rails[0].label[0], t) for t in target]
        return self.B.sort_rails(lab_rails, tl, top)

    def prog_xor(self, need, rX, rY, top, tag):
        B = self.B
        for r in rX:
            r.label = (tag, "x%d" % r.label[1])
        for r in rY:
            r.label = (tag, "y%d" % r.label[1])
        # minterm groups (main from X, inhibitor from Y)
        g1 = [[("x1", "y1"), ("x0", "y0")]] if 1 in need else []  # out1
        g0 = [[("x1", "y0"), ("x0", "y1")]] if 0 in need else []  # out0
        groups = [(1, g1[0])] if g1 else []
        if g0:
            groups.append((0, g0[0]))
        rails = rX + rY
        # splits if both outputs needed
        if need == {0, 1}:
            B.place(rails, [top - 2 * j for j in range(len(rails))])
            new = []
            for r in rails:
                a, b = B.do_split(r, r.label, r.label)
                new += [a, b]
            rails = new
            x1 = max(r.x for r in rails)
            for r in rails:
                B.extend(r, x1)
        seq = [r.label[1] for r in rails]
        best = None
        import itertools

        for gperm in itertools.permutations(range(len(groups))):
            for flips in itertools.product([0, 1], repeat=len(groups)):
                tgt = []
                for gi, f in zip(gperm, flips):
                    pr = groups[gi][1][::-1] if f else groups[gi][1]
                    for a, b in pr:
                        tgt += [a, b]
                s = swaps_needed(seq, tgt)
                if best is None or s < best[0]:
                    best = (
                        s,
                        tgt,
                        [(groups[gi][0], groups[gi][1][::-1] if f else groups[gi][1]) for gi, f in zip(gperm, flips)],
                    )
        _, tgt, order = best
        rails = self.sort(rails, tgt, top)
        # place into RINH slots: pair j -> main at top-7j, inh at top-7j-2
        rows = []
        for j in range(len(rails) // 2):
            rows += [top - 8 * j, top - 8 * j - 2]
        B.place(rails, rows)
        x0 = max(r.x for r in rails)
        for r in rails:
            B.extend(r, x0)
        exits = []
        xe = x0
        for j in range(len(rails) // 2):
            o, x_e, lead = B.do_rinh(rails[2 * j], rails[2 * j + 1], x0, (tag, "e%d" % j))
            self.leads.append(lead)
            exits.append(o)
            xe = max(xe, x_e)
        for o in exits:
            B.extend(o, xe)
        outs = []
        for gidx, (val, _) in enumerate(order):
            a, b = exits[2 * gidx], exits[2 * gidx + 1]
            B.place([a, b], [a.row, a.row - 1])
            outs.append(B.do_merge(a, b, (tag, val)))
        x1 = max(o.x for o in outs)
        for o in outs:
            B.extend(o, x1)
        B.place(outs, [top - j for j in range(len(outs))])
        return outs
