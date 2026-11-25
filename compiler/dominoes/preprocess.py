"""Canonical drawing -> input bits.  This file is the reference; the web page ports it.

    strokes --normalise--> 32x32 binary image --4x4 block counts--> 8x8 counts (0..16)
            --centre (bbox, floor rule)--> --three thresholds--> 192 bits

Everything is plain IEEE-754 double arithmetic (+ - * / sqrt, comparisons, floor)
in a fixed order, with explicit loops, so a TypeScript port gives bit-identical
results (Math.sqrt is correctly rounded, like math.sqrt).  No randomness, no
library rasteriser, no trigonometry.  Coordinates must be finite numbers.

Normalisation of strokes (pad coordinates, any scale, y downward)
-----------------------------------------------------------------
Empty strokes are dropped; no points at all gives an all-zero grid.

1. Bounding box of all stroke points: minx, maxx, miny, maxy.
2. Slant removal.  With ox = (minx + maxx) / 2 and oy = (miny + maxy) / 2, sum
   over every segment (a -> b, coordinates taken relative to (ox, oy)), in
   stroke order then segment order, all sums starting at 0:
       dx = bx - ax; dy = by - ay
       L    = sqrt(dx*dx + dy*dy)
       S   += L
       Sx  += L * (ax + bx) / 2
       Sy  += L * (ay + by) / 2
       Syy += L * (ay*ay + ay*by + by*by) / 3
       Sxy += L * (2*ax*ay + 2*bx*by + ax*by + bx*ay) / 6
   (the length-weighted moments of the pen path).  m = 0, and if S > 0:
       ex = Sx / S; ey = Sy / S; vyy = Syy / S - ey*ey; cxy = Sxy / S - ex*ey
       if vyy > 0: m = cxy / vyy, clamped to [-MAX_SLANT, MAX_SLANT]
   If m != 0 every point is sheared, x <- x - m * (y - oy), and minx, maxx are
   recomputed from the sheared points.
3. Scale factors, with w = maxx - minx, h = maxy - miny.  The pen centre-lines
   are mapped into a box of TW = BOX_W - 2*PEN_R by TH = BOX_H - 2*PEN_R, so that
   the ink (centre-lines plus pen) fills BOX_W x BOX_H:
       sx = TW / w,  sy = TH / h
       if sx > MAX_ANISO * sy: sx = MAX_ANISO * sy     (narrow drawing, e.g. "1")
       if sy > MAX_ANISO * sx: sy = MAX_ANISO * sx     (flat drawing)
   A zero extent gives scale 0 on that axis (w == 0 and h == 0: a dot).
4. X = 16 + (x - (minx + maxx) / 2) * sx,  Y = 16 + (y - (miny + maxy) / 2) * sy.
5. Pixel (row i, col j) has centre (j + 0.5, i + 0.5).  It is on when its squared
   distance to any stroke segment is <= PEN_R * PEN_R.  A one-point stroke is a
   segment of zero length.  For a segment (x0, y0)-(x1, y1) and centre (px, py):
       dx = x1 - x0; dy = y1 - y0; len2 = dx*dx + dy*dy
       if len2 == 0:  ex = px - x0; ey = py - y0
       else:          t = ((px - x0)*dx + (py - y0)*dy) / len2
                      clamp t to [0, 1]
                      ex = px - (x0 + t*dx); ey = py - (y0 + t*dy)
       on if ex*ex + ey*ey <= PEN_R*PEN_R
   (The reference only visits the pixels in a window around each segment; the
   window is conservative, so visiting all 1024 pixels gives the same image.)
6. counts[r][c] = number of on pixels in rows 4r..4r+3, cols 4c..4c+3.

The constants were calibrated against the original 32x32 optdigits bitmaps
(ink fills all 32 rows; median ink width 20; median stroke width 5) and by how
well networks trained on optdigits alone read other datasets pushed through
this normalisation (see train_final.py).
"""

import math

import numpy as np

SIZE = 32  # normalised image is SIZE x SIZE
GRID = 8  # counts grid
CELL = 4  # SIZE / GRID
BOX_W = 20.0  # ink box width in the normalised image
BOX_H = 32.0  # ink box height
PEN_R = 2.5  # pen radius (pen width 5 pixels)
MAX_ANISO = 2.0  # largest allowed ratio between the two scale factors
MAX_SLANT = 1.0  # largest slant (dx/dy) that is removed
THRESHOLDS = (1, 6, 11)  # input bit t is on when the (centred) count is greater than THRESHOLDS[t]


def normalise_strokes(strokes, box_w=BOX_W, box_h=BOX_H, pen_r=PEN_R, max_aniso=MAX_ANISO, max_slant=MAX_SLANT):
    """Map strokes into the 32x32 frame.  Returns a list of lists of [X, Y] floats."""
    pts = []
    for stroke in strokes:
        q = [[float(p[0]), float(p[1])] for p in stroke]
        if q:
            pts.append(q)
    if not pts:
        return []
    minx = maxx = pts[0][0][0]
    miny = maxy = pts[0][0][1]
    for q in pts:
        for p in q:
            x = p[0]
            y = p[1]
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
        for q in pts:
            for k in range(len(q) - 1):
                ax = q[k][0] - ox
                ay = q[k][1] - oy
                bx = q[k + 1][0] - ox
                by = q[k + 1][1] - oy
                dx = bx - ax
                dy = by - ay
                L = math.sqrt(dx * dx + dy * dy)
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
            for q in pts:
                for p in q:
                    p[0] = p[0] - m * (p[1] - oy)
            minx = maxx = pts[0][0][0]
            for q in pts:
                for p in q:
                    x = p[0]
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
    for q in pts:
        for p in q:
            p[0] = half + (p[0] - mx) * sx
            p[1] = half + (p[1] - my) * sy
    return pts


def _stamp(img, x0, y0, x1, y1, pen_r):
    r2 = pen_r * pen_r
    dx = x1 - x0
    dy = y1 - y0
    len2 = dx * dx + dy * dy
    # conservative window (one pixel wider than needed on every side)
    jlo = int(math.floor((x0 if x0 < x1 else x1) - pen_r)) - 1
    jhi = int(math.floor((x0 if x0 > x1 else x1) + pen_r)) + 1
    ilo = int(math.floor((y0 if y0 < y1 else y1) - pen_r)) - 1
    ihi = int(math.floor((y0 if y0 > y1 else y1) + pen_r)) + 1
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
        row = img[i]
        for j in range(jlo, jhi + 1):
            if row[j]:
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
                row[j] = 1


def rasterise(polys, pen_r=PEN_R):
    """Draw normalised polylines with a round pen.  Returns a 32x32 list of 0/1 rows."""
    img = [[0] * SIZE for _ in range(SIZE)]
    for q in polys:
        if len(q) == 1:
            _stamp(img, q[0][0], q[0][1], q[0][0], q[0][1], pen_r)
        for k in range(len(q) - 1):
            _stamp(img, q[k][0], q[k][1], q[k + 1][0], q[k + 1][1], pen_r)
    return img


def block_counts(img):
    """32x32 binary image -> 8x8 int array of on-pixel counts per 4x4 block."""
    counts = np.zeros((GRID, GRID), dtype=np.int64)
    for i in range(SIZE):
        row = img[i]
        for j in range(SIZE):
            if row[j]:
                counts[i // CELL, j // CELL] += 1
    return counts


def strokes_to_image(strokes):
    """Strokes -> normalised 32x32 uint8 image (0/1)."""
    return np.array(rasterise(normalise_strokes(strokes)), dtype=np.uint8)


def strokes_to_counts(strokes):
    """Strokes (list of polylines of (x, y), y downward) -> (8, 8) int counts in 0..16."""
    return block_counts(rasterise(normalise_strokes(strokes)))


def image_to_image32(binary_image, box_w=BOX_W, box_h=BOX_H, max_aniso=MAX_ANISO, max_slant=MAX_SLANT):
    """Bitmap of any size (non-zero = ink) -> normalised 32x32 uint8 image.

    The same steps as for strokes, on pixel centres: slant from the second moments
    of the ink pixels, then the sheared ink bounding box (pixel edges) is mapped
    onto the BOX_W x BOX_H ink box centred in the frame, with the same limit on
    anisotropy.  Nearest-neighbour resampling.  Python only (not ported)."""
    a = np.asarray(binary_image)
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
    out = np.zeros((SIZE, SIZE), dtype=np.uint8)
    if n == 0:
        return out
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
    minx = maxx = miny = maxy = 0.0
    for i in range(H):
        for j in range(W):
            if a[i, j]:
                x = j + 0.5 - m * (i + 0.5 - ey)
                y = i + 0.5
                if first:
                    minx = maxx = x
                    miny = maxy = y
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
        v = int(math.floor(cy + (i + 0.5 - half) / sy))
        if v < 0 or v >= H:
            continue
        for j in range(SIZE):
            u = int(math.floor(cx + (j + 0.5 - half) / sx + m * (v + 0.5 - ey)))
            if u < 0 or u >= W:
                continue
            if a[v, u]:
                out[i, j] = 1
    return out


def image_to_counts(binary_image):
    """Bitmap (2-D array, non-zero = ink) -> (8, 8) int counts through the same normalisation."""
    return block_counts(image_to_image32(binary_image))


def centre_counts(counts):
    """Shift an 8x8 grid so the bounding box of its ink (count > 0) is centred (floor rule).

    dy = floor((7 - (top + bottom)) / 2), dx = floor((7 - (left + right)) / 2); cells
    shifted in from outside are 0."""
    c = np.asarray(counts).reshape(GRID, GRID)
    top = bottom = left = right = -1
    for i in range(GRID):
        for j in range(GRID):
            if c[i, j] > 0:
                if top < 0:
                    top = i
                bottom = i
                if left < 0 or j < left:
                    left = j
                if j > right:
                    right = j
    out = np.zeros((GRID, GRID), dtype=np.int64)
    if top < 0:
        return out
    dy = (7 - (top + bottom)) // 2
    dx = (7 - (left + right)) // 2
    for i in range(GRID):
        si = i - dy
        if si < 0 or si >= GRID:
            continue
        for j in range(GRID):
            sj = j - dx
            if sj < 0 or sj >= GRID:
                continue
            out[i, j] = c[si, sj]
    return out


def counts_to_bits(counts, thresholds=THRESHOLDS):
    """8x8 counts -> 192 bits (uint8).  bit[t*64 + row*8 + col] = centred[row, col] > thresholds[t]."""
    c = centre_counts(counts)
    bits = np.zeros(len(thresholds) * GRID * GRID, dtype=np.uint8)
    for t in range(len(thresholds)):
        for i in range(GRID):
            for j in range(GRID):
                if c[i, j] > thresholds[t]:
                    bits[t * 64 + i * 8 + j] = 1
    return bits


def strokes_to_bits(strokes, thresholds=THRESHOLDS):
    return counts_to_bits(strokes_to_counts(strokes), thresholds)


def bits_to_hex(bits):
    """Pack bits little-endian (bit i is bit i & 7 of byte i >> 3) and return hex."""
    b = bytearray((len(bits) + 7) // 8)
    for i in range(len(bits)):
        if bits[i]:
            b[i >> 3] |= 1 << (i & 7)
    return bytes(b).hex()
