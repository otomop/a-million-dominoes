import type { RunInfo } from '../machine/run';
import type { SpeedMode } from '../playback';
import { copy } from './copy';
import { fitCanvas, formatClock, h, icons } from './dom';

const SPEEDS: SpeedMode[] = ['auto', 1, 8, 32];
/** The scrubber's resolution in simulation seconds. */
const STEP_SECONDS = 0.1;

/** Transport along the bottom: play/pause, scrubber over the whole run, clock, speed, Follow. */
export class Timeline {
  readonly element: HTMLElement;
  onToggle: () => void = () => {};
  onSeek: (time: number) => void = () => {};
  onSpeed: (mode: SpeedMode) => void = () => {};
  onFollow: () => void = () => {};
  onDraw: () => void = () => {};

  private readonly playButton: HTMLButtonElement;
  private readonly range: HTMLInputElement;
  private readonly activity: HTMLCanvasElement;
  private readonly clock: HTMLElement;
  private readonly pace: HTMLElement;
  private readonly followButton: HTMLButtonElement;
  private readonly speedButtons: HTMLButtonElement[];
  private info: RunInfo | null = null;
  private shown = { icon: '', clock: '', pace: '', value: -1, following: null as boolean | null };

  constructor() {
    this.playButton = h('button', {
      class: 'icon-button play',
      attrs: { type: 'button', 'aria-label': copy.timeline.play },
    });
    this.range = h('input', {
      class: 'scrub-range',
      attrs: {
        type: 'range',
        min: 0,
        max: 1,
        step: STEP_SECONDS,
        value: 0,
        'aria-label': copy.timeline.scrub,
      },
    });
    this.activity = h('canvas', { class: 'scrub-activity', attrs: { 'aria-hidden': 'true' } });
    this.clock = h('span', { class: 'clock' });
    this.pace = h('span', { class: 'pace' });
    this.followButton = h(
      'button',
      {
        class: 'button ghost follow',
        attrs: { type: 'button', 'aria-label': copy.timeline.followLabel, 'aria-pressed': 'true' },
      },
      h('span', { class: 'button-icon', html: icons.follow }),
      h('span', { class: 'follow-text', text: copy.timeline.following }),
    );
    this.speedButtons = SPEEDS.map((mode) =>
      h('button', {
        class: 'segment',
        text: mode === 'auto' ? copy.timeline.auto : copy.timeline.times(mode),
        attrs: { type: 'button', role: 'radio', 'aria-checked': String(mode === 'auto') },
      }),
    );
    const drawButton = h(
      'button',
      {
        class: 'button ghost draw-again',
        attrs: { type: 'button', 'aria-label': copy.pad.drawAnotherLabel },
      },
      h('span', { class: 'button-icon', html: icons.pencil }),
      h('span', { text: copy.pad.drawAnother }),
    );

    this.element = h(
      'section',
      { class: 'panel timeline', attrs: { 'aria-label': copy.timeline.label } },
      this.playButton,
      h('div', { class: 'scrub' }, this.activity, this.range),
      h('div', { class: 'readout' }, this.clock, this.pace),
      h(
        'div',
        { class: 'transport-extras' },
        h(
          'div',
          { class: 'segmented', attrs: { role: 'radiogroup', 'aria-label': copy.timeline.speed } },
          ...this.speedButtons,
        ),
        this.followButton,
        drawButton,
      ),
    );

    this.playButton.addEventListener('click', () => this.onToggle());
    this.range.addEventListener('input', () => this.onSeek(Number(this.range.value)));
    this.followButton.addEventListener('click', () => this.onFollow());
    drawButton.addEventListener('click', () => this.onDraw());
    this.speedButtons.forEach((button, index) =>
      button.addEventListener('click', () => {
        this.speedButtons.forEach((b, i) => b.setAttribute('aria-checked', String(i === index)));
        this.onSpeed(SPEEDS[index]);
      }),
    );
    new ResizeObserver(() => this.paintActivity()).observe(this.activity);
  }

  setRun(info: RunInfo, end: number): void {
    this.info = info;
    this.range.max = String(Math.ceil(end / STEP_SECONDS) * STEP_SECONDS);
    this.shown.value = -1;
    this.paintActivity();
  }

  /** Called every frame; touches the DOM only when something visible changed. */
  update(state: {
    time: number;
    end: number;
    playing: boolean;
    finished: boolean;
    speed: number;
    following: boolean;
  }): void {
    const icon = state.playing ? 'pause' : state.finished ? 'replay' : 'play';
    if (icon !== this.shown.icon) {
      this.shown.icon = icon;
      this.playButton.innerHTML = icons[icon];
      this.playButton.setAttribute('aria-label', copy.timeline[icon]);
    }

    const value = Math.round(state.time / STEP_SECONDS);
    if (value !== this.shown.value) {
      this.shown.value = value;
      this.range.value = String(value * STEP_SECONDS);
      const share = state.end > 0 ? Math.min(1, state.time / state.end) : 0;
      this.range.style.setProperty('--played', `${(share * 100).toFixed(2)}%`);
    }

    const clock = copy.timeline.position(formatClock(state.time), formatClock(state.end));
    if (clock !== this.shown.clock) {
      this.shown.clock = clock;
      this.clock.textContent = clock;
      this.range.setAttribute('aria-valuetext', clock);
    }

    const multiple = state.speed >= 10 ? state.speed.toFixed(0) : state.speed.toFixed(1);
    const pace = copy.timeline.currentSpeed(multiple.replace(/\.0$/, ''));
    if (pace !== this.shown.pace) {
      this.shown.pace = pace;
      this.pace.textContent = pace;
    }

    if (state.following !== this.shown.following) {
      this.shown.following = state.following;
      this.followButton.setAttribute('aria-pressed', String(state.following));
      this.followButton.querySelector('.follow-text')!.textContent = state.following
        ? copy.timeline.following
        : copy.timeline.follow;
    }
  }

  /** A faint profile of how many dominoes fall over the run, behind the scrubber. */
  private paintActivity(): void {
    const width = this.activity.clientWidth;
    const height = this.activity.clientHeight;
    if (width === 0 || height === 0) return;
    const scale = fitCanvas(this.activity, width, height);
    const ctx = this.activity.getContext('2d')!;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!this.info) return;

    const { rate, binSeconds } = this.info;
    const end = Number(this.range.max);
    const columns = Math.floor(width / 2);
    const peaks = new Float32Array(columns);
    for (let b = 0; b < rate.length; b++) {
      const column = Math.min(columns - 1, Math.floor(((b * binSeconds) / end) * columns));
      if (rate[b] > peaks[column]) peaks[column] = rate[b];
    }
    // Square-root scale: the quiet race should still show next to the roar of the logic.
    const top = Math.sqrt(Math.max(1, ...peaks));
    ctx.fillStyle = 'rgba(241, 232, 212, 0.2)';
    for (let c = 0; c < columns; c++) {
      const bar = Math.max(1, (Math.sqrt(peaks[c]) / top) * height);
      ctx.fillRect(c * 2, (height - bar) / 2, 1, bar);
    }
  }
}
