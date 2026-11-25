/**
 * Unit meshes as interleaved position + normal (6 floats per vertex),
 * counter-clockwise seen from outside.
 */

const FACES: {
  normal: [number, number, number];
  u: [number, number, number];
  v: [number, number, number];
}[] = [
  { normal: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { normal: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { normal: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { normal: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
];

const QUAD_CORNERS: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, -1],
  [1, 1],
  [-1, 1],
];

function face(index: number, inset: number): number[] {
  const { normal, u, v } = FACES[index];
  const out: number[] = [];
  for (const [a, b] of QUAD_CORNERS) {
    for (let k = 0; k < 3; k++) out.push(0.5 * (normal[k] * inset + u[k] * a + v[k] * b));
    out.push(...normal);
  }
  return out;
}

export const BOX_VERTEX_COUNT = 36;
export const QUAD_VERTEX_COUNT = 6;

/** A cube spanning -0.5..0.5 (36 vertices), then its +x face moved to the centre plane (6 vertices). */
export function boxAndQuad(): Float32Array {
  const data: number[] = [];
  for (let f = 0; f < 6; f++) data.push(...face(f, 1));
  data.push(...face(0, 0));
  return new Float32Array(data);
}
