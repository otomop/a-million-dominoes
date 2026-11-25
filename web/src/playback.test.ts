import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { hexToBits } from './machine/input';
import { parseMachine } from './machine/loader';
import { analyseRun } from './machine/run';
import { simulate } from './machine/sim';
import { Playback } from './playback';

/** Auto speed, checked against real runs of the shipped machine. */

const publicDir = new URL('../public/', import.meta.url);
const packed = gunzipSync(readFileSync(new URL('machine.bin.gz', publicDir)));
const machine = parseMachine(
  packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength) as ArrayBuffer,
);
const golden = JSON.parse(readFileSync(new URL('golden.json', publicDir), 'utf8')) as {
  cases: { bits: string }[];
};

/** Play a run at 60 frames a second and note when things happen on the wall clock. */
function play(caseIndex: number) {
  const bits = hexToBits(golden.cases[caseIndex].bits, machine.scene.header.model.bits);
  const info = analyseRun(machine.scene, simulate(machine.graph, bits));
  const playback = new Playback();
  playback.load(info);
  const frame = 1 / 60;
  let wall = 0;
  let decidedWall = 0;
  let maxSpeed = 0;
  while (playback.playing && wall < 600) {
    if (info.decidedAt !== null && playback.time < info.decidedAt) decidedWall = wall;
    maxSpeed = Math.max(maxSpeed, playback.speed);
    playback.advance(frame);
    wall += frame;
  }
  return { info, playback, wall, decidedWall, maxSpeed };
}

describe('Auto speed', () => {
  it.each([0, 2, 7])('plays golden case %i in 35 to 45 seconds', (caseIndex) => {
    const { info, playback, wall } = play(caseIndex);
    expect(playback.finished).toBe(true);
    expect(playback.time).toBeCloseTo(info.end);
    expect(wall).toBeGreaterThan(35);
    expect(wall).toBeLessThan(45);
  });

  it('does not rush the ending', () => {
    const { info, playback, wall, decidedWall } = play(7);
    // From the result to the end of the show takes a good share of the time...
    expect(wall - decidedWall).toBeGreaterThan(8);
    // ...and the panel itself topples at a pace you can watch.
    playback.seek((info.panelFrom! + info.panelTo!) / 2);
    expect(playback.speed).toBeLessThan(4);
    playback.seek(info.decidedAt!);
    expect(playback.speed).toBeLessThan(6);
  });

  it('ends the show after the winning panel, not at the last fall', () => {
    const { info } = play(7);
    expect(info.panelTo).not.toBeNull();
    expect(info.end).toBeGreaterThan(info.panelTo!);
    expect(info.end).toBeLessThan(info.panelTo! + 5);
    expect(info.end).toBeLessThan(info.duration);
  });
});
