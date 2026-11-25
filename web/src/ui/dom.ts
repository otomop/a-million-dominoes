/** Tiny DOM helpers; the page has no UI framework. */

type Child = Node | string | null | undefined | false;

interface Props {
  class?: string;
  text?: string;
  /** Raw HTML, used only for the inline SVG icons defined in this code base. */
  html?: string;
  attrs?: Record<string, string | number | boolean>;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props.class) element.className = props.class;
  if (props.text !== undefined) element.textContent = props.text;
  if (props.html !== undefined) element.innerHTML = props.html;
  for (const [name, value] of Object.entries(props.attrs ?? {})) {
    if (value === false) continue;
    element.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) if (child) element.append(child);
  return element;
}

const svg = (path: string): string =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

export const icons = {
  play: svg('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke-width="1.2"/>'),
  pause: svg('<path d="M8.5 5.5v13M15.5 5.5v13" stroke-width="2.6"/>'),
  replay: svg('<path d="M4.5 12a7.5 7.5 0 1 0 2.3-5.4"/><path d="M4.5 4.5v4.2h4.2"/>'),
  soundOn: svg(
    '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor" stroke-width="1.2"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11"/>',
  ),
  soundOff: svg(
    '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor" stroke-width="1.2"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  ),
  info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.2" stroke-width="2"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  follow: svg(
    '<circle cx="12" cy="12" r="3"/><path d="M12 3v3.5M12 17.5V21M3 12h3.5M17.5 12H21"/>',
  ),
  pencil: svg(
    '<path d="M4.5 19.5l1-4.2L16.3 4.5a1.8 1.8 0 0 1 2.6 0l.6.6a1.8 1.8 0 0 1 0 2.6L8.7 18.5z"/>',
  ),
  chevronDown: svg('<path d="M6 9.5l6 6 6-6"/>'),
};

/** 1234567 -> "1,234,567" */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** Seconds -> "m:ss.s", the timeline's clock. */
export function formatClock(seconds: number): string {
  const tenths = Math.max(0, Math.floor(seconds * 10 + 1e-6));
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`;
}

/** Fill a canvas with an 8x8 grid of ink levels (0..maxLevel). */
export function drawLevels(
  canvas: HTMLCanvasElement,
  levels: ArrayLike<number> | null,
  options: { maxLevel?: number; gap?: number; empty?: string; ink?: [number, number, number] } = {},
): void {
  const {
    maxLevel = 3,
    gap = 0.1,
    empty = 'rgba(241, 232, 212, 0.07)',
    ink = [241, 232, 212],
  } = options;
  const ctx = canvas.getContext('2d')!;
  const grid = 8;
  const cell = canvas.width / grid;
  const inset = (cell * gap) / 2;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let r = 0; r < grid; r++) {
    for (let c = 0; c < grid; c++) {
      const level = levels ? levels[r * grid + c] : 0;
      ctx.fillStyle =
        level > 0
          ? `rgba(${ink[0]}, ${ink[1]}, ${ink[2]}, ${0.18 + (0.82 * level) / maxLevel})`
          : empty;
      ctx.fillRect(c * cell + inset, r * cell + inset, cell - 2 * inset, cell - 2 * inset);
    }
  }
}

/** Size a canvas's backing store for the screen's pixel density. Returns the scale used. */
export function fitCanvas(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number): number {
  const scale = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(cssWidth * scale);
  canvas.height = Math.round(cssHeight * scale);
  return scale;
}
