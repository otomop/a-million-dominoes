import type { RunInfo } from './machine/run';

/** 'auto' paces the whole show to well under a minute; a number is a fixed multiple of real time. */
export type SpeedMode = 'auto' | number;

/** How long the whole show lasts on Auto, in wall-clock seconds. */
const AUTO_SHOW_SECONDS = 40;

/*
 * Auto is paced by the winner's story, not by the last domino: it cruises
 * through the race, then gives each part of the ending a fixed share of
 * wall-clock time, whatever its length in simulation time.
 */
/** The finish: from just before the winner enters the core until its gate has opened. */
const FINISH_LEAD_SECONDS = 4;
const FINISH_TRAIL_SECONDS = 1.5;
const FINISH_WALL_SECONDS = 7;
/** The winning line running from its gate to its picture panel. */
const TRANSIT_WALL_SECONDS = 3.5;
/** The panel toppling into a digit. */
const PANEL_WALL_SECONDS = 6.5;
/** After the panel (or, without one, after the finish) nothing hurries. */
const REST_SPEED = 1.5;
const EPILOGUE_WALL_SECONDS = 9;
/** Auto starts gently so the starters can be seen going over. */
const OPENING_SPEED = 4;
const OPENING_SECONDS = 16;
/** Speeds blend over this many simulation seconds around each change. */
const BLEND_SECONDS = 2.5;

function clamp(x: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, x));
}

function smoothstep(from: number, to: number, x: number): number {
  if (to <= from) return x >= to ? 1 : 0;
  const u = clamp((x - from) / (to - from), 0, 1);
  return u * u * (3 - 2 * u);
}

/** A stretch of the run played at one speed; `null` means the cruise speed. */
interface Stretch {
  from: number;
  speed: number | null;
}

/** The parts of the show after the cruise, in order. */
function ending(info: RunInfo): Stretch[] {
  const { decidedAt, end } = info;
  if (decidedAt === null) return [];
  const pace = (span: number, wall: number, low: number, high: number): number =>
    clamp(span / wall, low, high);

  const finishFrom = Math.max(
    0,
    Math.min(info.coreAt ?? decidedAt, decidedAt) - FINISH_LEAD_SECONDS,
  );
  const finishTo = Math.min(end, decidedAt + FINISH_TRAIL_SECONDS);
  const stretches: Stretch[] = [
    { from: finishFrom, speed: pace(finishTo - finishFrom, FINISH_WALL_SECONDS, REST_SPEED, 8) },
  ];
  if (info.panelFrom !== null && info.panelTo !== null) {
    const panelFrom = Math.max(finishTo, info.panelFrom);
    stretches.push(
      { from: finishTo, speed: pace(panelFrom - finishTo, TRANSIT_WALL_SECONDS, 2, 16) },
      { from: panelFrom, speed: pace(info.panelTo - panelFrom, PANEL_WALL_SECONDS, REST_SPEED, 8) },
      { from: info.panelTo, speed: REST_SPEED },
    );
  } else {
    stretches.push({
      from: finishTo,
      speed: Math.max(REST_SPEED, (end - finishTo) / EPILOGUE_WALL_SECONDS),
    });
  }
  return stretches;
}

/**
 * The Auto speed as a function of simulation time. Being a function of
 * simulation time (not of the wall clock), it stays right after scrubbing.
 */
function autoProfile(info: RunInfo): (t: number) => number {
  const stretches: Stretch[] = [{ from: 0, speed: null }, ...ending(info)];

  const profile =
    (cruise: number) =>
    (t: number): number => {
      // Blend geometrically from each stretch into the next around their boundary.
      let log = 0;
      stretches.forEach((stretch, index) => {
        const target = Math.log(stretch.speed ?? cruise);
        if (index === 0) {
          log = target;
          return;
        }
        const half = Math.min(BLEND_SECONDS, (stretch.from - stretches[index - 1].from) / 2);
        log += (target - log) * smoothstep(stretch.from - half, stretch.from + half, t);
      });
      const opening = Math.min(cruise, OPENING_SPEED);
      return Math.exp(log) * (1 - (1 - opening / cruise) * (1 - smoothstep(0, OPENING_SECONDS, t)));
    };

  // Find the cruise speed that makes the whole show take AUTO_SHOW_SECONDS.
  const wallSeconds = (cruise: number): number => {
    const speed = profile(cruise);
    const step = Math.max(0.02, info.end / 4000);
    let wall = 0;
    for (let t = 0; t < info.end; t += step) wall += step / speed(t + step / 2);
    return wall;
  };
  let low = REST_SPEED;
  let high = 400;
  for (let i = 0; i < 24; i++) {
    const middle = Math.sqrt(low * high);
    if (wallSeconds(middle) > AUTO_SHOW_SECONDS) low = middle;
    else high = middle;
  }
  return profile(Math.sqrt(low * high));
}

/** The run's clock: simulation time, advanced by the wall clock at the chosen speed. */
export class Playback {
  time = 0;
  playing = false;
  mode: SpeedMode = 'auto';
  /** Where the clock stops (see RunInfo.end). */
  end = 0;
  private auto: (t: number) => number = () => 1;

  load(info: RunInfo): void {
    this.end = info.end;
    this.auto = autoProfile(info);
    this.time = 0;
    this.playing = true;
  }

  /** Simulation seconds per wall-clock second right now. */
  get speed(): number {
    return this.mode === 'auto' ? this.auto(this.time) : this.mode;
  }

  get finished(): boolean {
    return this.end > 0 && this.time >= this.end;
  }

  advance(wallSeconds: number): void {
    if (!this.playing) return;
    this.time = Math.min(this.end, this.time + wallSeconds * this.speed);
    if (this.time >= this.end) this.playing = false;
  }

  seek(time: number): void {
    this.time = clamp(time, 0, this.end);
  }

  toggle(): void {
    if (this.end <= 0) return;
    if (!this.playing && this.finished) this.time = 0; // play again from the top
    this.playing = !this.playing;
  }
}
