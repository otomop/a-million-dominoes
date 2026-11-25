import { rateAt, type RunInfo } from './machine/run';
import { ARM_SHARED } from './machine/types';

/**
 * The sound of the run, synthesised with WebAudio (no audio files): a noise
 * bed whose loudness follows how many dominoes are falling per second of
 * wall-clock time, and individual clicks, pitched slightly differently for each
 * digit's arm, that carry the sound when few are falling.
 *
 * Nothing is scheduled more than a frame ahead, and the bed only ever moves
 * with short ramps, so pausing and scrubbing cannot click or leave notes hanging.
 */

const MASTER_LEVEL = 0.55;
const BED_LEVEL = 0.5;
/** Falls per wall-clock second at which the bed is about two thirds of full loudness. */
const BED_KNEE = 3000;
const MAX_CLICKS_PER_FRAME = 3;
/** A jump in simulation time larger than this many wall-clock seconds is a seek, not playback. */
const SEEK_THRESHOLD_SECONDS = 0.25;

export class Sound {
  enabled = false;
  private context: AudioContext | null = null;
  private master!: GainNode;
  private bed!: GainNode;
  private bedTone!: BiquadFilterNode;
  private click!: AudioBuffer;
  private info: RunInfo | null = null;
  private arm: Uint8Array | null = null;
  private lastTime: number | null = null;

  constructor() {
    // A hidden tab stops calling update(), so silence the bed rather than let it drone.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.hush();
    });
  }

  /** Must be called from a user gesture the first time, so the browser lets audio start. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled && !this.context) this.build();
    if (!this.context) return;
    if (enabled) void this.context.resume();
    this.master.gain.setTargetAtTime(enabled ? MASTER_LEVEL : 0, this.context.currentTime, 0.03);
  }

  /** Call from the Topple click: browsers may have suspended the context since it was enabled. */
  wake(): void {
    if (this.enabled) void this.context?.resume();
  }

  setRun(info: RunInfo, arm: Uint8Array): void {
    this.info = info;
    this.arm = arm;
    this.lastTime = null;
  }

  /** Called every frame with the playback state. `speed` is simulation seconds per wall second. */
  update(time: number, playing: boolean, speed: number): void {
    const context = this.context;
    if (!context || !this.enabled || !this.info || !this.arm) return;
    if (!playing) {
      this.hush();
      return;
    }
    const now = context.currentTime;
    const from = this.lastTime;
    this.lastTime = time;

    const fallsPerSecond = rateAt(this.info, time) * speed;
    const density = 1 - Math.exp(-fallsPerSecond / BED_KNEE);
    this.bed.gain.setTargetAtTime(BED_LEVEL * density, now, 0.09);
    this.bedTone.frequency.setTargetAtTime(1100 + 1900 * density, now, 0.15);

    // Clicks for the dominoes that fell since the last frame, unless this was a seek.
    if (from === null || time <= from || time - from > SEEK_THRESHOLD_SECONDS * speed) return;
    const { order, fallTick } = this.info.result;
    const tick = this.info.tickSeconds;
    const first = this.firstAtOrAfter(from);
    const end = this.firstAtOrAfter(time);
    const count = end - first;
    if (count <= 0) return;

    // When many fall in one frame, play a few of them, quieter: the bed carries the rest.
    const voices = Math.min(count, MAX_CLICKS_PER_FRAME);
    const level = Math.min(1, 0.4 + 0.6 / Math.sqrt(1 + fallsPerSecond / 40));
    for (let v = 0; v < voices; v++) {
      const k =
        count <= MAX_CLICKS_PER_FRAME ? first + v : first + Math.floor(Math.random() * count);
      const domino = order[k];
      const when = now + (fallTick[domino] * tick - from) / speed;
      this.playClick(when, this.arm[domino], level);
    }
  }

  private hush(): void {
    if (!this.context) return;
    this.bed.gain.setTargetAtTime(0, this.context.currentTime, 0.05);
    this.lastTime = null;
  }

  /** Index of the first fall at or after the given simulation time. */
  private firstAtOrAfter(time: number): number {
    const { order, fallTick } = this.info!.result;
    const target = time / this.info!.tickSeconds;
    let lo = 0;
    let hi = order.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (fallTick[order[mid]] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private playClick(when: number, arm: number, level: number): void {
    const context = this.context!;
    const source = context.createBufferSource();
    source.buffer = this.click;
    // Each arm sits a little higher than the last: about half a semitone per digit.
    const step = arm === ARM_SHARED ? 0 : arm - 4.5;
    source.playbackRate.value = 2 ** (step / 22) * (0.96 + 0.08 * Math.random());
    const gain = context.createGain();
    gain.gain.value = level * (0.7 + 0.3 * Math.random());
    source.connect(gain).connect(this.master);
    source.start(Math.max(when, context.currentTime));
  }

  private build(): void {
    const context = new AudioContext();
    this.context = context;
    const rate = context.sampleRate;

    this.master = context.createGain();
    this.master.gain.value = 0;
    this.master.connect(context.destination);

    // Bed: looped noise through a gentle band-pass, like thousands of clicks blurred together.
    const noise = context.createBuffer(1, rate * 2, rate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    this.bedTone = context.createBiquadFilter();
    this.bedTone.type = 'bandpass';
    this.bedTone.frequency.value = 1100;
    this.bedTone.Q.value = 0.5;
    this.bed = context.createGain();
    this.bed.gain.value = 0;
    source.connect(this.bedTone).connect(this.bed).connect(this.master);
    source.start();

    // One click: a short knock (two damped partials) with a noise transient on its front.
    const length = Math.floor(rate * 0.05);
    this.click = context.createBuffer(1, length, rate);
    const click = this.click.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      const knock =
        Math.sin(2 * Math.PI * 1750 * t) * Math.exp(-t / 0.007) +
        0.6 * Math.sin(2 * Math.PI * 3050 * t) * Math.exp(-t / 0.004);
      const snap = (Math.random() * 2 - 1) * Math.exp(-t / 0.0015);
      click[i] = 0.5 * knock + 0.5 * snap;
    }
  }
}
