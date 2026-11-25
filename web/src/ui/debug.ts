import type { FrameStats } from '../render/renderer';
import { formatCount, h } from './dom';

/** The ?debug readout: frame rate, what was drawn, and which GPU drew it. */
export class DebugReadout {
  readonly element = h('pre', { class: 'debug', attrs: { 'aria-hidden': 'true' } });
  private frames = 0;
  private seconds = 0;
  private drawMs = 0;
  private notes: string[] = [];

  constructor(private readonly gpu: string) {
    this.element.textContent = gpu;
  }

  /** Add a line that stays on the readout (load and simulation timings). */
  note(text: string): void {
    this.notes = [...this.notes.slice(-3), text];
  }

  /**
   * Record one drawn frame. `drawMs` is the time to issue the frame and wait
   * for the GPU to finish it (gl.finish), which shows headroom beyond vsync.
   */
  frame(dt: number, drawMs: number, stats: FrameStats, canvas: HTMLCanvasElement): void {
    this.frames++;
    this.seconds += dt;
    this.drawMs += drawMs;
    if (this.seconds < 0.5) return;
    const fps = this.frames / this.seconds;
    const ms = this.drawMs / this.frames;
    this.frames = this.seconds = this.drawMs = 0;
    this.element.textContent = [
      `${fps.toFixed(0)} fps   draw+finish ${ms.toFixed(1)} ms   ${canvas.width}x${canvas.height}`,
      `${formatCount(stats.triangles)} tris   ${formatCount(stats.points)} points   ${stats.drawCalls} draws`,
      `boxes ${formatCount(stats.boxes)}   quads ${formatCount(stats.quads)}   tiles ${stats.tilesVisible}`,
      ...this.notes,
      this.gpu,
    ].join('\n');
  }
}
