import type { Stroke } from '../machine/input';
import { copy } from './copy';
import { fitCanvas, h } from './dom';

/**
 * The square the visitor draws in. It only collects strokes (in unit-square
 * coordinates) and paints them; turning them into bits is machine/input.ts.
 */
export class DrawPad {
  readonly element: HTMLElement;
  strokes: Stroke[] = [];
  /** Called whenever the drawing changes. */
  onChange: () => void = () => {};

  private readonly canvas: HTMLCanvasElement;
  private readonly hint: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly exampleCanvas = h('canvas', { attrs: { width: 8, height: 8 } });
  private example: Uint8Array | null = null;
  private activePointer: number | null = null;

  constructor() {
    this.canvas = h('canvas', {
      class: 'pad-canvas',
      attrs: { role: 'img', 'aria-label': copy.pad.canvasLabel },
    });
    this.hint = h('span', { class: 'pad-hint', text: copy.pad.hint });
    this.badge = h('span', { class: 'pad-badge' });
    this.element = h('div', { class: 'pad' }, this.canvas, this.hint, this.badge);

    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);
    new ResizeObserver(() => this.paint()).observe(this.canvas);
  }

  get hasInk(): boolean {
    return this.strokes.length > 0;
  }

  clear(): void {
    this.strokes = [];
    this.example = null;
    this.paint();
    this.onChange();
  }

  /** Show an example digit (8x8 ink levels) in place of a drawing. */
  showExample(levels: Uint8Array, digit: number): void {
    this.strokes = [];
    this.example = levels;
    this.badge.textContent = copy.pad.example(digit);
    this.paint();
  }

  private pointOf(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  }

  private onDown = (event: PointerEvent): void => {
    if (this.activePointer !== null || (event.pointerType === 'mouse' && event.button !== 0))
      return;
    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);
    this.activePointer = event.pointerId;
    this.example = null;
    this.strokes.push([this.pointOf(event)]);
    this.paint();
    this.onChange();
  };

  private onMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointer) return;
    const stroke = this.strokes[this.strokes.length - 1];
    // Coalesced events keep fast strokes smooth.
    const events = event.getCoalescedEvents?.() ?? [];
    for (const e of events.length ? events : [event]) stroke.push(this.pointOf(e));
    this.paint();
    this.onChange();
  };

  private onUp = (event: PointerEvent): void => {
    if (event.pointerId === this.activePointer) this.activePointer = null;
  };

  private paint(): void {
    const size = this.canvas.clientWidth;
    if (size === 0) return;
    const scale = fitCanvas(this.canvas, size, size);
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, size, size);

    this.hint.hidden = this.hasInk || this.example !== null;
    this.badge.hidden = this.example === null;

    if (this.example) {
      // Blow the 8x8 example up into blocks, with a margin like a drawn digit would have.
      const tiny = this.exampleCanvas.getContext('2d')!;
      tiny.clearRect(0, 0, 8, 8);
      for (let i = 0; i < 64; i++) {
        if (this.example[i] === 0) continue;
        tiny.fillStyle = `rgba(241, 232, 212, ${0.2 + 0.25 * this.example[i]})`;
        tiny.fillRect(i % 8, Math.floor(i / 8), 1, 1);
      }
      ctx.imageSmoothingEnabled = false;
      const margin = size * 0.1;
      ctx.drawImage(this.exampleCanvas, margin, margin, size - 2 * margin, size - 2 * margin);
      return;
    }

    ctx.strokeStyle = '#f1e8d4';
    ctx.fillStyle = '#f1e8d4';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.07;
    for (const stroke of this.strokes) {
      if (stroke.length === 1) {
        ctx.beginPath();
        ctx.arc(stroke[0].x * size, stroke[0].y * size, ctx.lineWidth / 2, 0, 2 * Math.PI);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(stroke[0].x * size, stroke[0].y * size);
      for (const p of stroke) ctx.lineTo(p.x * size, p.y * size);
      ctx.stroke();
    }
  }
}
