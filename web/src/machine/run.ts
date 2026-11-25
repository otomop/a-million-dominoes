import type { Scene, SimResult } from './types';

/** How one lane's race went. Times are simulation seconds. */
export interface LaneTrack {
  digit: number;
  startTime: number | null;
  /** When the lane's `finish` domino fell (in the final layout, its entry to the finish core). */
  finishTime: number | null;
  /** `finishTime` plus the lane's bias: the time the ten lanes are ranked by. */
  raceTime: number | null;
  /** Total checkpoints on the lane (0 if the layout has none). */
  markCount: number;
  /** Fall times of the checkpoints that fell, ascending. */
  markTimes: Float64Array;
  /** Where the lane's wavefront was over time (machine mm), for the camera. */
  frontTime: Float32Array;
  frontX: Float32Array;
  frontY: Float32Array;
}

/** Everything the page shows about a run, derived once from the simulation result. */
export interface RunInfo {
  result: SimResult;
  tickSeconds: number;
  /** Time of the very last fall. Losing lanes can run long after the answer is in. */
  duration: number;
  /**
   * Where the show ends: shortly after the winner's picture panel is down, or
   * at the last fall if the run has no panel to wait for.
   */
  end: number;
  /** Dominoes down by `end`. */
  fallen: number;
  /**
   * Lanes (by index) the machine picked: one normally, two or more in a tie,
   * none if the dominoes could not decide.
   */
  winners: number[];
  /** The first of `winners`, or null. The camera and the pacing follow this lane. */
  winner: number | null;
  /** When the winner entered the finish core (its `finish` domino). */
  coreAt: number | null;
  /** When the result became visible: the winner's `win` domino, or its finish without one. */
  decidedAt: number | null;
  /** When the winner's picture panel starts and finishes toppling, if it has one. */
  panelFrom: number | null;
  panelTo: number | null;
  /** The lane with the next-best race time, and how far behind the winner it was. */
  runnerUp: number | null;
  marginSeconds: number | null;
  lanes: LaneTrack[];
  /** Dominoes falling per simulation second, in bins of `binSeconds`. */
  rate: Float32Array;
  binSeconds: number;
  /** When the wiring (everything that is not a lane) has mostly finished. */
  logicEnd: number;
}

const RATE_BIN_SECONDS = 0.1;
const FRONT_BIN_SECONDS = 0.5;
const LANE_KINDS = ['lane', 'lane-start', 'feeder'];
/** The show goes on this long after the winner's panel is down. */
const AFTER_PANEL_SECONDS = 3;
/** Without a panel, let the last dominoes finish falling. */
const AFTER_LAST_FALL_SECONDS = 0.4;

export function analyseRun(scene: Scene, result: SimResult): RunInfo {
  const { header } = scene;
  const tickSeconds = header.units.tick_s;
  const { fallTick, order } = result;
  const timeOf = (domino: number | null | undefined): number | null =>
    domino != null && fallTick[domino] >= 0 ? fallTick[domino] * tickSeconds : null;

  const duration = order.length > 0 ? fallTick[order[order.length - 1]] * tickSeconds : 0;

  // Activity over time, and separately for the wiring so we know when the logic is done.
  const bins = Math.max(1, Math.ceil(duration / RATE_BIN_SECONDS) + 1);
  const rate = new Float32Array(bins);
  const wiring = new Float32Array(bins);
  const isLaneKind = header.kinds.map((name) => LANE_KINDS.includes(name));

  // Per lane: the centroid of its dominoes falling in each half second.
  const frontBins = Math.max(1, Math.ceil(duration / FRONT_BIN_SECONDS) + 1);
  const laneCount = header.lanes.length;
  const sumX = new Float64Array(laneCount * frontBins);
  const sumY = new Float64Array(laneCount * frontBins);
  const sumN = new Uint32Array(laneCount * frontBins);
  const laneOfArm = new Int8Array(256).fill(-1);
  header.lanes.forEach((lane, index) => (laneOfArm[lane.digit] = index));

  let wiringTotal = 0;
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    const t = fallTick[i] * tickSeconds;
    const bin = Math.floor(t / RATE_BIN_SECONDS);
    rate[bin]++;
    const lane = isLaneKind[scene.kind[i]] ? laneOfArm[scene.arm[i]] : -1;
    if (lane < 0) {
      wiring[bin]++;
      wiringTotal++;
    } else {
      const at = lane * frontBins + Math.floor(t / FRONT_BIN_SECONDS);
      sumX[at] += scene.x[i];
      sumY[at] += scene.y[i];
      sumN[at]++;
    }
  }
  for (let b = 0; b < bins; b++) rate[b] /= RATE_BIN_SECONDS;

  let logicEnd = 0;
  for (let b = 0, seen = 0; b < bins; b++) {
    seen += wiring[b];
    if (seen >= 0.9 * wiringTotal) {
      logicEnd = (b + 1) * RATE_BIN_SECONDS;
      break;
    }
  }

  const lanes: LaneTrack[] = header.lanes.map((lane, index) => {
    const markTimes = (lane.marks ?? [])
      .map((domino) => timeOf(domino))
      .filter((t): t is number => t !== null)
      .sort((a, b) => a - b);
    const frontTime: number[] = [];
    const frontX: number[] = [];
    const frontY: number[] = [];
    for (let b = 0; b < frontBins; b++) {
      const n = sumN[index * frontBins + b];
      if (n === 0) continue;
      frontTime.push((b + 0.5) * FRONT_BIN_SECONDS);
      frontX.push(sumX[index * frontBins + b] / n);
      frontY.push(sumY[index * frontBins + b] / n);
    }
    const finishTime = timeOf(lane.finish);
    return {
      digit: lane.digit,
      startTime: timeOf(lane.start),
      finishTime,
      raceTime: finishTime === null ? null : finishTime + (lane.finishBias ?? 0) * tickSeconds,
      markCount: lane.marks?.length ?? 0,
      markTimes: Float64Array.from(markTimes),
      frontTime: Float32Array.from(frontTime),
      frontX: Float32Array.from(frontX),
      frontY: Float32Array.from(frontY),
    };
  });

  /** Lane indices that have a time, best first. */
  const ranked = (times: (number | null)[]): number[] =>
    times
      .map((t, index) => ({ t, index }))
      .filter((entry): entry is { t: number; index: number } => entry.t !== null)
      .sort((a, b) => a.t - b.t)
      .map((entry) => entry.index);

  // With `win` dominoes, the winners are exactly the lanes whose win domino
  // fell (two in a tie, none if the machine could not decide). Without them,
  // the winner is the best race time.
  const winTimes = header.lanes.map((lane) => timeOf(lane.win));
  const byRaceTime = ranked(lanes.map((lane) => lane.raceTime));
  const hasWinDominoes = header.lanes.some((lane) => lane.win != null);
  const winners = hasWinDominoes ? ranked(winTimes) : byRaceTime.slice(0, 1);
  const winner = winners.length > 0 ? winners[0] : null;

  let coreAt: number | null = null;
  let decidedAt: number | null = null;
  let panelFrom: number | null = null;
  let panelTo: number | null = null;
  let runnerUp: number | null = null;
  let marginSeconds: number | null = null;
  if (winner !== null) {
    coreAt = lanes[winner].finishTime;
    decidedAt = winTimes[winner] ?? lanes[winner].finishTime;

    const panel = header.lanes[winner].panel;
    if (panel) {
      for (let i = panel.first; i < panel.first + panel.count; i++) {
        const t = timeOf(i);
        if (t === null) continue;
        if (panelFrom === null || t < panelFrom) panelFrom = t;
        if (panelTo === null || t > panelTo) panelTo = t;
      }
    }

    const winnerTime = lanes[winner].raceTime;
    const others = byRaceTime.filter((index) => !winners.includes(index));
    if (winners.length === 1 && winnerTime !== null && others.length > 0) {
      runnerUp = others[0];
      marginSeconds = lanes[runnerUp].raceTime! - winnerTime;
    }
  }

  const end =
    panelTo !== null
      ? Math.min(duration + AFTER_LAST_FALL_SECONDS, panelTo + AFTER_PANEL_SECONDS)
      : duration + AFTER_LAST_FALL_SECONDS;

  // `order` is sorted by fall time, so the dominoes down by `end` are a prefix of it.
  let fallen = order.length;
  if (end < duration) {
    const endTick = end / tickSeconds;
    let lo = 0;
    let hi = order.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (fallTick[order[mid]] <= endTick) lo = mid + 1;
      else hi = mid;
    }
    fallen = lo;
  }

  return {
    result,
    tickSeconds,
    duration,
    end,
    fallen,
    winners,
    winner,
    coreAt,
    decidedAt,
    panelFrom,
    panelTo,
    runnerUp,
    marginSeconds,
    lanes,
    rate,
    binSeconds: RATE_BIN_SECONDS,
    logicEnd,
  };
}

/** Number of entries of an ascending array that are <= t. */
function countUpTo(times: ArrayLike<number>, t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * How far along its lane a digit is at time t, 0..1. With checkpoints this is
 * the share of them that have fallen (gliding between one and the next);
 * without, it is the share of the lane's own race time that has passed.
 */
export function laneProgress(track: LaneTrack, t: number): number {
  if (track.markCount > 0) {
    const passed = countUpTo(track.markTimes, t);
    if (passed >= track.markTimes.length) return passed / track.markCount;
    const from = passed > 0 ? track.markTimes[passed - 1] : (track.startTime ?? 0);
    const to = track.markTimes[passed];
    const glide = to > from ? Math.min(1, Math.max(0, (t - from) / (to - from))) : 0;
    return (passed + glide) / track.markCount;
  }
  if (track.startTime === null || track.finishTime === null) return 0;
  const span = track.finishTime - track.startTime;
  return span > 0 ? Math.min(1, Math.max(0, (t - track.startTime) / span)) : 0;
}

/** The lane furthest along at time t, or null before any lane has moved. */
export function leadingLane(info: RunInfo, t: number): number | null {
  let best: number | null = null;
  let bestProgress = 0;
  info.lanes.forEach((track, index) => {
    const progress = laneProgress(track, t);
    if (progress > bestProgress) {
      best = index;
      bestProgress = progress;
    }
  });
  return best;
}

/** Where a lane's wavefront is at time t (machine mm), or null before it starts. */
export function laneFront(track: LaneTrack, t: number): [number, number] | null {
  const n = track.frontTime.length;
  if (n === 0 || t < track.frontTime[0] - FRONT_BIN_SECONDS) return null;
  const next = countUpTo(track.frontTime, t);
  if (next === 0) return [track.frontX[0], track.frontY[0]];
  if (next >= n) return [track.frontX[n - 1], track.frontY[n - 1]];
  const a = next - 1;
  const span = track.frontTime[next] - track.frontTime[a];
  const f = span > 0 ? (t - track.frontTime[a]) / span : 0;
  return [
    track.frontX[a] + (track.frontX[next] - track.frontX[a]) * f,
    track.frontY[a] + (track.frontY[next] - track.frontY[a]) * f,
  ];
}

/** Dominoes falling per simulation second at time t. */
export function rateAt(info: RunInfo, t: number): number {
  const bin = Math.floor(t / info.binSeconds);
  return bin >= 0 && bin < info.rate.length ? info.rate[bin] : 0;
}

/**
 * How many of a lane's gates voted yes, worked out from its race time: with
 * every vote a yes the lane takes `allShort_s` (plus its head-start offset),
 * and each no adds one detour of `delta_s`.
 */
export function yesVotes(
  track: LaneTrack,
  laneIndex: number,
  timing: Record<string, number> | undefined,
): { yes: number; total: number } | null {
  const delta = timing?.delta_s;
  const base = timing?.allShort_s;
  if (!delta || base === undefined || track.raceTime === null) return null;
  // The last two checkpoints are the lane's end and its entry to the core, not votes.
  const total = Math.max(0, track.markCount - 2);
  const offset = (timing?.eps_s ?? 0) * laneIndex;
  const against = Math.round((track.raceTime - base - offset) / delta);
  if (against < 0 || against > total) return null;
  return { yes: total - against, total };
}
