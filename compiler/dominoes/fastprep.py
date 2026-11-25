"""Batch (numba) versions of dominoes.preprocess, for training and evaluation only.

``preprocess.py`` is the reference.  The functions here repeat its arithmetic in
the same order and are checked against it by ``python -m dominoes.fastprep``.
They also take the normalisation constants as arguments (for calibration) and
offer the augmentations used in training, all applied before block counting.
"""

import numpy as np
from numba import njit, prange

from . import preprocess as P

SIZE = P.SIZE


@njit(cache=True)
def _stamp(img, x0, y0, x1, y1, pen_r):
    r2 = pen_r * pen_r
    dx = x1 - x0
    dy = y1 - y0
    len2 = dx * dx + dy * dy
    jlo = int(np.floor(min(x0, x1) - pen_r)) - 1
    jhi = int(np.floor(max(x0, x1) + pen_r)) + 1
    ilo = int(np.floor(min(y0, y1) - pen_r)) - 1
    ihi = int(np.floor(max(y0, y1) + pen_r)) + 1
    if jlo < 0:
        jlo = 0
    if ilo < 0:
        ilo = 0
    if jhi > SIZE - 1:
        jhi = SIZE - 1
    if ihi > SIZE - 1:
        ihi = SIZE - 1
    for i in range(ilo, ihi + 1):
        py = i + 0.5
        for j in range(jlo, jhi + 1):
            if img[i, j]:
                continue
            px = j + 0.5
            if len2 == 0.0:
                ex = px - x0
                ey = py - y0
            else:
                t = ((px - x0) * dx + (py - y0) * dy) / len2
                if t < 0.0:
                    t = 0.0
                elif t > 1.0:
                    t = 1.0
                ex = px - (x0 + t * dx)
                ey = py - (y0 + t * dy)
            if ex * ex + ey * ey <= r2:
                img[i, j] = 1


@njit(cache=True)
def _strokes_image(pts, sptr, s0, s1, box_w, box_h, pen_r, max_aniso, max_slant, img):
    """pts: (P, 2) float64 (overwritten by the slant removal); strokes s0..s1-1 are
    pts[sptr[s]:sptr[s+1]]."""
    a = sptr[s0]
    b = sptr[s1]
    if b <= a:
        return
    minx = maxx = pts[a, 0]
    miny = maxy = pts[a, 1]
    for k in range(a, b):
        x = pts[k, 0]
        y = pts[k, 1]
        if x < minx:
            minx = x
        if x > maxx:
            maxx = x
        if y < miny:
            miny = y
        if y > maxy:
            maxy = y
    if max_slant > 0.0:
        ox = (minx + maxx) / 2.0
        oy = (miny + maxy) / 2.0
        S = 0.0
        Sx = 0.0
        Sy = 0.0
        Syy = 0.0
        Sxy = 0.0
        for s in range(s0, s1):
            for k in range(sptr[s], sptr[s + 1] - 1):
                ax = pts[k, 0] - ox
                ay = pts[k, 1] - oy
                bx = pts[k + 1, 0] - ox
                by = pts[k + 1, 1] - oy
                dx = bx - ax
                dy = by - ay
                L = np.sqrt(dx * dx + dy * dy)
                S += L
                Sx += L * (ax + bx) / 2.0
                Sy += L * (ay + by) / 2.0
                Syy += L * (ay * ay + ay * by + by * by) / 3.0
                Sxy += L * (2.0 * ax * ay + 2.0 * bx * by + ax * by + bx * ay) / 6.0
        m = 0.0
        if S > 0.0:
            ex = Sx / S
            ey = Sy / S
            vyy = Syy / S - ey * ey
            cxy = Sxy / S - ex * ey
            if vyy > 0.0:
                m = cxy / vyy
                if m > max_slant:
                    m = max_slant
                if m < -max_slant:
                    m = -max_slant
        if m != 0.0:
            for k in range(a, b):
                pts[k, 0] = pts[k, 0] - m * (pts[k, 1] - oy)
            minx = maxx = pts[a, 0]
            for k in range(a, b):
                x = pts[k, 0]
                if x < minx:
                    minx = x
                if x > maxx:
                    maxx = x
    w = maxx - minx
    h = maxy - miny
    tw = box_w - 2.0 * pen_r
    th = box_h - 2.0 * pen_r
    if w > 0.0 and h > 0.0:
        sx = tw / w
        sy = th / h
        if sx > max_aniso * sy:
            sx = max_aniso * sy
        if sy > max_aniso * sx:
            sy = max_aniso * sx
    elif h > 0.0:
        sx = 0.0
        sy = th / h
    elif w > 0.0:
        sx = tw / w
        sy = 0.0
    else:
        sx = 0.0
        sy = 0.0
    mx = (minx + maxx) / 2.0
    my = (miny + maxy) / 2.0
    half = SIZE / 2.0
    for s in range(s0, s1):
        p0 = sptr[s]
        p1 = sptr[s + 1]
        if p1 - p0 == 1:
            X = half + (pts[p0, 0] - mx) * sx
            Y = half + (pts[p0, 1] - my) * sy
            _stamp(img, X, Y, X, Y, pen_r)
        for k in range(p0, p1 - 1):
            X0 = half + (pts[k, 0] - mx) * sx
            Y0 = half + (pts[k, 1] - my) * sy
            X1 = half + (pts[k + 1, 0] - mx) * sx
            Y1 = half + (pts[k + 1, 1] - my) * sy
            _stamp(img, X0, Y0, X1, Y1, pen_r)


@njit(cache=True, parallel=True)
def strokes_batch(pts, sptr, dptr, idx, box_w, box_h, pen_r, max_aniso, max_slant, A):
    """Render digits idx (strokes dptr[d]..dptr[d+1]) -> (n, 32, 32) uint8.

    pen_r: (n,) pen radius per digit.  A: (n, 2, 2) linear map applied to the raw
    points before normalisation (identity for the canonical rendering)."""
    n = len(idx)
    out = np.zeros((n, SIZE, SIZE), np.uint8)
    for q in prange(n):
        d = idx[q]
        s0 = dptr[d]
        s1 = dptr[d + 1]
        a = sptr[s0]
        b = sptr[s1]
        loc = np.empty((b - a, 2), np.float64)
        for k in range(a, b):
            x = pts[k, 0]
            y = pts[k, 1]
            loc[k - a, 0] = A[q, 0, 0] * x + A[q, 0, 1] * y
            loc[k - a, 1] = A[q, 1, 0] * x + A[q, 1, 1] * y
        lptr = np.empty(s1 - s0 + 1, np.int64)
        for s in range(s0, s1 + 1):
            lptr[s - s0] = sptr[s] - a
        _strokes_image(loc, lptr, 0, s1 - s0, box_w, box_h, pen_r[q], max_aniso, max_slant, out[q])
    return out


@njit(cache=True)
def _bitmap_image(a, box_w, box_h, max_aniso, max_slant, out):
    H, W = a.shape
    n = 0
    sx1 = 0.0
    sy1 = 0.0
    for i in range(H):
        for j in range(W):
            if a[i, j]:
                n += 1
                sx1 += j + 0.5
                sy1 += i + 0.5
    if n == 0:
        return
    ex = sx1 / n
    ey = sy1 / n
    m = 0.0
    if max_slant > 0.0:
        syy = 0.0
        sxy = 0.0
        for i in range(H):
            for j in range(W):
                if a[i, j]:
                    syy += (i + 0.5 - ey) * (i + 0.5 - ey)
                    sxy += (j + 0.5 - ex) * (i + 0.5 - ey)
        if syy > 0.0:
            m = sxy / syy
            if m > max_slant:
                m = max_slant
            if m < -max_slant:
                m = -max_slant
    first = True
    minx = 0.0
    maxx = 0.0
    miny = 0.0
    maxy = 0.0
    for i in range(H):
        for j in range(W):
            if a[i, j]:
                x = j + 0.5 - m * (i + 0.5 - ey)
                y = i + 0.5
                if first:
                    minx = x
                    maxx = x
                    miny = y
                    maxy = y
                    first = False
                else:
                    if x < minx:
                        minx = x
                    if x > maxx:
                        maxx = x
                    if y < miny:
                        miny = y
                    if y > maxy:
                        maxy = y
    w = maxx - minx + 1.0
    h = maxy - miny + 1.0
    sx = box_w / w
    sy = box_h / h
    if sx > max_aniso * sy:
        sx = max_aniso * sy
    if sy > max_aniso * sx:
        sy = max_aniso * sx
    cx = (minx + maxx) / 2.0
    cy = (miny + maxy) / 2.0
    half = SIZE / 2.0
    for i in range(SIZE):
        ys = cy + (i + 0.5 - half) / sy
        v = int(np.floor(ys))
        if v < 0 or v >= H:
            continue
        for j in range(SIZE):
            u = int(np.floor(cx + (j + 0.5 - half) / sx + m * (v + 0.5 - ey)))
            if u < 0 or u >= W:
                continue
            if a[v, u]:
                out[i, j] = 1


@njit(cache=True, parallel=True)
def bitmaps_batch(imgs, box_w, box_h, max_aniso, max_slant):
    """(n, H, W) binary -> (n, 32, 32) uint8 through the canonical bitmap normalisation."""
    n = imgs.shape[0]
    out = np.zeros((n, SIZE, SIZE), np.uint8)
    for q in prange(n):
        _bitmap_image(imgs[q], box_w, box_h, max_aniso, max_slant, out[q])
    return out


@njit(cache=True, parallel=True)
def affine_bitmaps(imgs, A, canvas):
    """Warp binary bitmaps by the linear map A (n, 2, 2) about the image centre into a
    canvas x canvas frame (nearest neighbour, inverse mapping).  Augmentation only."""
    n, H, W = imgs.shape
    out = np.zeros((n, canvas, canvas), np.uint8)
    for q in prange(n):
        det = A[q, 0, 0] * A[q, 1, 1] - A[q, 0, 1] * A[q, 1, 0]
        i00 = A[q, 1, 1] / det
        i01 = -A[q, 0, 1] / det
        i10 = -A[q, 1, 0] / det
        i11 = A[q, 0, 0] / det
        for i in range(canvas):
            y = i + 0.5 - canvas / 2.0
            for j in range(canvas):
                x = j + 0.5 - canvas / 2.0
                u = int(np.floor(i00 * x + i01 * y + W / 2.0))
                v = int(np.floor(i10 * x + i11 * y + H / 2.0))
                if u >= 0 and u < W and v >= 0 and v < H and imgs[q, v, u]:
                    out[q, i, j] = 1
    return out


def thicken(imgs, mode):
    """Stroke-width augmentation on binary images.  mode per image: 0 none, 1 dilate
    (2x2), 2 dilate (3x3 cross), -1 erode (2x2)."""
    out = imgs.copy()
    m = mode == 1
    if m.any():
        a = imgs[m]
        d = a.copy()
        d[:, 1:, :] |= a[:, :-1, :]
        d[:, :, 1:] |= a[:, :, :-1]
        d[:, 1:, 1:] |= a[:, :-1, :-1]
        out[m] = d
    m = mode == 2
    if m.any():
        a = imgs[m]
        d = a.copy()
        d[:, 1:, :] |= a[:, :-1, :]
        d[:, :-1, :] |= a[:, 1:, :]
        d[:, :, 1:] |= a[:, :, :-1]
        d[:, :, :-1] |= a[:, :, 1:]
        out[m] = d
    m = mode == -1
    if m.any():
        a = imgs[m]
        d = a.copy()
        d[:, 1:, :] &= a[:, :-1, :]
        d[:, :, 1:] &= a[:, :, :-1]
        d[:, 1:, 1:] &= a[:, :-1, :-1]
        d[:, 0, :] = 0
        d[:, :, 0] = 0
        out[m] = d
    return out


def counts_batch(img32):
    """(n, 32, 32) binary -> (n, 8, 8) int counts."""
    n = img32.shape[0]
    return img32.reshape(n, 8, 4, 8, 4).sum((2, 4)).astype(np.int64)


@njit(cache=True)
def centre_batch(counts):
    """Bounding-box centring (floor rule) of every (8, 8) grid; same as preprocess.centre_counts."""
    n = counts.shape[0]
    out = np.zeros_like(counts)
    for q in range(n):
        top = -1
        bottom = -1
        left = -1
        right = -1
        for i in range(8):
            for j in range(8):
                if counts[q, i, j] > 0:
                    if top < 0:
                        top = i
                    bottom = i
                    if left < 0 or j < left:
                        left = j
                    if j > right:
                        right = j
        if top < 0:
            continue
        dy = (7 - (top + bottom)) // 2
        dx = (7 - (left + right)) // 2
        for i in range(8):
            si = i - dy
            if si < 0 or si >= 8:
                continue
            for j in range(8):
                sj = j - dx
                if sj < 0 or sj >= 8:
                    continue
                out[q, i, j] = counts[q, si, sj]
    return out


def bits_batch(counts, thresholds, centre=True):
    """(n, 8, 8) counts -> (n, 192) uint8 bits (same layout as preprocess.counts_to_bits)."""
    c = centre_batch(np.ascontiguousarray(counts, dtype=np.int64)) if centre else counts
    X = c.reshape(len(c), 64)
    return np.concatenate([(X > t) for t in thresholds], axis=1).astype(np.uint8)


def identity(n):
    A = np.zeros((n, 2, 2))
    A[:, 0, 0] = 1.0
    A[:, 1, 1] = 1.0
    return A


def random_linear(rng, n, rot_deg, shear, scale):
    """Random linear maps: rotation (degrees, sd), horizontal shear (sd), log-scale per axis (sd)."""
    th = np.clip(rng.normal(0, rot_deg, n), -2.5 * rot_deg, 2.5 * rot_deg) * np.pi / 180
    sh = np.clip(rng.normal(0, shear, n), -2.5 * shear, 2.5 * shear)
    gx = np.exp(np.clip(rng.normal(0, scale, n), -2.5 * scale, 2.5 * scale))
    gy = np.exp(np.clip(rng.normal(0, scale, n), -2.5 * scale, 2.5 * scale))
    A = np.zeros((n, 2, 2))
    c, s = np.cos(th), np.sin(th)
    # A = R(th) @ Shear(sh) @ diag(gx, gy)
    A[:, 0, 0] = c * gx
    A[:, 0, 1] = (c * sh - s) * gy
    A[:, 1, 0] = s * gx
    A[:, 1, 1] = (s * sh + c) * gy
    return A


def pen_strokes(z, part):
    """Load pendigits-orig strokes (prepared file) as float points with y downward."""
    pts = z[part + "_pts"].astype(np.float64)
    pts[:, 1] = -pts[:, 1]  # tablet y is upward
    return pts, z[part + "_sptr"], z[part + "_dptr"], z[part + "_y"]


def digit_strokes(pts, sptr, dptr, d):
    return [[(float(x), float(y)) for x, y in pts[sptr[s] : sptr[s + 1]]] for s in range(dptr[d], dptr[d + 1])]


if __name__ == "__main__":
    import os

    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    z = np.load(os.path.join(here, "data", "prepared", "pendigits_orig.npz"))
    pts, sptr, dptr, y = pen_strokes(z, "tra")
    rng = np.random.default_rng(0)
    idx = rng.choice(len(y), 2000, replace=False)
    fast = strokes_batch(
        pts, sptr, dptr, idx, P.BOX_W, P.BOX_H, np.full(len(idx), P.PEN_R), P.MAX_ANISO, P.MAX_SLANT, identity(len(idx))
    )
    bad = 0
    for q, d in enumerate(idx):
        ref = P.strokes_to_image(digit_strokes(pts, sptr, dptr, d))
        bad += int((ref != fast[q]).any())
    print("strokes: fast vs reference, differing images:", bad, "of", len(idx))
    m = np.load(os.path.join(here, "data", "prepared", "mnist.npz"))
    imgs = (m["train_img"][:500] > 127).astype(np.uint8)
    fast = bitmaps_batch(imgs, P.BOX_W, P.BOX_H, P.MAX_ANISO, P.MAX_SLANT)
    bad = sum(int((P.image_to_image32(imgs[q]) != fast[q]).any()) for q in range(len(imgs)))
    print("bitmaps: fast vs reference, differing images:", bad, "of", len(imgs))
    c = counts_batch(fast)
    bad = sum(int((P.counts_to_bits(c[q]) != bits_batch(c[q : q + 1], P.THRESHOLDS)[0]).any()) for q in range(len(c)))
    bad += sum(int((P.block_counts(fast[q]) != c[q]).any()) for q in range(len(c)))
    print("counts/bits: fast vs reference, differing:", bad)
