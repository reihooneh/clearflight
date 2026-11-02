// Takes the README screenshots from the built site: node scripts/shoot.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
const shots = [
  ['index.html', 'home', 1440, 900, false],
  ['explore.html', 'explore', 1440, 1000, false],
  ['plan.html', 'plan', 1440, 1700, false],
  ['method.html', 'method', 1440, 1000, false],
  ['index.html', 'phone', 390, 844, true],
];
for (const [page, name, width, height, full] of shots) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const p = await context.newPage();
  await p.goto(base + page);
  await p.waitForFunction(() => document.body.dataset.ready, null, { timeout: 60000 });
  if (page === 'explore.html') await p.click('#top tbody tr:first-child button');
  await p.waitForTimeout(800);
  await p.screenshot({ path: `docs/${name}.png`, fullPage: full });
  await context.close();
}
await browser.close();
server.close();
console.log(`Saved ${shots.length} screenshots in docs/.`);
