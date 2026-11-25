import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PREPROCESS,
  bitsToHex,
  bitsToLevels,
  centreCounts,
  countsToBits,
  hexToBits,
  strokesToCounts,
  type Stroke,
} from './input';

interface Fixtures {
  thresholds: number[];
  constants: Record<string, number>;
  cases: { name: string; strokes: number[][][]; counts: number[]; bits: string }[];
  countsCases?: { counts: number[]; bits: string }[];
}

// Written by the Python reference (compiler/dominoes/make_fixtures.py).
const fixtures = JSON.parse(
  readFileSync(
    new URL('../../../compiler/fixtures/preprocess_cases.json', import.meta.url),
    'utf8',
  ),
) as Fixtures;

const toStrokes = (raw: number[][][]): Stroke[] =>
  raw.map((stroke) => stroke.map(([x, y]) => ({ x, y })));

describe('the port of the reference preprocessing', () => {
  it('uses the constants the network was trained with', () => {
    const c = fixtures.constants;
    expect([c.boxW, c.boxH, c.penR, c.maxAniso, c.maxSlant]).toEqual([
      PREPROCESS.boxW,
      PREPROCESS.boxH,
      PREPROCESS.penR,
      PREPROCESS.maxAniso,
      PREPROCESS.maxSlant,
    ]);
  });

  it.each(fixtures.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const counts = strokesToCounts(toStrokes(c.strokes));
    expect(Array.from(counts)).toEqual(c.counts);
    expect(bitsToHex(countsToBits(counts, fixtures.thresholds))).toBe(c.bits);
  });

  it('turns stored grids into the same bits', () => {
    for (const c of fixtures.countsCases ?? []) {
      expect(bitsToHex(countsToBits(Uint8Array.from(c.counts), fixtures.thresholds))).toBe(c.bits);
    }
  });
});

describe('strokesToCounts', () => {
  it('returns an empty grid for an empty drawing', () => {
    expect(Array.from(strokesToCounts([]))).toEqual(new Array(64).fill(0));
  });

  it('does not depend on where or how large the digit was drawn', () => {
    const seven = (x: number, y: number, size: number): Stroke[] => [
      [
        { x, y },
        { x: x + size * 0.6, y },
        { x: x + size * 0.2, y: y + size },
      ],
    ];
    const big = strokesToCounts(seven(0.1, 0.1, 0.8));
    const smallInCorner = strokesToCounts(seven(0.7, 0.05, 0.25));
    expect(Array.from(smallInCorner)).toEqual(Array.from(big));
  });

  it('never reports more ink than a cell holds', () => {
    const scribble: Stroke[] = [];
    for (let i = 0; i < 40; i++) {
      scribble.push([
        { x: 0, y: i / 40 },
        { x: 1, y: i / 40 },
      ]);
    }
    expect(Math.max(...strokesToCounts(scribble))).toBeLessThanOrEqual(16);
  });
});

describe('centreCounts', () => {
  it('moves ink in a corner to the middle', () => {
    const counts = new Uint8Array(64);
    counts[0] = 9; // row 0, col 0
    counts[1] = 5; // row 0, col 1
    const centred = centreCounts(counts);
    expect(centred[3 * 8 + 3]).toBe(9);
    expect(centred[3 * 8 + 4]).toBe(5);
    expect(centred.reduce((a, b) => a + b, 0)).toBe(14);
  });
});

describe('bits', () => {
  it('orders bits by threshold, then row, then column', () => {
    const counts = new Uint8Array(64);
    counts.fill(1); // ink everywhere, so centring moves nothing
    counts[10] = 5;
    counts[11] = 9;
    counts[12] = 13;
    const bits = countsToBits(counts, [4, 8, 12]);
    expect([bits[10], bits[11], bits[12]]).toEqual([1, 1, 1]);
    expect([bits[64 + 10], bits[64 + 11], bits[64 + 12]]).toEqual([0, 1, 1]);
    expect([bits[128 + 10], bits[128 + 11], bits[128 + 12]]).toEqual([0, 0, 1]);
    expect(Array.from(bitsToLevels(bits)).slice(9, 13)).toEqual([0, 1, 2, 3]);
  });

  it('packs and unpacks hex little-endian within each byte', () => {
    const bits = hexToBits('01800f', 24);
    expect(Array.from(bits)).toEqual([
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0,
    ]);
    expect(bitsToHex(bits)).toBe('01800f');
  });
});
