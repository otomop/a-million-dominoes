import { describe, expect, it } from 'vitest';
import { analyseRun, laneFront, laneProgress, leadingLane } from './run';
import type { Header, Lane, Scene, SimResult } from './types';

/**
 * A toy machine: two lanes of five dominoes each (0-4 and 5-9), then one
 * "win" domino per lane (10 and 11). Enough to exercise both ways of naming
 * the winner and both ways of measuring progress.
 */
function toyScene(lanes: Lane[]): Scene {
  const count = 12;
  const header = {
    version: 1,
    count,
    edges: 0,
    units: { xy_mm: 1 / 32, z_mm: 15.5, tick_s: 0.0001 },
    domino: { h: 48, w: 24, t: 7.5 },
    kinds: ['wire', 'lane', 'panel-on'],
    sections: {},
    model: { grid: 8, thresholds: [4, 8, 12], bits: 192 },
    lanes,
    bounds: { minX: 0, maxX: 1000, minY: 0, maxY: 1000 },
    layout: 'test',
  } satisfies Header;
  const x = new Float32Array(count);
  for (let i = 0; i < count; i++) x[i] = (i % 5) * 100;
  return {
    header,
    count,
    x,
    y: new Float32Array(count),
    yaw: new Float32Array(count),
    z0: new Float32Array(count),
    arm: Uint8Array.from([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1]),
    kind: Uint8Array.from([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2]),
    rest: new Float32Array(2 * count),
    statics: new Float32Array(0),
  };
}

/** A result in which domino i fell at `seconds[i]`, or never if that is null. */
function result(seconds: (number | null)[]): SimResult {
  const fallTick = Int32Array.from(seconds.map((s) => (s === null ? -1 : Math.round(s * 10000))));
  const order = Uint32Array.from(
    seconds
      .map((s, i) => ({ s, i }))
      .filter((e) => e.s !== null)
      .sort((a, b) => a.s! - b.s!)
      .map((e) => e.i),
  );
  return { fallTick, fallDir: new Int8Array(seconds.length).fill(1), order };
}

describe('analyseRun, prototype layout (no win dominoes, no marks)', () => {
  const scene = toyScene([
    { digit: 0, start: 0, finish: 4, marks: [], win: null },
    { digit: 1, start: 5, finish: 9, marks: [], win: null },
  ]);
  //                          lane 0: 1..5 s          lane 1: 1..4 s
  const info = analyseRun(scene, result([1, 2, 3, 4, 5, 1, 1.75, 2.5, 3.25, 4, null, null]));

  it('names the earliest finisher the winner', () => {
    expect(info.winners).toEqual([1]);
    expect(info.winner).toBe(1);
    expect(info.decidedAt).toBeCloseTo(4);
    expect(info.runnerUp).toBe(0);
    expect(info.marginSeconds).toBeCloseTo(1);
    expect(info.panelFrom).toBeNull();
    expect(info.fallen).toBe(10);
    expect(info.duration).toBeCloseTo(5);
    // Without a panel the show runs to the last fall.
    expect(info.end).toBeCloseTo(5.4);
  });

  it('measures progress from the start and finish times', () => {
    expect(laneProgress(info.lanes[0], 0)).toBe(0);
    expect(laneProgress(info.lanes[0], 3)).toBeCloseTo(0.5);
    expect(laneProgress(info.lanes[1], 2.5)).toBeCloseTo(0.5);
    expect(laneProgress(info.lanes[1], 9)).toBe(1);
    expect(leadingLane(info, 0.5)).toBeNull();
    expect(leadingLane(info, 3)).toBe(1);
  });

  it('tracks each lane front for the camera', () => {
    expect(laneFront(info.lanes[0], 0)).toBeNull();
    // Well after its last domino, the front rests where the lane ended.
    const front = laneFront(info.lanes[0], 8);
    expect(front![0]).toBeCloseTo(400);
  });
});

describe('analyseRun, final layout (win dominoes and marks)', () => {
  const scene = toyScene([
    { digit: 0, start: 0, finish: 4, marks: [1, 2, 3, 4], win: 10 },
    { digit: 1, start: 5, finish: 9, marks: [6, 7, 8, 9], win: 11 },
  ]);
  scene.header.lanes[0].panel = { first: 10, count: 1, cx: 0, cy: 0, w: 4000, h: 6000, yaw: 0 };

  // Lane 0 gets home first and its win domino falls; lane 1 is blocked after its third mark.
  const info = analyseRun(scene, result([0, 1, 2, 3, 4, 0, 1.5, 3, 4.5, null, 6, null]));

  it('names the lane whose win domino fell', () => {
    expect(info.winners).toEqual([0]);
    expect(info.coreAt).toBeCloseTo(4);
    expect(info.decidedAt).toBeCloseTo(6);
    expect(info.panelFrom).toBeCloseTo(6);
    expect(info.panelTo).toBeCloseTo(6);
    // The loser never finished, so there is no runner-up to measure against.
    expect(info.marginSeconds).toBeNull();
  });

  it('ends the show a little after the panel, even if other lanes run on', () => {
    const long = analyseRun(scene, result([0, 1, 2, 3, 4, 0, 5, 10, 20, 40, 6, null]));
    expect(long.duration).toBeCloseTo(40);
    expect(long.end).toBeCloseTo(9);
    // Dominoes 0-6 and 10 are down by then; three of lane 1 are still to come.
    expect(long.fallen).toBe(8);
  });

  it('ranks lanes by finish time plus bias', () => {
    const biased = toyScene([
      { digit: 0, start: 0, finish: 4, finishBias: 30000 },
      { digit: 1, start: 5, finish: 9, finishBias: 5000 },
    ]);
    // Lane 0 reaches its finish domino first, but its bias puts it behind lane 1.
    const run = analyseRun(biased, result([0, 1, 2, 3, 4, 0, 1, 2, 3, 5, null, null]));
    expect(run.lanes[0].raceTime).toBeCloseTo(7);
    expect(run.lanes[1].raceTime).toBeCloseTo(5.5);
    expect(run.winners).toEqual([1]);
    expect(run.runnerUp).toBe(0);
    expect(run.marginSeconds).toBeCloseTo(1.5);
  });

  it('reports a tie when two win dominoes fall', () => {
    const tie = analyseRun(scene, result([0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 6, 6.2]));
    expect(tie.winners).toEqual([0, 1]);
    expect(tie.winner).toBe(0);
    expect(tie.marginSeconds).toBeNull();
  });

  it('reports no winner when no win domino falls, whatever the finish times', () => {
    const none = analyseRun(scene, result([0, 1, 2, 3, 4, 0, 1, 2, 3, 4, null, null]));
    expect(none.winners).toEqual([]);
    expect(none.winner).toBeNull();
    expect(none.decidedAt).toBeNull();
  });

  it('measures progress as the share of marks fallen, gliding between them', () => {
    expect(laneProgress(info.lanes[0], 2)).toBeCloseTo(0.5);
    expect(laneProgress(info.lanes[0], 2.5)).toBeCloseTo(0.625);
    expect(laneProgress(info.lanes[0], 10)).toBe(1);
    // The blocked lane stops at three marks of four and stays there.
    expect(laneProgress(info.lanes[1], 4.5)).toBeCloseTo(0.75);
    expect(laneProgress(info.lanes[1], 10)).toBeCloseTo(0.75);
    expect(leadingLane(info, 2)).toBe(0);
  });

  it('still names a winner if only the win domino says so', () => {
    const upset = analyseRun(scene, result([0, 1, 2, 3, 4, 0, 1, 2, 3, 5, null, 7]));
    expect(upset.winner).toBe(1);
    expect(upset.decidedAt).toBeCloseTo(7);
  });
});

describe('analyseRun, nothing finishes', () => {
  it('reports no winner', () => {
    const scene = toyScene([
      { digit: 0, start: 0, finish: 4 },
      { digit: 1, start: 5, finish: 9 },
    ]);
    const nulls = new Array<null>(10).fill(null);
    const info = analyseRun(scene, result([0, 1, ...nulls]));
    expect(info.winner).toBeNull();
    expect(info.decidedAt).toBeNull();
    expect(info.fallen).toBe(2);
  });
});
