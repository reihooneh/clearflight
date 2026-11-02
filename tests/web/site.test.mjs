// Browser tests for every page at phone, tablet and desktop widths: no errors, no sideways
// scrolling, no text on top of other text (HTML or SVG), and the main things work.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../../scripts/serve.mjs';

const PAGES = ['index.html', 'explore.html', 'plan.html', 'method.html'];
const SIZES = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'phone', width: 390, height: 844 },
];
let server, browser, base;

before(async () => {
  server = await serve();
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
});
after(async () => {
  await browser?.close();
  server?.close();
});

async function open(path, size = SIZES[0], opts = {}) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, reducedMotion: 'reduce', acceptDownloads: true, ...opts });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/GL Driver Message|WebGL/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + path);
  await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  return { page, context, errors };
}

// Every piece of visible text, HTML or SVG: no two different pieces overlap.
async function textOverlaps(page) {
  return page.evaluate(() => {
    const boxes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (!n.textContent.trim()) continue;
      const elx = n.parentElement;
      if (elx.closest('.visually-hidden, [hidden], .skip, option, title, select')) continue;
      const cs = getComputedStyle(elx);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      if (elx instanceof SVGElement) {
        const r = elx.getBoundingClientRect();
        if (r.width >= 1 && r.height >= 1) boxes.push({ r, text: n.textContent.trim().slice(0, 40), node: n });
        continue;
      }
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width >= 1 && r.height >= 1) boxes.push({ r, text: n.textContent.trim().slice(0, 40), node: n });
    }
    const out = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.node === b.node) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 2 && h > Math.min(a.r.height, b.r.height) * 0.35) out.push(`"${a.text}" overlaps "${b.text}"`);
      }
    }
    return out;
  });
}

// SVG text must stay inside its drawing, and shapes inside a chart must stay inside it too.
async function svgOutside(page) {
  return page.evaluate(() => {
    const out = [];
    for (const s of document.querySelectorAll('.figure svg, .chart-box svg')) {
      const f = s.getBoundingClientRect();
      for (const t of s.querySelectorAll('text, line, rect, polyline, ellipse, circle')) {
        const r = t.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.left < f.left - 1 || r.right > f.right + 1 || r.top < f.top - 1 || r.bottom > f.bottom + 1) out.push(t.textContent || t.tagName);
      }
    }
    return out;
  });
}

// Controls must not sit on top of each other (buttons, inputs, the 3D view, tables).
async function boxOverlaps(page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('main .button, main input, main select, main .view, main table, main .chart-box')]
      .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
    const out = [];
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
        const a = els[i].getBoundingClientRect(), b = els[j].getBoundingClientRect();
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 1 && h > 1) out.push(`${els[i].id || els[i].className} overlaps ${els[j].id || els[j].className}`);
      }
    }
    return out;
  });
}

for (const path of PAGES) {
  for (const size of SIZES) {
    test(`${path} at ${size.name}: no errors, no sideways scroll, nothing overlapping`, async () => {
      const { page, context, errors } = await open(path, size);
      const scroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(scroll <= 0, `page scrolls sideways by ${scroll}px`);
      assert.deepEqual(await textOverlaps(page), []);
      assert.deepEqual(await svgOutside(page), []);
      assert.deepEqual(await boxOverlaps(page), []);
      assert.deepEqual(errors, []);
      await context.close();
    });
  }
}


test('home: the library, its facts, and a 3D view', async () => {
  const { page, context, errors } = await open('index.html');
  assert.equal(await page.$eval('#hero-view', (n) => n.dataset.mode), 'webgl');
  assert.match(await page.textContent('#fact-year'), /^\d+(\.\d)?$/);
  assert.match(await page.textContent('#fact-face'), /^\d+%$/);
  assert.match(await page.textContent('#fact-plan'), /^\$[\d,]+$/);
  assert.match(await page.textContent('#fact-guide'), /^\$[\d,]+$/);
  assert.match(await page.textContent('#home-status'), /20,000 flights simulated/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('explore: works without WebGL, with the tables still there', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      return /webgl/.test(type) ? null : orig.call(this, type, ...rest);
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}explore.html`);
  await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 60000 });
  assert.equal(await page.$eval('#view', (n) => n.dataset.mode), 'flat');
  assert.match(await page.textContent('#view'), /needs WebGL/);
  assert.equal(await page.locator('#top tbody tr').count(), 10);
  assert.deepEqual(errors, []);
  await context.close();
});

test('explore: inspect a pane, switch sites, and refuse hostile files', async () => {
  const { page, context, errors } = await open('explore.html');
  assert.ok((await page.locator('#facades tbody tr').count()) >= 4);
  await page.click('#top tbody tr:first-child button');
  assert.match(await page.textContent('#pane-hint'), /Library, (south|north) facade/);
  assert.match(await page.textContent('#pane-info'), /Strikes a year/);
  assert.equal(await page.locator('#pane-seen .bar-row').count(), 4);
  assert.deepEqual(await textOverlaps(page), []);
  await page.uncheck('#flights');
  await page.selectOption('#site', 'glass-tower');
  await page.waitForFunction(() => /Glass Corner Tower/.test(document.getElementById('status').textContent), null, { timeout: 60000 });
  assert.equal(await page.getAttribute('#example', 'href'), 'assets/scenes/glass-tower.json');

  const dir = mkdtempSync(join(tmpdir(), 'clearflight-'));
  try {
    const junk = join(dir, 'junk.json');
    writeFileSync(junk, 'not json <script>alert(1)</script>');
    await page.setInputFiles('#file', junk);
    await page.waitForFunction(() => /not valid JSON/.test(document.getElementById('form-error').textContent), null, { timeout: 30000 });
    const hostile = join(dir, 'hostile.json');
    writeFileSync(hostile, JSON.stringify({ name: '<img src=x onerror=alert(1)>', width: 50, depth: 50, buildings: [{ x: 1, y: 1, width: 5, depth: 5, floors: 1 }] }));
    await page.setInputFiles('#file', hostile);
    await page.waitForFunction(() => /must be a name/.test(document.getElementById('form-error').textContent), null, { timeout: 30000 });
    assert.match(await page.textContent('#status'), /Still showing Glass Corner Tower/);
    const polluted = join(dir, 'polluted.json');
    writeFileSync(polluted, '{"width":50,"depth":50,"__proto__":{"isAdmin":true},"buildings":[{"x":1,"y":1,"width":5,"depth":5,"floors":1}]}');
    await page.setInputFiles('#file', polluted);
    await page.waitForFunction(() => /unknown setting/.test(document.getElementById('form-error').textContent), null, { timeout: 30000 });
    const own = join(dir, 'own.json');
    writeFileSync(own, JSON.stringify({ name: 'My shop', width: 40, depth: 30, flights: 3000, buildings: [{ name: 'Shop', x: 10, y: 10, width: 12, depth: 8, floors: 1, all: { glazing: 0.8 } }], trees: [{ x: 5, y: 4, height: 8, crown: 3 }] }));
    await page.setInputFiles('#file', own);
    await page.waitForFunction(() => /My shop/.test(document.getElementById('status').textContent), null, { timeout: 60000 });
    assert.equal(await page.isHidden('#form-error'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(await page.$('img[src="x"]'), null);
  assert.equal(await page.evaluate(() => ({}).isAdmin), undefined);
  assert.deepEqual(errors, []);
  await context.close();
});

test('plan: the budget drives the plan, the chart and the work order; the CSV downloads', async () => {
  const { page, context, errors } = await open('plan.html');
  const saved = async () => parseFloat(await page.textContent('#kpi-saved'));
  const at20k = await saved();
  assert.ok(at20k > 0);
  await page.$eval('#budget', (n) => { n.value = '2000'; n.dispatchEvent(new Event('input')); });
  await page.waitForFunction(() => document.getElementById('budget-out').textContent === '$2,000');
  await page.waitForFunction((v) => parseFloat(document.getElementById('kpi-saved').textContent) < v, at20k, { timeout: 30000 });
  const cost = Number((await page.textContent('#kpi-cost')).replace(/[$,]/g, ''));
  assert.ok(cost <= 2000, `spent ${cost}`);
  assert.equal(await page.locator('#frontier svg path.frontier-line').count(), 1);
  assert.match(await page.textContent('#compare'), /Riskiest|risk per dollar/);
  assert.deepEqual(await textOverlaps(page), []);
  const [csv] = await Promise.all([page.waitForEvent('download'), page.click('#csv')]);
  const lines = readFileSync(await csv.path(), 'utf8').trim().split('\r\n');
  assert.equal(lines[0], '"Building","Facade","Floor","Bay","Glass","Area m2","Treatment","Strikes a year before"');
  assert.ok(lines.length > 1);
  assert.ok(lines.slice(1).every((l) => /^"Library",/.test(l)));
  await page.$eval('#budget', (n) => { n.value = '0'; n.dispatchEvent(new Event('input')); });
  await page.waitForFunction(() => /Nothing to treat/.test(document.getElementById('orders').textContent), null, { timeout: 30000 });
  await page.selectOption('#site', 'garden-house');
  await page.waitForFunction(() => /Garden House/.test(document.getElementById('status').textContent), null, { timeout: 60000 });
  assert.deepEqual(errors, []);
  await context.close();
});

test('method: the live checks show the planner never losing to riskiest-first', async () => {
  const { page, context, errors } = await open('method.html');
  await page.waitForFunction(() => document.querySelectorAll('#checks tbody tr').length === 3, null, { timeout: 60000 });
  const gains = await page.$$eval('#checks tbody tr td:last-child', (t) => t.map((x) => x.textContent));
  for (const g of gains) assert.match(g, /^(\+\d+%|equal)$/);
  assert.equal(await page.locator('#fresnel svg path').count(), 4);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the static server refuses paths outside the site', async () => {
  for (const p of ['../package.json', '..%2fpackage.json', '%2e%2e/%2e%2e/etc/passwd', 'assets/../../package.json']) {
    const res = await fetch(base + p);
    assert.notEqual(res.status, 200, p);
  }
});
