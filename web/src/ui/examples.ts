import { bitsToLevels, countsToBits } from '../machine/input';

export interface Example {
  digit: number;
  bits: Uint8Array;
  /** Ink level 0..3 per cell of the 8x8 grid. */
  levels: Uint8Array;
}

/** Digits written by people the network never saw in training, as 8x8 ink counts. */
const EXAMPLES_URL = 'examples.json';

/** One example per digit, in order. */
export async function loadExamples(thresholds: readonly number[]): Promise<Example[]> {
  const response = await fetch(EXAMPLES_URL);
  if (!response.ok) throw new Error(`Could not load examples (${response.status})`);
  const data = (await response.json()) as { label: number; counts: number[] }[];
  const byDigit = new Map<number, Example>();
  for (const { label, counts } of data) {
    if (byDigit.has(label)) continue;
    const bits = countsToBits(Uint8Array.from(counts), thresholds);
    byDigit.set(label, { digit: label, bits, levels: bitsToLevels(bits) });
  }
  return [...byDigit.values()].sort((a, b) => a.digit - b.digit);
}
