import type { Header, TourStop } from '../machine/types';
import { copy } from './copy';
import { figures } from './figures';
import { formatCount, h, icons } from './dom';

/** The header's totals worth showing, as [label, number] pairs, skipping any it does not have. */
function facts(header: Header): [string, number][] {
  const labels = copy.info.facts;
  const gates = header.counts?.gates ?? {};
  const candidates: [string, number | undefined][] = [
    [labels.dominoes, header.count],
    [labels.starters, header.counts?.starters],
    [labels.rinh, gates.rinh],
    [labels.merge, gates.merge],
    [labels.split, gates.split],
    [labels.swap, gates.swap],
  ];
  return candidates.filter((entry): entry is [string, number] => typeof entry[1] === 'number');
}

/** What a physical build would take, worked out from this machine's own numbers. */
function realBuild(header: Header): string[] {
  const text = copy.info.real;
  const { minX, maxX, minY, maxY } = header.bounds;
  const width = (maxX - minX) / 1000;
  const depth = (maxY - minY) / 1000;
  const count = header.count;
  const gates = header.counts?.gates ?? {};
  const hours = (count * 3) / 3600;
  const lines = [
    text.floor(width.toFixed(0), depth.toFixed(0), ((width * depth) / (105 * 68)).toFixed(0)),
    text.dominoes(formatCount(count), ((count * 8) / 1e6).toFixed(0)),
  ];
  if (gates.swap) lines.push(text.bridges(formatCount(gates.swap), formatCount(gates.swap * 9)));
  lines.push(text.setup(formatCount(Math.round(hours / 10) * 10), (hours / 160).toFixed(0)));
  if (gates.rinh) {
    lines.push(text.precision(formatCount(gates.rinh), (gates.rinh / 400).toFixed(0)));
  }
  if (header.counts?.starters) lines.push(text.starters(formatCount(header.counts.starters)));
  lines.push(text.run('six or seven'));
  return lines;
}

/**
 * The "How it works" drawer: what the machine is made of, a numbered
 * walkthrough with diagrams and show-me buttons, and what a real build would take.
 */
export class InfoDrawer {
  readonly element: HTMLElement;
  /** Called when the visitor asks to be flown to a tour stop. */
  onFly: (stop: TourStop) => void = () => {};

  private readonly closeButton: HTMLButtonElement;
  private opener: HTMLElement | null = null;

  constructor(header: Header) {
    this.closeButton = h('button', {
      class: 'icon-button',
      html: icons.close,
      attrs: { type: 'button', 'aria-label': copy.info.close },
    });

    const totals = h(
      'dl',
      { class: 'facts' },
      ...facts(header).map(([label, value]) =>
        h('div', {}, h('dd', { text: formatCount(value) }), h('dt', { text: label })),
      ),
    );

    const { minX, maxX, minY, maxY } = header.bounds;
    const layers = (header.model as { layers?: number[] }).layers ?? [];
    const whyFacts = {
      gates: formatCount(layers.reduce((sum, width) => sum + width, 0)),
      dominoes: formatCount(header.count),
      pitches: ((((maxX - minX) / 1000) * ((maxY - minY) / 1000)) / (105 * 68)).toFixed(0),
    };
    const why = h(
      'section',
      { class: 'info-section why' },
      h('h3', { text: copy.info.why.heading }),
      h('p', { text: copy.info.why.intro }),
      ...copy.info.why.points.map((point) =>
        h('p', {}, h('strong', { text: point.lead }), ` ${point.text(whyFacts)}`),
      ),
    );
    const stepsHeading = h('h3', { class: 'steps-heading', text: copy.info.stepsHeading });

    const tour = header.tour ?? [];
    const steps = copy.info.steps.map((step, index) => {
      const stopName = 'stop' in step ? step.stop : undefined;
      const stop = tour.find((candidate) => candidate.name === stopName);
      let showMe: HTMLButtonElement | null = null;
      if (stop) {
        showMe = h('button', {
          class: 'button ghost small',
          text: copy.info.showMe,
          attrs: { type: 'button', 'aria-label': `${copy.info.showMe}: ${stop.name}` },
        });
        showMe.addEventListener('click', () => this.onFly(stop));
      }
      return h(
        'section',
        { class: 'info-section step' },
        h('h3', {}, h('span', { class: 'step-number', text: String(index + 1) }), step.heading),
        ...step.body.map((text) => h('p', { text })),
        'figure' in step ? h('div', { class: 'figure', html: figures[step.figure] }) : null,
        h(
          'p',
          { class: 'concept' },
          h('span', { class: 'concept-label', text: copy.info.conceptLabel }),
          copy.info.concepts[index] ?? '',
        ),
        showMe,
      );
    });

    const real = h(
      'section',
      { class: 'info-section real' },
      h('h3', { text: copy.info.real.heading }),
      h('p', { text: copy.info.real.intro }),
      h('ul', {}, ...realBuild(header).map((text) => h('li', { text }))),
    );

    this.element = h(
      'aside',
      {
        class: 'drawer',
        attrs: { role: 'dialog', 'aria-label': copy.info.button, hidden: true, tabindex: -1 },
      },
      h('header', { class: 'drawer-head' }, h('h2', { text: copy.info.button }), this.closeButton),
      h(
        'div',
        { class: 'drawer-body' },
        h('p', { class: 'info-intro', text: copy.info.intro }),
        totals,
        why,
        stepsHeading,
        ...steps,
        real,
      ),
    );

    this.closeButton.addEventListener('click', () => this.close());
    this.element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  open(opener: HTMLElement): void {
    this.opener = opener;
    this.element.hidden = false;
    this.closeButton.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.element.hidden = true;
    this.opener?.focus();
  }
}
