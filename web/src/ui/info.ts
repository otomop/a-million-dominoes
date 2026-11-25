import type { RunInfo } from '../machine/run';
import type { Header, TourStop } from '../machine/types';
import { copy } from './copy';
import { formatCount, h, icons } from './dom';
import { figureFor } from './figures';

type TabId = 'walk' | 'why' | 'today' | 'build';
const TAB_IDS: TabId[] = ['walk', 'why', 'today', 'build'];

const tick =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ring =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="7"/></svg>';

let nextFoldId = 0;

/**
 * Rows of which one is open at a time. The headline of every row stays in
 * view and its full explanation folds away, so nothing is cut to keep the
 * panel short.
 */
class Fold {
  readonly element = h('div', { class: 'fold' });
  private readonly items: {
    item: HTMLElement;
    head: HTMLButtonElement;
    body: HTMLElement;
    onOpen?: () => void;
  }[] = [];
  private current = -1;

  add(head: HTMLButtonElement, body: HTMLElement, onOpen?: () => void): void {
    const index = this.items.length;
    body.id = `fold-${nextFoldId++}`;
    body.hidden = true;
    head.setAttribute('aria-expanded', 'false');
    head.setAttribute('aria-controls', body.id);
    head.addEventListener('click', () => this.show(this.current === index ? -1 : index));
    const item = h('div', { class: 'fold-item' }, head, body);
    this.items.push({ item, head, body, onOpen });
    this.element.append(item);
  }

  /** Open one row (or none, with -1), optionally scrolling it into view. */
  show(index: number, reveal = false): void {
    this.current = index;
    this.items.forEach((entry, i) => {
      const open = i === index;
      entry.body.hidden = !open;
      entry.head.setAttribute('aria-expanded', String(open));
      entry.item.toggleAttribute('data-open', open);
      if (open) entry.onOpen?.();
    });
    if (reveal) this.items[index]?.item.scrollIntoView({ block: 'nearest' });
  }
}

function foldHead(className: string, ...cells: HTMLElement[]): HTMLButtonElement {
  return h(
    'button',
    { class: `fold-head ${className}`.trim(), attrs: { type: 'button' } },
    ...cells,
    h('span', { class: 'fold-chevron', html: icons.chevronDown }),
  );
}

const number = (index: number): HTMLElement =>
  h('span', { class: 'fold-num', text: String(index + 1).padStart(2, '0') });

/**
 * The "How it works" guide: four tabs, each a list of rows that open to the
 * full explanation. The walkthrough follows the run that is playing: its
 * phase rail fills as the run goes, and pressing a phase jumps the run there.
 */
export class InfoDrawer {
  readonly element: HTMLElement;
  /** Called when the visitor asks to be flown to a place on the machine's tour. */
  onFly: (stop: TourStop) => void = () => {};
  /** Called when the visitor picks a phase of the run to jump to. */
  onSeek: (time: number) => void = () => {};

  private readonly closeButton: HTMLButtonElement;
  private readonly tabs = new Map<TabId, { tab: HTMLButtonElement; panel: HTMLElement }>();
  private readonly steps = new Fold();
  private readonly phases: { button: HTMLButtonElement; shown: string }[] = [];
  /** Start time of each phase, then the end of the last one; null with no run loaded. */
  private phaseTimes: number[] | null = null;
  private opener: HTMLElement | null = null;

  constructor(private readonly header: Header) {
    this.closeButton = h('button', {
      class: 'icon-button',
      html: icons.close,
      attrs: { type: 'button', 'aria-label': copy.info.close },
    });

    const tablist = h('div', {
      class: 'tabs',
      attrs: { role: 'tablist', 'aria-label': copy.info.tabsLabel },
    });
    const panels: Record<TabId, HTMLElement> = {
      walk: this.walkthrough(),
      why: this.why(),
      today: this.today(),
      build: this.build(),
    };
    for (const id of TAB_IDS) {
      const panel = panels[id];
      panel.id = `guide-${id}`;
      panel.classList.add('tabpanel');
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', `guide-tab-${id}`);
      const tab = h('button', {
        class: 'tab',
        text: copy.info.tabs[id],
        attrs: { type: 'button', role: 'tab', id: `guide-tab-${id}`, 'aria-controls': panel.id },
      });
      tab.addEventListener('click', () => this.select(id));
      tablist.append(tab);
      this.tabs.set(id, { tab, panel });
    }
    tablist.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      event.stopPropagation();
      const current = TAB_IDS.findIndex((id) => this.tabs.get(id)?.tab === document.activeElement);
      const step = event.key === 'ArrowRight' ? 1 : -1;
      const next = TAB_IDS[(Math.max(0, current) + step + TAB_IDS.length) % TAB_IDS.length];
      if (next) this.select(next, true);
    });

    this.element = h(
      'aside',
      {
        class: 'drawer',
        attrs: { role: 'dialog', 'aria-label': copy.info.button, hidden: true, tabindex: -1 },
      },
      h(
        'header',
        { class: 'drawer-head' },
        h(
          'div',
          {},
          h('span', { class: 'kicker', text: copy.info.kicker }),
          h('h2', { text: copy.info.button }),
        ),
        this.closeButton,
      ),
      h(
        'div',
        { class: 'drawer-body' },
        h('p', { class: 'lede', text: copy.info.intro }),
        this.stats(),
        tablist,
        ...TAB_IDS.map((id) => panels[id]),
      ),
    );
    this.select('walk');

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

  open(opener: HTMLElement, tab?: string): void {
    this.opener = opener;
    this.element.hidden = false;
    if (tab && (TAB_IDS as string[]).includes(tab)) this.select(tab as TabId);
    this.closeButton.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.element.hidden = true;
    this.opener?.focus();
  }

  /** Tell the guide which run is playing, so the phase rail can follow it. */
  setRun(run: RunInfo): void {
    const end = run.end;
    const times = [
      0,
      Math.min(1, run.logicEnd / 2),
      run.logicEnd,
      run.coreAt ?? run.decidedAt ?? end,
      run.panelFrom ?? run.decidedAt ?? end,
      run.panelTo ?? end,
    ];
    for (let i = 1; i < times.length; i++) times[i] = Math.max(times[i] ?? 0, times[i - 1] ?? 0);
    this.phaseTimes = times;
    for (const phase of this.phases) phase.shown = '';
  }

  /** Called every frame with the current simulation time. */
  update(time: number): void {
    const times = this.phaseTimes;
    if (!times || !this.isOpen) return;
    this.phases.forEach((phase, index) => {
      const from = times[index] ?? 0;
      const to = times[index + 1] ?? from;
      const done = time >= to && time > 0;
      const progress = done ? 1 : time <= from ? 0 : (time - from) / (to - from);
      const state = done ? 'done' : time > from || (index === 0 && time > 0) ? 'live' : 'idle';
      const shown = `${state} ${progress.toFixed(2)}`;
      if (shown === phase.shown) return;
      phase.shown = shown;
      phase.button.dataset.state = state;
      phase.button.style.setProperty('--p', progress.toFixed(3));
    });
  }

  private select(id: TabId, focus = false): void {
    for (const [key, { tab, panel }] of this.tabs) {
      const selected = key === id;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panel.hidden = !selected;
      if (selected && focus) tab.focus();
    }
  }

  private stats(): HTMLElement {
    const { header } = this;
    const labels = copy.info.stats;
    const layers = header.model.layers ?? [];
    const gates = layers.reduce((sum, width) => sum + width, 0);
    const entries: [string, number | undefined][] = [
      [labels.dominoes, header.count],
      [labels.gates, gates || undefined],
      [labels.starters, header.counts?.starters],
      [labels.bridges, header.counts?.gates?.swap],
    ];
    return h(
      'dl',
      { class: 'stats' },
      ...entries
        .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
        .map(([label, value]) =>
          h('div', {}, h('dd', { text: formatCount(value) }), h('dt', { text: label })),
        ),
    );
  }

  private walkthrough(): HTMLElement {
    const tour = this.header.tour ?? [];
    const steps = copy.info.steps;

    const rail = h('div', {
      class: 'phases',
      attrs: { role: 'group', 'aria-label': copy.info.phasesLabel },
    });
    copy.info.phases.forEach((phase, index) => {
      const first = phase.steps[0];
      const last = phase.steps[phase.steps.length - 1] ?? first;
      const range = first === last ? String(first + 1) : `${first + 1}–${last + 1}`;
      const button = h(
        'button',
        {
          class: 'phase',
          attrs: { type: 'button', 'aria-label': copy.info.phaseJump(phase.name) },
        },
        h('span', { class: 'phase-bar' }, h('span', { class: 'phase-fill' })),
        h(
          'span',
          { class: 'phase-name' },
          phase.name,
          h('span', { class: 'phase-steps', text: range }),
        ),
      );
      button.addEventListener('click', () => {
        this.steps.show(first, true);
        const at = this.phaseTimes?.[index];
        if (at !== undefined) this.onSeek(at);
      });
      this.phases.push({ button, shown: '' });
      rail.append(button);
    });

    steps.forEach((step, index) => {
      const head = foldHead(
        '',
        number(index),
        h('span', { class: 'fold-title', text: step.heading }),
        h('span', { class: 'tag', text: copy.info.tags[index] ?? '' }),
      );

      // The diagram is drawn afresh each time the step opens, which replays it.
      const drawing = figureFor(index);
      const figure = h('div', { class: 'figure' });
      const replay = h('button', {
        class: 'figure-replay',
        html: icons.replay,
        attrs: { type: 'button', 'aria-label': copy.info.replay },
      });
      const draw = (): void => {
        if (!drawing) return;
        figure.innerHTML = drawing;
        figure.append(replay);
      };
      replay.addEventListener('click', draw);

      const actions = h('div', { class: 'step-actions' });
      const stopName = 'stop' in step ? step.stop : undefined;
      const stop = tour.find((candidate) => candidate.name === stopName);
      if (stop) {
        const showMe = h(
          'button',
          { class: 'button primary', attrs: { type: 'button' } },
          h('span', { class: 'button-icon', html: icons.follow }),
          copy.info.showMe,
        );
        showMe.addEventListener('click', () => this.onFly(stop));
        actions.append(showMe);
      }
      actions.append(
        h('span', { class: 'spacer' }),
        h('span', { class: 'step-count', text: copy.info.stepOf(index + 1, steps.length) }),
      );
      const go = (label: string, to: number): void => {
        const button = h('button', { class: 'button', text: label, attrs: { type: 'button' } });
        button.addEventListener('click', () => this.steps.show(to, true));
        actions.append(button);
      };
      if (index > 0) go(copy.info.previous, index - 1);
      if (index < steps.length - 1) go(copy.info.next, index + 1);

      const body = h(
        'div',
        { class: 'fold-body' },
        ...step.body.map((text, i) => h('p', { class: i === 0 ? 'lead' : '', text })),
        drawing ? figure : null,
        h(
          'div',
          { class: 'note' },
          h('span', { class: 'note-label', text: copy.info.conceptLabel }),
          h('p', { text: copy.info.concepts[index] ?? '' }),
        ),
        actions,
      );
      this.steps.add(head, body, draw);
    });
    this.steps.show(0);

    return h('div', {}, rail, this.steps.element);
  }

  private why(): HTMLElement {
    const { minX, maxX, minY, maxY } = this.header.bounds;
    const layers = this.header.model.layers ?? [];
    const facts = {
      gates: formatCount(layers.reduce((sum, width) => sum + width, 0)),
      dominoes: formatCount(this.header.count),
      pitches: ((((maxX - minX) / 1000) * ((maxY - minY) / 1000)) / (105 * 68)).toFixed(0),
    };
    const fold = new Fold();
    copy.info.why.points.forEach((point, index) => {
      const head = foldHead(
        'plain',
        number(index),
        h('span', { class: 'fold-title', text: point.lead.replace(/\.$/, '') }),
      );
      fold.add(head, h('div', { class: 'fold-body' }, h('p', { text: point.text(facts) })));
    });
    fold.show(0);
    return h('div', {}, h('p', { class: 'tab-intro', text: copy.info.why.intro }), fold.element);
  }

  private today(): HTMLElement {
    const compare = copy.info.compare;
    const points = copy.info.missing.points;
    const fold = new Fold();
    compare.rows.forEach((row, index) => {
      const head = foldHead(
        'compare-row',
        h('span', { class: 'compare-label', text: row.label }),
        h('span', { class: 'here', text: row.here }),
        h('span', { class: 'today', text: row.today }),
      );
      const point = points[index];
      fold.add(
        head,
        h(
          'div',
          { class: 'fold-body' },
          h('p', {}, h('strong', { text: point?.lead ?? '' }), ` ${point?.text ?? ''}`),
        ),
      );
    });
    fold.show(0);
    return h(
      'div',
      {},
      h('p', { class: 'tab-intro', text: copy.info.missing.intro }),
      h(
        'div',
        { class: 'compare-head', attrs: { 'aria-hidden': 'true' } },
        h('span'),
        h('span', { text: compare.here }),
        h('span', { text: compare.today }),
        h('span'),
      ),
      fold.element,
      h('p', { class: 'section-label', text: compare.carriesHeading }),
      h('ul', { class: 'carries' }, ...compare.carries.map((text) => h('li', { text }))),
    );
  }

  /** What a physical build would take, worked out from this machine's own numbers. */
  private build(): HTMLElement {
    const text = copy.info.build;
    const { header } = this;
    const { minX, maxX, minY, maxY } = header.bounds;
    const width = (maxX - minX) / 1000;
    const depth = (maxY - minY) / 1000;
    const gates = header.counts?.gates ?? {};
    const starters = header.counts?.starters;
    const hours = (header.count * 3) / 3600;

    const tiles: [string, string, string][] = [
      [
        text.floor.label,
        text.floor.value(width.toFixed(0), depth.toFixed(0)),
        text.floor.note(((width * depth) / (105 * 68)).toFixed(0)),
      ],
      [
        text.dominoes.label,
        text.dominoes.value(((header.count * 8) / 1e6).toFixed(0)),
        text.dominoes.note(formatCount(header.count)),
      ],
    ];
    if (gates.swap) tiles.push([text.bridges.label, formatCount(gates.swap), text.bridges.note]);
    if (starters) {
      const lanes = header.lanes.length;
      tiles.push([
        text.pushers.label,
        formatCount(starters + lanes),
        text.pushers.note(formatCount(starters), String(lanes)),
      ]);
    }
    tiles.push([
      text.setup.label,
      text.setup.value(formatCount(Math.round(hours / 10) * 10)),
      text.setup.note((hours / 160).toFixed(0)),
    ]);
    tiles.push([text.run.label, text.run.value, text.run.note]);

    const reliability = gates.rinh
      ? h(
          'div',
          { class: 'meter-card' },
          h(
            'div',
            { class: 'meter-top' },
            h('span', { class: 'note-label', text: text.reliability }),
            h('span', { class: 'meter-value', text: text.reliabilityValue }),
          ),
          h('div', { class: 'meter', attrs: { 'aria-hidden': 'true' } }, h('span')),
          h('p', {
            text: text.reliabilityNote(formatCount(gates.rinh), (gates.rinh / 400).toFixed(0)),
          }),
        )
      : null;

    return h(
      'div',
      {},
      h('p', { class: 'tab-intro', text: text.intro }),
      h(
        'dl',
        { class: 'tiles' },
        ...tiles.map(([label, value, note]) =>
          h(
            'div',
            { class: 'tile' },
            h('dt', { text: label }),
            h('dd', { class: 'value', text: value }),
            h('dd', { class: 'tile-note', text: note }),
          ),
        ),
      ),
      reliability,
      h('p', { class: 'section-label', text: text.testedHeading }),
      h(
        'ul',
        { class: 'tested' },
        ...text.tested.map((line) =>
          h('li', {}, h('span', { html: tick }), h('span', { text: line })),
        ),
        h('li', { class: 'no' }, h('span', { html: ring }), h('span', { text: text.notTested })),
      ),
      h('p', { class: 'small-note', text: text.assumptions }),
    );
  }
}
