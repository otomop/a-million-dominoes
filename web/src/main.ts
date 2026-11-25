import './style.css';
import { App } from './app';
import { fetchMachineBytes, parseMachine } from './machine/loader';
import { AMBER, css } from './render/palette';
import { WebGL2Unavailable } from './render/renderer';
import { copy } from './ui/copy';
import { h } from './ui/dom';

const MACHINE_URL = 'machine.bin.gz';

const root = document.getElementById('app')!;
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const debug = new URLSearchParams(location.search).has('debug');

// The accent colour is defined once, in the palette the scene also uses.
document.documentElement.style.setProperty('--amber', css(AMBER));

const status = h('p', { class: 'loading-text', text: copy.loading.download });
const loading = h(
  'div',
  { class: 'loading', attrs: { role: 'status' } },
  h('div', { class: 'loading-bar' }),
  status,
);
root.append(
  h(
    'header',
    { class: 'masthead' },
    h('h1', { text: copy.title }),
    h('p', { class: 'tagline', text: copy.tagline }),
  ),
  loading,
);
root.dataset.state = 'loading';

/** Replace the loading indicator with a message that stays. */
function fail(heading: string, body: string): void {
  loading.replaceWith(
    h(
      'div',
      { class: 'panel notice', attrs: { role: 'alert' } },
      h('h2', { text: heading }),
      h('p', { text: body }),
    ),
  );
  root.dataset.state = 'failed';
}

/**
 * Let the browser paint the status text before a long synchronous step. The
 * timeout covers background tabs, where animation frames do not fire.
 */
const nextPaint = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
    setTimeout(resolve, 200);
  });

async function start(): Promise<void> {
  const t0 = performance.now();
  const bytes = await fetchMachineBytes(MACHINE_URL);
  const loaded = performance.now() - t0;
  status.textContent = copy.loading.build;
  await nextPaint();
  const t1 = performance.now();
  const machine = parseMachine(bytes);
  const t2 = performance.now();
  const app = new App(root, canvas, machine, debug);
  const t3 = performance.now();
  loading.remove();
  if (debug) {
    (window as unknown as { app: App }).app = app; // for poking at from the console
    app.note(
      `load ${loaded.toFixed(0)} ms, decode ${(t2 - t1).toFixed(0)} ms, scene ${(t3 - t2).toFixed(0)} ms`,
    );
  }
}

start().catch((error: unknown) => {
  console.error(error);
  if (error instanceof WebGL2Unavailable) fail(copy.noWebGL.heading, copy.noWebGL.body);
  else fail(copy.loading.failed, copy.loading.retry);
});
