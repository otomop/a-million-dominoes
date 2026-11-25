/**
 * Animated top-down diagrams for the walkthrough, one per step.
 *
 * A row of dominoes seen from above is a row of short bars. Each line here is
 * three strokes on one path: thin dashes for standing dominoes, a coloured
 * stroke that grows along the path as the wave passes, and thin background
 * gaps that cut that stroke into fallen dominoes. Timing is in the `--d`
 * (delay) and `--t` (duration) custom properties; theme.css runs it.
 */

interface Wave {
  /** 'a' is the accent colour, 'b' the plain one. */
  tone: 'a' | 'b';
  delay?: number;
  time?: number;
}

const WIDTH = 320;

const frame = (height: number, body: string): string =>
  `<svg viewBox="0 0 ${WIDTH} ${height}" aria-hidden="true">${body}</svg>`;

/** A domino line along path `d`. Without a wave it only ever stands. */
function line(d: string, wave?: Wave): string {
  const standing = `<path class="f-stand" d="${d}"/>`;
  if (!wave) return standing;
  const timing = `--d:${wave.delay ?? 0}s;--t:${wave.time ?? 1}s`;
  return (
    standing +
    `<path class="f-fall f-${wave.tone}" pathLength="100" style="${timing}" d="${d}"/>` +
    `<path class="f-gap" d="${d}"/>`
  );
}

function label(x: number, y: number, text: string, style = '', anchor = 'start'): string {
  const cls = style ? ` class="${style}"` : '';
  return `<text x="${x}" y="${y}" text-anchor="${anchor}"${cls}>${text}</text>`;
}

/** Step 1: a drawing becomes an 8 by 8 grid with three ink levels. */
function grid(): string {
  const x0 = 124;
  const y0 = 16;
  const cell = 9;
  // [column, row, ink level 1..3] of a 7 on the grid.
  const ink: [number, number, number][] = [
    [2, 1, 3], [3, 1, 3], [4, 1, 3], [5, 1, 3], [5, 2, 3], [4, 2, 1], [4, 3, 3],
    [5, 3, 1], [4, 4, 2], [3, 4, 2], [3, 5, 3], [3, 6, 2],
  ]; // prettier-ignore
  let rules = '';
  for (let i = 0; i <= 8; i++) {
    rules += `M${x0} ${y0 + i * cell}h${8 * cell}M${x0 + i * cell} ${y0}v${8 * cell}`;
  }
  const cells = ink
    .map(
      ([c, r, level], i) =>
        `<rect class="f-pop f-ink" style="--d:${0.3 + i * 0.07}s;--o:${level / 3}" x="${x0 + c * cell}" y="${y0 + r * cell}" width="${cell}" height="${cell}"/>`,
    )
    .join('');
  return frame(
    104,
    `<rect class="f-box" x="16" y="16" width="72" height="72" rx="4"/>` +
      `<path class="f-pen" d="M34 34H70L50 76"/>` +
      `<path class="f-arrow" d="M96 52h18m-5 -5l5 5l-5 5"/>` +
      cells +
      `<path class="f-rule" d="${rules}"/>` +
      label(212, 38, '64 squares') +
      label(212, 54, '× 3 ink levels') +
      label(212, 76, '= 192 bits', 'f-acc'),
  );
}

/** Step 2: a little under half of the starters fall, all at the same instant. */
function starters(): string {
  const tipped = [1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0];
  let body = '';
  tipped.forEach((on, i) => {
    const x = 20 + (i % 7) * 42;
    const y = 22 + Math.floor(i / 7) * 24;
    body += on
      ? line(`M${x} ${y}h30`, { tone: 'a', delay: 0.4, time: 0.5 })
      : `<path class="f-stand" d="M${x} ${y}h2"/>`;
  });
  return frame(
    104,
    body +
      label(20, 98, 'Tipped together at t = 0', 'f-acc') +
      label(300, 98, 'the rest stand', '', 'end'),
  );
}

/** Step 3: one fact, two lines; exactly one of them falls. */
function pair(): string {
  return frame(
    92,
    line('M74 30H306', { tone: 'a', time: 1.3 }) +
      line('M74 64H306') +
      label(10, 34, '“yes” line') +
      label(10, 68, '“no” line') +
      label(306, 16, 'this one fell: the answer is yes', 'f-acc', 'end'),
  );
}

/** Step 4: two lines join; the line beyond falls if either arrives. */
function merge(): string {
  return frame(
    96,
    line('M10 22C90 22 120 48 170 48', { tone: 'a', time: 0.9 }) +
      line('M10 74C90 74 120 48 170 48') +
      line('M170 48H310', { tone: 'a', delay: 0.9, time: 0.8 }) +
      label(10, 12, 'A fell', 'f-acc') +
      label(10, 92, 'B did not') +
      label(310, 38, 'A or B', 'f-acc', 'end'),
  );
}

/** Step 5: the blocker knocks the shared stretch down backwards before the signal arrives. */
function block(): string {
  return frame(
    104,
    line('M10 64H116', { tone: 'b', delay: 0.5, time: 1.2 }) +
      line('M218 64H120', { tone: 'a', delay: 1.0, time: 0.5 }) +
      line('M226 64H310') +
      line('M306 14C262 14 238 32 222 58', { tone: 'a', time: 1.0 }) +
      label(10, 52, 'signal') +
      label(306, 46, 'blocker', 'f-acc', 'end') +
      label(168, 88, 'knocked down backwards', 'f-acc', 'middle') +
      label(310, 88, 'never falls', '', 'end'),
  );
}

/** Step 6: one line crosses over the other on a raised deck. */
function bridge(): string {
  return frame(
    104,
    line('M160 100V4', { tone: 'b', delay: 0.2, time: 1.2 }) +
      `<rect class="f-deck" x="126" y="36" width="68" height="32" rx="3"/>` +
      line('M10 52H310', { tone: 'a', time: 1.5 }) +
      label(118, 30, 'up four steps', '', 'end') +
      label(202, 30, 'and down') +
      label(160, 84, 'deck', '', 'middle') +
      label(10, 98, 'the other line passes underneath'),
  );
}

/** Step 7: the same lane with a yes vote and with a no vote. */
function race(): string {
  const detour =
    'M10 92H96C96 58 118 58 118 74C118 90 140 90 140 74C140 58 162 58 162 74C162 88 178 92 186 92H298';
  return frame(
    118,
    line('M10 28H298', { tone: 'a', time: 1.3 }) +
      line('M100 92H182') +
      line(detour, { tone: 'b', time: 2.3 }) +
      `<path class="f-finish" d="M304 14V104"/>` +
      label(10, 14, 'yes vote: straight on', 'f-acc') +
      label(10, 112, 'no vote: the long way round, six seconds') +
      label(300, 62, 'finish', '', 'end'),
  );
}

/** Step 8: the first lane home fires a common line that shuts the other gates. */
function finish(): string {
  return frame(
    112,
    line('M10 54H148', { tone: 'b', time: 1.55 }) +
      line('M10 86H148', { tone: 'b', time: 1.85 }) +
      line('M196 54H310') +
      line('M196 86H310') +
      line('M150 22V86', { tone: 'a', delay: 0.9, time: 0.35 }) +
      line('M190 54H154', { tone: 'a', delay: 1.25, time: 0.2 }) +
      line('M190 86H154', { tone: 'a', delay: 1.25, time: 0.2 }) +
      line('M10 22H310', { tone: 'a', time: 1.9 }) +
      label(310, 12, 'first home goes through', 'f-acc', 'end') +
      label(310, 72, 'shut out', '', 'end') +
      label(310, 104, 'shut out', '', 'end') +
      label(10, 104, 'common line closes the other gates'),
  );
}

/** Step 9: a field of dominoes that shows the digit once it has fallen. */
function picture(): string {
  let rows = '';
  for (let y = 18; y <= 94; y += 9.5) rows += `M96 ${y}H224`;
  return frame(
    110,
    `<rect class="f-box" x="88" y="8" width="144" height="96" rx="4"/>` +
      `<path class="f-stand f-thin" d="${rows}"/>` +
      line('M120 27H200L152 94', { tone: 'a', delay: 0.2, time: 1.5 }) +
      label(10, 50, 'fallen', 'f-acc') +
      label(10, 64, '= the digit', 'f-acc') +
      label(310, 50, 'standing', '', 'end') +
      label(310, 64, '= thin tops', '', 'end'),
  );
}

/** One diagram per walkthrough step, in order. */
const BUILDERS = [grid, starters, pair, merge, block, bridge, race, finish, picture];

export function figureFor(step: number): string | null {
  const build = BUILDERS[step];
  return build ? build() : null;
}
