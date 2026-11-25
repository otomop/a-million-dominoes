import { laneProgress, leadingLane, yesVotes, type RunInfo } from '../machine/run';
import { copy } from './copy';
import { formatCount, h } from './dom';

interface Row {
  element: HTMLElement;
  fill: HTMLElement;
  note: HTMLElement;
  shownProgress: number;
  shownNote: string;
  shownState: string;
}

/**
 * Ten rows, one per digit, showing how far each lane has got at the current
 * time, with the result above them once the race is decided. Nothing here
 * claims the answer is right: the page cannot know what the visitor meant.
 */
export class RacePanel {
  readonly element: HTMLElement;
  private readonly rows: Row[];
  private readonly result: HTMLElement;
  private readonly resultSays: HTMLElement;
  private readonly resultDigit: HTMLElement;
  private readonly resultFacts: HTMLElement;
  private info: RunInfo | null = null;
  private resultShown = false;

  constructor(
    private readonly digits: number[],
    private readonly colors: string[],
    private readonly machineCount: number,
    private readonly timing?: Record<string, number>,
  ) {
    this.rows = digits.map((digit, index) => {
      const fill = h('span', { class: 'lane-fill' });
      const note = h('span', { class: 'lane-note' });
      const element = h(
        'li',
        { class: 'lane', attrs: { style: `--arm: ${colors[index]}` } },
        h('span', { class: 'lane-digit', text: String(digit) }),
        h('span', { class: 'lane-track' }, fill),
        note,
      );
      return { element, fill, note, shownProgress: -1, shownNote: '', shownState: '' };
    });

    this.resultSays = h('span', { class: 'result-says' });
    this.resultDigit = h('span', { class: 'result-digit' });
    this.resultFacts = h('ul', { class: 'result-facts' });
    this.result = h(
      'div',
      { class: 'result', attrs: { 'aria-live': 'polite', hidden: true } },
      h('p', { class: 'result-line' }, this.resultSays, this.resultDigit),
      this.resultFacts,
    );

    this.element = h(
      'aside',
      { class: 'panel race', attrs: { 'aria-label': copy.race.label } },
      this.result,
      h(
        'div',
        { class: 'race-head' },
        h('h2', { class: 'panel-title', text: copy.race.heading }),
        h('span', { class: 'caption', text: copy.race.waiting }),
      ),
      // The rows change every frame; the result above is what gets announced.
      h(
        'ol',
        { class: 'lanes', attrs: { 'aria-hidden': 'true' } },
        ...this.rows.map((r) => r.element),
      ),
    );
  }

  setRun(info: RunInfo): void {
    this.info = info;
    this.resultShown = false;
    this.result.hidden = true;

    const facts: string[] = [];
    const winners = info.winners.map((lane) => this.digits[lane]);
    if (winners.length === 0) {
      this.resultSays.textContent = copy.result.undecided;
      this.resultDigit.textContent = '';
      facts.push(copy.result.undecidedDetail);
    } else {
      this.resultSays.textContent = copy.result.says;
      this.resultDigit.textContent =
        winners.length === 1 ? String(winners[0]) : copy.result.either(winners);
      this.result.style.setProperty('--arm', this.colors[info.winners[0]]);
      this.result.classList.toggle('tie', winners.length > 1);
      if (winners.length > 1) facts.push(copy.result.tie);
      if (info.runnerUp !== null && info.marginSeconds !== null && info.marginSeconds > 0) {
        facts.push(
          copy.result.margin(formatSeconds(info.marginSeconds), this.digits[info.runnerUp]),
        );
      }
    }
    if (info.winner !== null && winners.length === 1) {
      const won = yesVotes(info.lanes[info.winner], info.winner, this.timing);
      if (won) facts.push(copy.result.votes(won.yes, won.total));
    }
    facts.push(copy.result.fell(formatCount(info.fallen), formatCount(this.machineCount)));
    // How long the answer would take on a real floor: until the panel is down.
    const whole = Math.round(info.panelTo ?? info.duration);
    facts.push(copy.result.realTime(copy.result.minutes(Math.floor(whole / 60), whole % 60)));
    this.resultFacts.replaceChildren(...facts.map((text) => h('li', { text })));
  }

  /** Called every frame with the current simulation time. */
  update(time: number): void {
    const info = this.info;
    if (!info) return;
    const decided = info.decidedAt !== null && time >= info.decidedAt;
    const leader = decided ? null : leadingLane(info, time);
    const winnerTime = info.winner === null ? null : info.lanes[info.winner].raceTime;

    this.rows.forEach((row, index) => {
      const lane = info.lanes[index];
      const progress = Math.round(laneProgress(lane, time) * 500) / 500;
      if (progress !== row.shownProgress) {
        row.shownProgress = progress;
        row.fill.style.setProperty('--progress', String(progress));
      }

      let state = '';
      let note = '';
      if (decided && info.winners.includes(index)) {
        state = 'winner';
        note = copy.race.winner;
      } else if (index === leader) {
        state = 'leading';
        note = copy.race.leading;
      } else if (
        decided &&
        winnerTime !== null &&
        lane.raceTime !== null &&
        time >= lane.raceTime
      ) {
        // Its gap to the winner, once it has reached the line itself.
        note = copy.race.behind(formatSeconds(lane.raceTime - winnerTime));
      }
      // Once a lane is home its time says how many of its gates voted yes.
      if (lane.raceTime !== null && (decided || time >= lane.raceTime)) {
        const votes = yesVotes(lane, index, this.timing);
        if (votes) note = copy.race.votes(votes.yes, votes.total);
      }
      if (state !== row.shownState) {
        row.shownState = state;
        row.element.dataset.state = state;
      }
      if (note !== row.shownNote) {
        row.shownNote = note;
        row.note.textContent = note;
      }
    });

    // With no winner there is nothing to announce until the show is over.
    const showResult = info.winners.length > 0 ? decided : time >= info.end;
    if (showResult !== this.resultShown) {
      this.resultShown = showResult;
      this.result.hidden = !showResult;
    }
  }
}

function formatSeconds(seconds: number): string {
  return seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2);
}
