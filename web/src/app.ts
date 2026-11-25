import { Sound } from './audio';
import { computeView, OrbitCamera, type Framing, type Pose, type View } from './camera/camera';
import { OrbitControls } from './camera/controls';
import { Director } from './camera/director';
import { analyseRun, type RunInfo } from './machine/run';
import { SimClient } from './machine/simClient';
import type { Machine, Scene } from './machine/types';
import { Playback } from './playback';
import { ARM_COLORS, css } from './render/palette';
import { Renderer } from './render/renderer';
import { MM, worldFromHeader, worldX, worldY, type World } from './render/world';
import { copy } from './ui/copy';
import { DebugReadout } from './ui/debug';
import { h, icons } from './ui/dom';
import { DrawPanel } from './ui/drawpanel';
import { loadExamples } from './ui/examples';
import { InfoDrawer } from './ui/info';
import { RacePanel } from './ui/race';
import { Timeline } from './ui/timeline';

const MAX_PIXEL_RATIO = 2;
/**
 * If frames take longer than this for a while, render at a lower resolution.
 * The limit sits below 30 fps so that a display capped at 30 Hz does not trip it.
 */
const SLOW_FRAME_SECONDS = 1 / 24;
const THROTTLED_FRAME_SECONDS = 0.25;
const MIN_RESOLUTION_SCALE = 0.5;
/** The arrow keys move the scrubber by this share of the run. */
const KEY_SCRUB_SHARE = 0.01;
/** Below this width the page uses its small-screen layout (keep in step with style.css). */
const SMALL_SCREEN = '(max-width: 760px)';
/** A scene in which nothing moves is still redrawn this often. */
const IDLE_REDRAW_MS = 1000;
/** How quickly the view re-centres when panels appear or move, per second. */
const REFRAME_RATE = 3.5;

/** The running page: owns the scene, the clock, and every panel, and drives the frame loop. */
export class App {
  private readonly scene: Scene;
  private readonly world: World;
  private readonly renderer: Renderer;
  private readonly camera: OrbitCamera;
  private readonly director: Director;
  private readonly playback = new Playback();
  private readonly sound = new Sound();
  private readonly sim: SimClient;
  private readonly drawPanel: DrawPanel;
  private readonly race: RacePanel;
  private readonly timeline: Timeline;
  private readonly info: InfoDrawer;
  private readonly debug: DebugReadout | null;
  private readonly digits: number[];
  private readonly colors: string[];

  private view: View;
  /** Where the scene sits on screen; eased towards framingGoal when panels come and go. */
  private framing: Framing;
  private framingGoal: Framing;
  private framingStale = true;
  /** After a window resize the view re-centres at once instead of gliding. */
  private framingSnap = false;
  private run: RunInfo | null = null;
  private lastFrame = performance.now();
  private throttled = false;
  private runCount = 0;
  private lastDrawn = '';
  private lastDrawnAt = 0;
  private resolutionScale = 1;
  private slowFrames = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    machine: Machine,
    debug: boolean,
  ) {
    this.scene = machine.scene;
    const { header } = this.scene;
    this.world = worldFromHeader(header);
    this.renderer = new Renderer(canvas, this.scene, this.world);
    this.sim = new SimClient(machine.graph);
    this.digits = header.lanes.map((lane) => lane.digit);
    this.colors = this.digits.map((digit) => css(ARM_COLORS[digit % ARM_COLORS.length]));

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start: Pose = { x: 0, y: 0, dist: this.world.radius * 3, az: 0, el: 0.82 };
    this.camera = new OrbitCamera(start, {
      halfWidth: this.world.halfWidth + 4,
      halfHeight: this.world.halfHeight + 4,
      maxDistance: this.world.radius * 6,
    });
    this.director = new Director(this.camera, this.scene, this.world, reducedMotion);
    new OrbitControls(
      canvas,
      this.camera,
      () => this.view,
      () => {
        this.director.enabled = false;
        this.root.dataset.steered = 'true';
      },
    );

    // Panels.
    this.drawPanel = new DrawPanel(header.model, header.count);
    this.race = new RacePanel(this.digits, this.colors, header.count);
    this.timeline = new Timeline();
    this.info = new InfoDrawer(header);
    this.debug = debug ? new DebugReadout(this.renderer.gpuName()) : null;

    const infoButton = h(
      'button',
      { class: 'button ghost', attrs: { type: 'button' } },
      h('span', { class: 'button-icon', html: icons.info }),
      h('span', { text: copy.info.button }),
    );
    const soundButton = h('button', {
      class: 'icon-button',
      html: icons.soundOff,
      attrs: { type: 'button', 'aria-label': copy.sound.turnOn, 'aria-pressed': 'false' },
    });
    root.append(
      h('div', { class: 'top-actions' }, infoButton, soundButton),
      this.drawPanel.element,
      this.race.element,
      this.timeline.element,
      h('p', { class: 'camera-hint', text: copy.camera.hint }),
      this.info.element,
    );
    if (this.debug) root.append(this.debug.element);

    // Frame the machine in whatever part of the screen the panels leave free.
    root.dataset.state = 'idle';
    root.dataset.sheet = 'open';
    this.framingGoal = this.measureFraming();
    this.framing = { ...this.framingGoal };
    this.camera.setGoal(this.director.overview(this.framing), 1);
    this.camera.snap();
    this.view = this.computeView();
    const reframe = new ResizeObserver(() => (this.framingStale = true));
    for (const panel of [this.drawPanel, this.race, this.timeline, this.info]) {
      reframe.observe(panel.element);
    }
    new ResizeObserver(() => (this.framingStale = this.framingSnap = true)).observe(root);

    // Wiring.
    this.drawPanel.onTopple = (bits) => void this.topple(bits);
    this.drawPanel.onClose = () => this.setSheet('closed');
    this.timeline.onDraw = () => this.setSheet('open');
    this.timeline.onToggle = () => this.playback.toggle();
    this.timeline.onSeek = (time) => this.playback.seek(time);
    this.timeline.onSpeed = (mode) => (this.playback.mode = mode);
    this.timeline.onFollow = () => (this.director.enabled = !this.director.enabled);
    infoButton.addEventListener('click', () => {
      if (this.info.isOpen) this.info.close();
      else this.info.open(infoButton);
    });
    this.info.onFly = (stop) => {
      this.director.flyTo(
        worldX(this.world, stop.x),
        worldY(this.world, stop.y),
        stop.r * MM,
        this.framing,
      );
      if (window.matchMedia(SMALL_SCREEN).matches) this.info.close();
    };
    soundButton.addEventListener('click', () => {
      this.sound.setEnabled(!this.sound.enabled);
      const on = this.sound.enabled;
      soundButton.innerHTML = on ? icons.soundOn : icons.soundOff;
      soundButton.setAttribute('aria-pressed', String(on));
      soundButton.setAttribute('aria-label', on ? copy.sound.turnOff : copy.sound.turnOn);
    });
    window.addEventListener('keydown', this.onKey);
    // Coming back to the tab, draw at once rather than wait for something to move.
    document.addEventListener('visibilitychange', () => (this.lastDrawn = ''));

    loadExamples(header.model.thresholds)
      .then((examples) => this.drawPanel.setExamples(examples))
      .catch((error) => console.warn(error));

    requestAnimationFrame(this.frame);
  }

  /** Add a line to the ?debug readout. */
  note(text: string): void {
    this.debug?.note(text);
  }

  private setSheet(sheet: 'open' | 'closed'): void {
    this.root.dataset.sheet = sheet;
    this.framingStale = true;
  }

  /**
   * Work out which part of the screen is not under a panel. On wide screens the
   * drawing panel takes the left and the race the right; on small screens the
   * masthead and race take the top and the sheet or timeline the bottom.
   */
  private measureFraming(): Framing {
    const width = this.canvas.clientWidth || 1280;
    const height = this.canvas.clientHeight || 720;
    const box = (element: Element): DOMRect | null => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? rect : null;
    };
    const draw = box(this.drawPanel.element);
    const race = box(this.race.element);
    const timeline = box(this.timeline.element);
    let left = 0;
    let right = 0;
    let top = 0;
    let bottom = timeline ? height - timeline.top : 0;
    if (window.matchMedia(SMALL_SCREEN).matches) {
      const masthead = box(this.root.querySelector('.masthead')!);
      top = (race ?? masthead)?.bottom ?? 0;
      if (draw) bottom = height - draw.top;
    } else {
      const drawer = box(this.info.element);
      if (draw) left = draw.right;
      if (race) right = width - race.left;
      if (drawer) right = Math.max(right, width - drawer.left);
    }
    // Never frame into less than a third of the screen, whatever the panels do.
    const freeWidth = Math.max(0.34, 1 - (left + right) / width);
    const freeHeight = Math.max(0.34, 1 - (top + bottom) / height);
    return {
      aspect: width / height,
      shiftX: Math.min(1 - freeWidth, Math.max(freeWidth - 1, (left - right) / width)),
      shiftY: Math.min(1 - freeHeight, Math.max(freeHeight - 1, (bottom - top) / height)),
      freeWidth,
      freeHeight,
    };
  }

  private computeView(): View {
    return computeView(this.camera.pose, this.framing, this.canvas.height, this.world.radius);
  }

  /** Run the machine on the given input bits and start playing the result. */
  private async topple(bits: Uint8Array): Promise<void> {
    this.drawPanel.setBusy(true);
    this.sound.wake();
    try {
      const result = await this.sim.run(bits);
      const run = analyseRun(this.scene, result);
      this.run = run;
      this.runCount++;
      this.renderer.setRun(result, run.tickSeconds);
      this.playback.load(run);
      this.director.setRun(run);
      this.race.setRun(run);
      this.timeline.setRun(run, this.playback.end);
      this.sound.setRun(run, this.scene.arm);
      this.debug?.note(`sim ${result.elapsed.toFixed(0)} ms`);
      this.root.dataset.state = 'run';
      this.setSheet('closed');
    } finally {
      this.drawPanel.setBusy(false);
    }
  }

  private onKey = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape') {
      this.info.close();
      return;
    }
    if (!this.run) return;
    const isSpace = event.code === 'Space';
    const isArrow = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    if (!isSpace && !isArrow) return;

    // A control reached with the keyboard keeps its own keys. One that merely
    // holds focus because it was clicked does not: after pressing Topple with
    // the mouse, Space should pause the run, not topple again. The scrubber
    // has no use for Space, and its own arrow steps are too small to be useful.
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest<HTMLElement>('button, a, input, select, textarea') ?? null;
    const isScrubber = control instanceof HTMLInputElement && control.type === 'range';
    if (control && !isScrubber && control.matches(':focus-visible')) return;

    event.preventDefault();
    if (control && !isScrubber) control.blur();
    if (isSpace) {
      this.playback.toggle();
    } else {
      const step = this.playback.end * KEY_SCRUB_SHARE * (event.shiftKey ? 5 : 1);
      this.playback.seek(this.playback.time + (event.key === 'ArrowLeft' ? -step : step));
    }
  };

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const elapsed = Math.max(0, (now - this.lastFrame) / 1000);
    const dt = Math.min(0.1, elapsed);
    this.lastFrame = Math.max(this.lastFrame, now);
    // A long gap means the tab was in the background, not that the GPU is slow.
    this.throttled = document.hidden || elapsed > THROTTLED_FRAME_SECONDS;

    const { playback, run } = this;
    playback.advance(dt);
    const speed = playback.speed;
    if (this.framingStale) {
      this.framingStale = false;
      this.framingGoal = this.measureFraming();
    }
    const ease = this.framingSnap ? 1 : 1 - Math.exp(-REFRAME_RATE * dt);
    this.framingSnap = false;
    for (const key of ['shiftX', 'shiftY', 'freeWidth', 'freeHeight'] as const) {
      this.framing[key] += (this.framingGoal[key] - this.framing[key]) * ease;
    }
    this.framing.aspect = this.framingGoal.aspect;
    this.director.update(playback.time, playback.playing, dt, this.framing);
    this.camera.update(dt);

    const pixelRatio =
      Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO) * this.resolutionScale;
    this.renderer.resize(pixelRatio);
    this.view = this.computeView();
    const decided = run !== null && run.decidedAt !== null && playback.time >= run.decidedAt;
    this.renderer.winner = decided && run.winner !== null ? this.digits[run.winner] : -1;

    // Draw only when something moved, so a paused, untouched scene costs almost
    // nothing. It is still redrawn now and then, because a browser may drop a
    // canvas's last frame (after the tab was hidden, for one).
    const { pose } = this.camera;
    const drawn = [
      pose.x.toFixed(4),
      pose.y.toFixed(4),
      pose.dist.toFixed(4),
      pose.az.toFixed(5),
      pose.el.toFixed(5),
      playback.time.toFixed(4),
      this.framing.shiftX.toFixed(4),
      this.framing.shiftY.toFixed(4),
      this.canvas.width,
      this.canvas.height,
      this.renderer.winner,
      this.runCount,
    ].join(' ');
    if (drawn !== this.lastDrawn || now - this.lastDrawnAt > IDLE_REDRAW_MS) {
      this.lastDrawn = drawn;
      this.lastDrawnAt = now;
      const before = this.debug ? performance.now() : 0;
      this.renderer.render(this.view, playback.time, speed);
      if (this.debug) {
        this.renderer.finish();
        this.debug.frame(dt, performance.now() - before, this.renderer.stats, this.canvas);
      }
      this.adaptResolution(dt);
    }

    if (run) {
      this.timeline.update({
        time: playback.time,
        end: playback.end,
        playing: playback.playing,
        finished: playback.finished,
        speed,
        following: this.director.enabled,
      });
      this.race.update(playback.time);
    }
    this.sound.update(playback.time, playback.playing, speed);
  };

  /** Trade resolution for frame rate on GPUs that cannot keep up. It never goes back up. */
  private adaptResolution(dt: number): void {
    if (this.throttled) return;
    this.slowFrames =
      dt > SLOW_FRAME_SECONDS ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 2);
    if (this.slowFrames > 40 && this.resolutionScale > MIN_RESOLUTION_SCALE) {
      this.resolutionScale = Math.max(MIN_RESOLUTION_SCALE, this.resolutionScale * 0.8);
      this.slowFrames = 0;
    }
  }
}
