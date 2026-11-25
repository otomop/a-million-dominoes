/**
 * Small top-down diagrams for the "How it works" panel.
 *
 * A row of dominoes seen from above is a row of short bars, so every line here
 * is one dashed stroke: thin dashes for standing dominoes, long coloured ones
 * for fallen dominoes.
 */

const standing = (d: string): string => `<path class="fig-standing" d="${d}"/>`;
const fallen = (d: string, tone = 'a'): string => `<path class="fig-fallen fig-${tone}" d="${d}"/>`;
const label = (x: number, y: number, text: string, anchor = 'start'): string =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}">${text}</text>`;
const frame = (body: string, height = 92): string =>
  `<svg viewBox="0 0 320 ${height}" role="img" aria-hidden="true">${body}</svg>`;

export const figures = {
  /** One fact, two lines: exactly one of them falls. */
  pair: frame(
    fallen('M70 30H300') +
      standing('M70 64H300') +
      label(8, 34, '“yes” line') +
      label(8, 68, '“no” line') +
      label(300, 16, 'this one fell: the answer is yes', 'end'),
  ),
  /** Two lines join: the line beyond falls if either arrives. */
  merge: frame(
    fallen('M10 22C90 22 120 46 170 46') +
      standing('M10 70C90 70 120 46 170 46') +
      fallen('M170 46H310') +
      label(10, 12, 'A fell') +
      label(10, 88, 'B did not') +
      label(310, 36, 'A or B', 'end'),
  ),
  /** The blocker knocks the shared stretch down from its far end, so the signal meets fallen dominoes. */
  block: frame(
    fallen('M10 60H112', 'b') +
      fallen('M118 60H214', 'a') +
      standing('M222 60H310') +
      fallen('M300 14C250 14 232 30 216 54', 'a') +
      label(10, 50, 'signal') +
      label(300, 30, 'blocker', 'end') +
      label(166, 82, '← knocked down backwards', 'middle') +
      label(310, 82, 'never falls', 'end'),
    96,
  ),
  /** A vote on the race lane: straight on for yes, the long way round for no. */
  race: frame(
    fallen('M10 70H96') +
      standing('M100 70H220') +
      fallen(
        'M96 70C96 8 130 8 130 40C130 62 152 62 152 40C152 8 186 8 186 40C186 62 220 40 224 70',
      ) +
      fallen('M224 70H310') +
      label(160, 86, 'short way: cut by a “no” vote', 'middle') +
      label(250, 22, 'detour, 6 s'),
    96,
  ),
} as const;

export type FigureName = keyof typeof figures;
