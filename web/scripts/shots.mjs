// Takes the screenshots used in the README from a running copy of the page.
//
//   npm run dev                                   (in one terminal)
//   npm run shots -- http://localhost:5173        (in another)
//
// It drives an installed Chromium-based browser through puppeteer-core. Set
// BROWSER_PATH if yours is not Microsoft Edge in its default Windows location.
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const base = (process.argv[2] ?? 'http://localhost:5173').replace(/\/$/, '');
const browserPath =
  process.env.BROWSER_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const docs = new URL('../../docs/', import.meta.url);

// `demo` picks an example digit, `at` is how far through the run to pause, and
// `guide` opens the guide on that tab. `step` then opens one walkthrough step.
const shots = [
  { name: 'overview', query: 'demo=3&at=0.1' },
  { name: 'race', query: 'demo=3&at=0.5' },
  { name: 'finale', query: 'demo=3&at=0.985' },
  { name: 'guide', query: 'demo=7&at=0.62&guide=walk', step: 4 },
];

const browser = await puppeteer.launch({
  executablePath: browserPath,
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1.5 });

for (const shot of shots) {
  await page.goto(`${base}/?${shot.query}`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-demo="ready"]', { timeout: 180_000 });
  if (shot.step !== undefined) {
    await page.evaluate((index) => {
      document.querySelectorAll('#guide-walk .fold-head')[index]?.click();
    }, shot.step);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  await page.addStyleTag({ content: '.camera-hint { display: none !important; }' });
  const path = fileURLToPath(new URL(`${shot.name}.jpg`, docs));
  await page.screenshot({ path, type: 'jpeg', quality: 90 });
  console.log('saved', path);
}

await browser.close();
