import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { hexToBits } from './input';
import { parseMachine } from './loader';
import { analyseRun, yesVotes } from './run';
import { simulate } from './sim';

/** The vote tally read back from race times, checked on real runs of the shipped machine. */

const publicDir = new URL('../../public/', import.meta.url);
const packed = gunzipSync(readFileSync(new URL('machine.bin.gz', publicDir)));
const machine = parseMachine(
  packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength) as ArrayBuffer,
);
const golden = JSON.parse(readFileSync(new URL('golden.json', publicDir), 'utf8')) as {
  cases: { bits: string; winner: number | null }[];
};
const timing = machine.scene.header.timing;

describe('yesVotes', () => {
  it.each([0, 1, 2, 3, 4, 5])('reads whole numbers of votes from run %i', (caseIndex) => {
    const bits = hexToBits(golden.cases[caseIndex].bits, machine.scene.header.model.bits);
    const info = analyseRun(machine.scene, simulate(machine.graph, bits));
    const tallies = info.lanes.map((lane, index) => yesVotes(lane, index, timing));

    info.lanes.forEach((lane, index) => {
      const tally = tallies[index];
      expect(tally).not.toBeNull();
      if (!tally || lane.raceTime === null || !timing) return;
      expect(tally.total).toBe(50);
      // The race time is a whole number of detours beyond the all-yes time.
      const against = tally.total - tally.yes;
      const expected = timing.allShort_s + timing.eps_s * index + against * timing.delta_s;
      expect(Math.abs(lane.raceTime - expected)).toBeLessThan(0.3);
    });

    // The winner has the most yes votes, and among equals the lowest digit.
    const best = Math.max(...tallies.map((tally) => tally?.yes ?? -1));
    expect(tallies.findIndex((tally) => tally?.yes === best)).toBe(golden.cases[caseIndex].winner);
  });
});
