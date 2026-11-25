import { bitsToLevels, countsToBits, strokesToCounts } from '../machine/input';
import type { Header } from '../machine/types';
import { copy } from './copy';
import { drawLevels, formatCount, h, icons } from './dom';
import { DrawPad } from './drawpad';
import type { Example } from './examples';

const SEEN_PIXELS = 192;
const THUMB_PIXELS = 64;

/**
 * The drawing pad with everything around it: the live 8x8 preview of what the
 * machine reads, the example digits, Clear and Topple.
 */
export class DrawPanel {
  readonly element: HTMLElement;
  /** Called with the input bits when the visitor presses Topple. */
  onTopple: (bits: Uint8Array) => void = () => {};
  /** Called when the visitor hides the panel (small screens only). */
  onClose: () => void = () => {};

  private readonly pad = new DrawPad();
  private readonly seen: HTMLCanvasElement;
  private readonly examples: HTMLElement;
  private readonly toppleButton: HTMLButtonElement;
  private readonly clearButton: HTMLButtonElement;
  private bits: Uint8Array | null = null;
  private busy = false;

  constructor(
    private readonly model: Header['model'],
    dominoCount: number,
  ) {
    this.seen = h('canvas', {
      class: 'seen-grid',
      attrs: {
        width: SEEN_PIXELS,
        height: SEEN_PIXELS,
        role: 'img',
        'aria-label': copy.pad.seenLabel,
      },
    });
    this.examples = h('div', {
      class: 'examples',
      attrs: { role: 'group', 'aria-label': copy.pad.examplesLabel },
    });
    this.clearButton = h('button', {
      class: 'button ghost',
      text: copy.pad.clear,
      attrs: { type: 'button' },
    });
    this.toppleButton = h('button', {
      class: 'button primary',
      text: copy.pad.topple,
      attrs: { type: 'button' },
    });
    const close = h('button', {
      class: 'icon-button sheet-close',
      html: icons.chevronDown,
      attrs: { type: 'button', 'aria-label': copy.pad.closeSheet },
    });

    this.element = h(
      'section',
      { class: 'panel draw', attrs: { 'aria-label': copy.pad.label } },
      close,
      h(
        'div',
        { class: 'draw-top' },
        this.pad.element,
        h(
          'div',
          { class: 'seen' },
          this.seen,
          h('span', { class: 'caption', text: copy.pad.seenCaption }),
        ),
      ),
      h(
        'div',
        { class: 'examples-row' },
        h('span', { class: 'caption', text: copy.pad.examples }),
        this.examples,
      ),
      h('div', { class: 'draw-actions' }, this.clearButton, this.toppleButton),
      h('p', { class: 'machine-count', text: copy.pad.count(formatCount(dominoCount)) }),
    );

    this.pad.onChange = () => {
      this.selectExample(null);
      const counts = strokesToCounts(this.pad.strokes);
      this.setBits(this.pad.hasInk ? countsToBits(counts, this.model.thresholds) : null);
    };
    this.clearButton.addEventListener('click', () => this.pad.clear());
    this.toppleButton.addEventListener('click', () => {
      if (this.bits && !this.busy) this.onTopple(this.bits);
    });
    close.addEventListener('click', () => this.onClose());
    this.setBits(null);
  }

  setExamples(examples: Example[]): void {
    this.examples.replaceChildren(
      ...examples.map((example) => {
        const thumb = h('canvas', { attrs: { width: THUMB_PIXELS, height: THUMB_PIXELS } });
        drawLevels(thumb, example.levels, { gap: 0, empty: 'rgba(0, 0, 0, 0)' });
        const button = h(
          'button',
          {
            class: 'example',
            attrs: {
              type: 'button',
              'aria-label': copy.pad.useExample(example.digit),
              'aria-pressed': 'false',
            },
          },
          thumb,
        );
        button.addEventListener('click', () => {
          this.pad.showExample(example.levels, example.digit);
          this.selectExample(button);
          this.setBits(example.bits);
        });
        return button;
      }),
    );
  }

  /** While a run is being computed the button says so and ignores clicks. */
  setBusy(busy: boolean): void {
    this.busy = busy;
    this.toppleButton.textContent = busy ? copy.pad.toppling : copy.pad.topple;
    this.toppleButton.disabled = busy || this.bits === null;
  }

  private selectExample(selected: HTMLElement | null): void {
    for (const button of this.examples.children) {
      button.setAttribute('aria-pressed', String(button === selected));
    }
  }

  private setBits(bits: Uint8Array | null): void {
    this.bits = bits;
    drawLevels(this.seen, bits ? bitsToLevels(bits) : null, {
      maxLevel: this.model.thresholds.length,
    });
    this.toppleButton.disabled = this.busy || bits === null;
    this.clearButton.disabled = bits === null;
  }
}
