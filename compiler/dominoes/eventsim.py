"""Event-level domino automaton.

The hit graph is derived from the placed geometry only (positions, yaw, base
height), never from the compiler's netlist.  Domino i falling in direction s
(+1 along its yaw, -1 against) sweeps a strip of width W from its back face to
reach H; any domino j whose footprint intersects that strip, at a compatible
height, is hit.  j then falls along its own axis in the direction closer to the
push; if the push is more than ~53 degrees off j's axis, j is knocked aside and
does not propagate.  Each domino falls at most once (first hit wins), so
head-on collisions annihilate naturally.  Delays come from the rigid-body chain
calibration (interval vs spacing)."""

import math

import numba as nb
import numpy as np
from scipy.spatial import cKDTree

H, W, T = 48.0, 24.0, 7.5
CAL_D = np.array([0, 16, 20, 24, 28, 32, 36, 40, 44, 48.0])
CAL_T = np.array([5, 18.8, 24.2, 30.0, 36.0, 42.3, 49.4, 57.5, 66.0, 76.0]) / 1000.0
COS_PROP = 0.6


def tau(D):
    return np.interp(D, CAL_D, CAL_T)


def rect_corners(cx, cy, yaw, hl, hw):
    c, s = math.cos(yaw), math.sin(yaw)
    u = np.array([c, s])
    v = np.array([-s, c])
    ctr = np.array([cx, cy])
    return np.array([ctr + u * a * hl + v * b * hw for a, b in ((1, 1), (1, -1), (-1, -1), (-1, 1))])


def sat_overlap(P, Q):
    for poly in (P, Q):
        for k in range(4):
            e = poly[(k + 1) % 4] - poly[k]
            n = np.array([-e[1], e[0]])
            a = P @ n
            b = Q @ n
            if a.max() < b.min() - 1e-9 or b.max() < a.min() - 1e-9:
                return False
    return True


def _corners(cx, cy, ux, uy, hl, hw):
    """Vectorised rectangle corners: arrays (...,4,2)."""
    vx, vy = -uy, ux
    out = np.empty(cx.shape + (4, 2))
    for k, (a, b) in enumerate(((1, 1), (1, -1), (-1, -1), (-1, 1))):
        out[..., k, 0] = cx + ux * a * hl + vx * b * hw
        out[..., k, 1] = cy + uy * a * hl + vy * b * hw
    return out


def _sat(P, Q):
    """Vectorised separating-axis test for convex quads P, Q of shape (M,4,2)."""
    ok = np.ones(P.shape[0], bool)
    for poly in (P, Q):
        for k in range(2):
            e = poly[:, (k + 1) % 4] - poly[:, k]
            n = np.stack([-e[:, 1], e[:, 0]], 1)
            a = np.einsum("mkd,md->mk", P, n)
            b = np.einsum("mkd,md->mk", Q, n)
            ok &= ~((a.max(1) < b.min(1) - 1e-9) | (b.max(1) < a.min(1) - 1e-9))
    return ok


def build_graph(x, y, yaw, z0, reach=H, min_contact=8.0):
    N = len(x)
    tree = cKDTree(np.c_[x, y])
    pairs = tree.query_pairs(reach + W, output_type="ndarray")
    I = np.concatenate([pairs[:, 0], pairs[:, 1]])
    J = np.concatenate([pairs[:, 1], pairs[:, 0]])
    fx, fy = np.cos(yaw), np.sin(yaw)
    out = []
    for s in (1, -1):
        dx, dy = fx[I] * s, fy[I] * s
        relx, rely = x[J] - x[I], y[J] - y[I]
        along = relx * dx + rely * dy
        m = along > T / 2
        Ii, Jj, dxm, dym, al = I[m], J[m], dx[m], dy[m], along[m]
        # strip from back face to pivot + reach
        cx = x[Ii] + dxm * reach / 2
        cy = y[Ii] + dym * reach / 2
        P = _corners(cx, cy, dxm, dym, (reach + T) / 2, W / 2)
        Q = _corners(x[Jj], y[Jj], fx[Jj], fy[Jj], T / 2, W / 2)
        ok = _sat(P, Q)
        proj = Q[..., 0] * dxm[:, None] + Q[..., 1] * dym[:, None]
        r_near = proj.min(1) - (x[Ii] * dxm + y[Ii] * dym) - T / 2
        ok &= r_near < reach
        dz = z0[Jj] - z0[Ii]
        top_h = np.sqrt(np.maximum(reach**2 - np.maximum(r_near, 0) ** 2, 0))
        ok &= ~((dz > 0) & (top_h - dz < min_contact))
        ok &= ~(dz < -H)
        # a falling domino is stopped by the first thing it meets: keep only the nearest target(s)
        rn = np.where(ok, r_near, np.inf)
        rmin = np.full(N, np.inf)
        np.minimum.at(rmin, Ii, rn)
        ok &= rn <= rmin[Ii] + 6.0
        cj = fx[Jj] * dxm + fy[Jj] * dym
        sj = np.where(np.abs(cj) < COS_PROP, 0, np.where(cj > 0, 1, -1))
        extra = np.where(dz > 0, 0.034e-3 * z0[Jj] ** 2, 0.0)
        out.append((Ii[ok], np.full(ok.sum(), s), Jj[ok], sj[ok], tau(np.maximum(al[ok], 1.0)) + extra[ok]))
    src = np.concatenate([o[0] for o in out])
    sdir = np.concatenate([o[1] for o in out])
    dst = np.concatenate([o[2] for o in out])
    ddir = np.concatenate([o[3] for o in out])
    dly = np.concatenate([o[4] for o in out])
    key = src * 2 + (sdir < 0)
    order = np.argsort(key, kind="stable")
    key = key[order]
    indptr = np.zeros(2 * N + 1, np.int64)
    np.add.at(indptr, key + 1, 1)
    indptr = np.cumsum(indptr)
    return dict(
        N=N,
        indptr=indptr,
        dst=dst[order].astype(np.int64),
        ddir=ddir[order].astype(np.int64),
        dly=dly[order].astype(np.float64),
    )


@nb.njit(cache=True)
def _sim(N, indptr, dst, ddir, dly, p_idx, p_dir, p_t, jit, Tmax):
    fall_t = np.full(N, -1.0)
    fall_d = np.zeros(N, np.int64)
    done = np.zeros(N, np.bool_)
    cap = len(dst) + len(p_idx) + 16
    ht = np.empty(cap)
    hi = np.empty(cap, np.int64)
    hd = np.empty(cap, np.int64)
    n = 0
    for k in range(len(p_idx)):
        # push
        ht[n] = p_t[k]
        hi[n] = p_idx[k]
        hd[n] = p_dir[k]
        c = n
        n += 1
        while c > 0:
            p = (c - 1) // 2
            if ht[p] <= ht[c]:
                break
            ht[p], ht[c] = ht[c], ht[p]
            hi[p], hi[c] = hi[c], hi[p]
            hd[p], hd[c] = hd[c], hd[p]
            c = p
    while n > 0:
        t = ht[0]
        i = hi[0]
        s = hd[0]
        n -= 1
        ht[0] = ht[n]
        hi[0] = hi[n]
        hd[0] = hd[n]
        c = 0
        while True:
            l = 2 * c + 1
            r = l + 1
            m = c
            if l < n and ht[l] < ht[m]:
                m = l
            if r < n and ht[r] < ht[m]:
                m = r
            if m == c:
                break
            ht[m], ht[c] = ht[c], ht[m]
            hi[m], hi[c] = hi[c], hi[m]
            hd[m], hd[c] = hd[c], hd[m]
            c = m
        if done[i] or t > Tmax:
            continue
        done[i] = True
        fall_t[i] = t
        fall_d[i] = s
        if s == 0:
            continue
        b = 2 * i + (1 if s < 0 else 0)
        for e in range(indptr[b], indptr[b + 1]):
            j = dst[e]
            if done[j]:
                continue
            tt = t + dly[e] * jit[e]
            ht[n] = tt
            hi[n] = j
            hd[n] = ddir[e]
            c = n
            n += 1
            while c > 0:
                p = (c - 1) // 2
                if ht[p] <= ht[c]:
                    break
                ht[p], ht[c] = ht[c], ht[p]
                hi[p], hi[c] = hi[c], hi[p]
                hd[p], hd[c] = hd[c], hd[p]
                c = p
    return fall_t, fall_d


def simulate(G, pushes, jitter=0.0, seed=0, Tmax=1e9):
    p_idx = np.array([p[0] for p in pushes], np.int64)
    p_dir = np.array([p[1] for p in pushes], np.int64)
    p_t = np.array([p[2] for p in pushes], np.float64)
    if jitter > 0:
        jit = np.random.default_rng(seed).uniform(1 - jitter, 1 + jitter, len(G["dst"]))
    else:
        jit = np.ones(len(G["dst"]))
    return _sim(G["N"], G["indptr"], G["dst"], G["ddir"], G["dly"], p_idx, p_dir, p_t, jit, Tmax)


def graph_from_canvas(cv):
    x = np.array([d["x"] for d in cv.d])
    y = np.array([d["y"] for d in cv.d])
    yaw = np.array([d["yaw"] for d in cv.d])
    z0 = np.array([d["z0"] for d in cv.d])
    return build_graph(x, y, yaw, z0)
