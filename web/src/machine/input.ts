/**
 * From a drawing to the machine's input bits.
 *
 *   strokes -> normalised 32x32 binary image -> 8x8 ink counts (0..16)
 *           -> centred -> three thresholds -> 192 bits
 *
 * This is a port of compiler/dominoes/preprocess.py, which is the reference.
 * The network was trained on drawings pushed through exactly these steps, so
 * the port must match it bit for bit: the arithmetic below is plain doubles in
 * the same order as the Python, and input.test.ts checks it against cases the
 * Python produced. Change nothing here without changing the reference.
 */

export interface Point {
  x: number;
  y: number;
}
/** A stroke is a polyline in pad coordinates (any scale, y downward). */
export type Stroke = Point[];

const SIZE = 32;
const GRID = 8;
const CELL = SIZE / GRID;

/** The normalisation's constants, as calibrated against the training bitmaps. */
export const PREPROCESS = {
  /** Width and height of the box the ink is made to fill. */
  boxW: 20,
  boxH: 32,
  /** Pen radius in pixels of the 32x32 image. */
  penR: 2.5,
  /** Largest ratio allowed between the two scale factors (keeps a "1" thin). */
  maxAniso: 2,
  /** Largest slant (dx/dy) that is removed. */
  maxSlant: 1,
} as const;

/** Ink counts per cell of the 8x8 grid, row 0 at the top (not yet centred). */
export function strokesToCounts(strokes: Stroke[]): Uint8Array {
  return blockCounts(rasterise(normaliseStrokes(strokes)));
}

/**
 * Centre the grid on its ink, then compare with each threshold:
 * bit `t*64 + row*8 + col` is 1 when that cell's count exceeds `thresholds[t]`.
 */
export function countsToBits(counts: Uint8Array, thresholds: readonly number[]): Uint8Array {
  const centred = centreCounts(counts);
  const cells = GRID * GRID;
  const bits = new Uint8Array(thresholds.length * cells);
  for (let t = 0; t < thresholds.length; t++) {
    for (let c = 0; c < cells; c++) bits[t * cells + c] = centred[c] > thresholds[t] ? 1 : 0;
  }
  return bits;
}

/** Unpack hex-encoded bits: bit `i` is bit `i & 7` of byte `i >> 3`. */
export function hexToBits(hex: string, bitCount: number): Uint8Array {
  const bits = new Uint8Array(bitCount);
  for (let i = 0; i < bitCount; i++) {
    const byte = parseInt(hex.slice((i >> 3) * 2, (i >> 3) * 2 + 2), 16) || 0;
    bits[i] = (byte >> (i & 7)) & 1;
  }
  return bits;
}

/** Pack bits the same way, for comparing with reference data. */
export function bitsToHex(bits: Uint8Array): string {
  const bytes = new Uint8Array((bits.length + 7) >> 3);
  for (let i = 0; i < bits.length; i++) if (bits[i]) bytes[i >> 3] |= 1 << (i & 7);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** How many thresholds each cell exceeds (0 = no ink .. thresholds.length = full). */
export function bitsToLevels(bits: Uint8Array, cells = GRID * GRID): Uint8Array {
  const levels = new Uint8Array(cells);
  for (let i = 0; i < bits.length; i++) levels[i % cells] += bits[i];
  return levels;
}

/**
 * Map the strokes into the 32x32 frame: remove slant, then scale the bounding
 * box of the pen's centre-lines so that the ink fills the target box.
 */
export function normaliseStrokes(strokes: Stroke[]): number[][][] {
  const { boxW, boxH, penR, maxAniso, maxSlant } = PREPROCESS;
  const pts: number[][][] = [];
  for (const stroke of strokes) {
    if (stroke.length > 0) pts.push(stroke.map((p) => [p.x, p.y]));
  }
  if (pts.length === 0) return [];

  let minx = pts[0][0][0];
  let maxx = minx;
  let miny = pts[0][0][1];
  let maxy = miny;
  for (const q of pts) {
    for (const p of q) {
      if (p[0] < minx) minx = p[0];
      if (p[0] > maxx) maxx = p[0];
      if (p[1] < miny) miny = p[1];
      if (p[1] > maxy) maxy = p[1];
    }
  }

  // Slant: the regression of x on y along the pen path, from its
  // length-weighted second moments.
  const ox = (minx + maxx) / 2;
  const oy = (miny + maxy) / 2;
  let S = 0;
  let Sx = 0;
  let Sy = 0;
  let Syy = 0;
  let Sxy = 0;
  for (const q of pts) {
    for (let k = 0; k < q.length - 1; k++) {
      const ax = q[k][0] - ox;
      const ay = q[k][1] - oy;
      const bx = q[k + 1][0] - ox;
      const by = q[k + 1][1] - oy;
      const dx = bx - ax;
      const dy = by - ay;
      const L = Math.sqrt(dx * dx + dy * dy);
      S += L;
      Sx += (L * (ax + bx)) / 2;
      Sy += (L * (ay + by)) / 2;
      Syy += (L * (ay * ay + ay * by + by * by)) / 3;
      Sxy += (L * (2 * ax * ay + 2 * bx * by + ax * by + bx * ay)) / 6;
    }
  }
  let m = 0;
  if (S > 0) {
    const ex = Sx / S;
    const ey = Sy / S;
    const vyy = Syy / S - ey * ey;
    const cxy = Sxy / S - ex * ey;
    if (vyy > 0) {
      m = cxy / vyy;
      if (m > maxSlant) m = maxSlant;
      if (m < -maxSlant) m = -maxSlant;
    }
  }
  if (m !== 0) {
    for (const q of pts) for (const p of q) p[0] = p[0] - m * (p[1] - oy);
    minx = pts[0][0][0];
    maxx = minx;
    for (const q of pts) {
      for (const p of q) {
        if (p[0] < minx) minx = p[0];
        if (p[0] > maxx) maxx = p[0];
      }
    }
  }

  const w = maxx - minx;
  const h = maxy - miny;
  const tw = boxW - 2 * penR;
  const th = boxH - 2 * penR;
  let sx = 0;
  let sy = 0;
  if (w > 0 && h > 0) {
    sx = tw / w;
    sy = th / h;
    if (sx > maxAniso * sy) sx = maxAniso * sy;
    if (sy > maxAniso * sx) sy = maxAniso * sx;
  } else if (h > 0) {
    sy = th / h;
  } else if (w > 0) {
    sx = tw / w;
  }
  const mx = (minx + maxx) / 2;
  const my = (miny + maxy) / 2;
  const half = SIZE / 2;
  for (const q of pts) {
    for (const p of q) {
      p[0] = half + (p[0] - mx) * sx;
      p[1] = half + (p[1] - my) * sy;
    }
  }
  return pts;
}

/** Draw normalised polylines with a round pen into a 32x32 binary image. */
export function rasterise(polys: number[][][]): Uint8Array {
  const image = new Uint8Array(SIZE * SIZE);
  for (const q of polys) {
    if (q.length === 1) stamp(image, q[0][0], q[0][1], q[0][0], q[0][1]);
    for (let k = 0; k < q.length - 1; k++) stamp(image, q[k][0], q[k][1], q[k + 1][0], q[k + 1][1]);
  }
  return image;
}

/** Turn on every pixel whose centre lies within the pen radius of the segment. */
function stamp(image: Uint8Array, x0: number, y0: number, x1: number, y1: number): void {
  const penR = PREPROCESS.penR;
  const r2 = penR * penR;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const jlo = Math.max(0, Math.floor((x0 < x1 ? x0 : x1) - penR) - 1);
  const jhi = Math.min(SIZE - 1, Math.floor((x0 > x1 ? x0 : x1) + penR) + 1);
  const ilo = Math.max(0, Math.floor((y0 < y1 ? y0 : y1) - penR) - 1);
  const ihi = Math.min(SIZE - 1, Math.floor((y0 > y1 ? y0 : y1) + penR) + 1);
  for (let i = ilo; i <= ihi; i++) {
    const py = i + 0.5;
    for (let j = jlo; j <= jhi; j++) {
      if (image[i * SIZE + j]) continue;
      const px = j + 0.5;
      let ex: number;
      let ey: number;
      if (len2 === 0) {
        ex = px - x0;
        ey = py - y0;
      } else {
        let t = ((px - x0) * dx + (py - y0) * dy) / len2;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        ex = px - (x0 + t * dx);
        ey = py - (y0 + t * dy);
      }
      if (ex * ex + ey * ey <= r2) image[i * SIZE + j] = 1;
    }
  }
}

/** Count the inked pixels in each 4x4 block. */
export function blockCounts(image: Uint8Array): Uint8Array {
  const counts = new Uint8Array(GRID * GRID);
  for (let i = 0; i < SIZE; i++) {
    for (let j = 0; j < SIZE; j++) {
      if (image[i * SIZE + j]) counts[Math.floor(i / CELL) * GRID + Math.floor(j / CELL)]++;
    }
  }
  return counts;
}

/** Shift the grid so the bounding box of its non-empty cells is centred (rounding down). */
export function centreCounts(counts: Uint8Array): Uint8Array {
  let top = GRID;
  let bottom = -1;
  let left = GRID;
  let right = -1;
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      if (counts[r * GRID + c] === 0) continue;
      top = Math.min(top, r);
      bottom = Math.max(bottom, r);
      left = Math.min(left, c);
      right = Math.max(right, c);
    }
  }
  const centred = new Uint8Array(GRID * GRID);
  if (bottom < 0) return centred;
  const dy = Math.floor((GRID - 1 - (top + bottom)) / 2);
  const dx = Math.floor((GRID - 1 - (left + right)) / 2);
  for (let r = top; r <= bottom; r++) {
    for (let c = left; c <= right; c++) {
      const nr = r + dy;
      const nc = c + dx;
      if (nr >= 0 && nr < GRID && nc >= 0 && nc < GRID) {
        centred[nr * GRID + nc] = counts[r * GRID + c];
      }
    }
  }
  return centred;
}
