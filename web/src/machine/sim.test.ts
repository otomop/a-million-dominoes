import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { hexToBits } from './input';
import { parseMachine } from './loader';
import { analyseRun } from './run';
import { simulate } from './sim';

/**
 * The proof that the page runs the same machine as the Python validation:
 * every case in golden.json must be reproduced exactly.
 */

interface GoldenCase {
  bits: string;
  label: number;
  /** The digit the machine picked, by its `win` dominoes. */
  winner?: number;
  fallen: number;
  sumTicks: number;
  sumDir: number;
  finish: number[];
  probe: [domino: number, tick: number, dir: number][];
}

const publicDir = new URL('../../public/', import.meta.url);
const packed = gunzipSync(readFileSync(new URL('machine.bin.gz', publicDir)));
const machine = parseMachine(
  packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength) as ArrayBuffer,
);
const golden = JSON.parse(readFileSync(new URL('golden.json', publicDir), 'utf8')) as {
  tick_s: number;
  cases: GoldenCase[];
};
const { header } = machine.scene;

describe('machine file', () => {
  it('decodes to the sizes the header promises', () => {
    expect(machine.scene.count).toBe(header.count);
    expect(machine.graph.rowPtr.length).toBe(2 * header.count + 1);
    expect(machine.graph.dst.length).toBe(header.edges);
    expect(golden.tick_s).toBe(header.units.tick_s);
    expect(header.lanes.length).toBe(10);
  });

  it('keeps every edge target inside the machine', () => {
    let min = Infinity;
    let max = -Infinity;
    for (const target of machine.graph.dst) {
      if (target < min) min = target;
      if (target > max) max = target;
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(header.count);
  });
});

describe('automaton reproduces golden.json', () => {
  expect(golden.cases.length).toBeGreaterThan(0);

  golden.cases.forEach((golden_, index) => {
    it(`case ${index} (digit ${golden_.label})`, () => {
      const bits = hexToBits(golden_.bits, header.model.bits);
      const { fallTick, fallDir, order } = simulate(machine.graph, bits);

      let fallen = 0;
      let sumTicks = 0;
      let sumDir = 0;
      for (let i = 0; i < fallTick.length; i++) {
        if (fallTick[i] < 0) continue;
        fallen++;
        sumTicks += fallTick[i];
        sumDir += fallDir[i];
      }
      expect(fallen).toBe(golden_.fallen);
      expect(order.length).toBe(golden_.fallen);
      expect(sumTicks).toBe(golden_.sumTicks);
      expect(sumDir).toBe(golden_.sumDir);

      const finish = header.lanes.map((lane) => fallTick[lane.finish]);
      expect(finish).toEqual(golden_.finish);

      for (const [domino, tick, dir] of golden_.probe) {
        expect([domino, fallTick[domino], fallDir[domino]]).toEqual([domino, tick, dir]);
      }

      // The page's own reading of the result must name the same winner.
      if (golden_.winner !== undefined) {
        const info = analyseRun(machine.scene, { fallTick, fallDir, order });
        expect(info.winners.map((lane) => header.lanes[lane].digit)).toEqual([golden_.winner]);
      }
    });
  });

  it('runs in well under half a second', () => {
    const bits = hexToBits(golden.cases[0].bits, header.model.bits);
    simulate(machine.graph, bits); // warm up
    const start = performance.now();
    simulate(machine.graph, bits);
    const elapsed = performance.now() - start;
    console.log(`simulate: ${elapsed.toFixed(1)} ms`);
    expect(elapsed).toBeLessThan(500);
  });
});
