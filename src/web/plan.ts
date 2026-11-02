import { Engine, PRESET_NAMES, readSceneFile, type PlanReply, type Summary } from './client.js';
import { $, csvCell, download, el, fmt, ready, replace, setText } from './dom.js';
import { lineChart, ticks } from './chart.js';
import { SiteView } from './view3d.js';
import { MARKER_FACTOR } from '../engine/risk.js';

const engine = new Engine();
const view = new SiteView($('view'));
let current: Summary | null = null;
let last: PlanReply | null = null;
let pending = 0;

const budgetInput = $('budget') as HTMLInputElement;

function chart(s: Summary, budget: number, reply: PlanReply): void {
  const total = Math.max(1e-12, s.perYear);
  const xMax = Math.max(5000, Number(budgetInput.max));
  const pts: [number, number][] = s.frontier.map((p) => [p.cost, (100 * p.saving) / total]);
  const marks = [
    { x: Math.min(budget, xMax), y: (100 * reply.plan.saving) / total, cls: 'm-plan', label: `This plan: ${fmt.pct(reply.plan.saving / total)}` },
    { x: Math.min(reply.greedy.cost, xMax), y: (100 * reply.greedy.saving) / total, cls: 'm-greedy', label: `Riskiest first: ${fmt.pct(reply.greedy.saving / total)}` },
  ];
  replace(
    'frontier',
    lineChart([{ points: pts, cls: 'frontier-line', label: 'Best plan at each budget' }], {
      xMax,
      yMax: 100,
      xTicks: ticks(xMax, 4),
      yTicks: [0, 25, 50, 75, 100],
      xLabel: 'Budget',
      yLabel: 'Strikes prevented',
      xFmt: (v) => (v >= 1000 ? `$${v / 1000}k` : `$${v}`),
      yFmt: (v) => `${v}%`,
      marks,
      vline: { x: Math.min(budget, xMax), cls: 'budget-line' },
      step: true,
      markLabels: false,
    }),
    el(
      'p',
      { class: 'chart-key' },
      ...marks.map((m) => el('span', { class: `key ${m.cls}` }, el('span', { class: 'key-dot', 'aria-hidden': 'true' }), m.label)),
      el('span', { class: 'key budget' }, el('span', { class: 'key-dash', 'aria-hidden': 'true' }), 'Your budget'),
    ),
  );
}

function orders(s: Summary, reply: PlanReply): void {
  const groups = new Map<string, { building: string; facade: string; interior: number; exterior: number; area: number; saving: number; lift: boolean }>();
  for (const ch of reply.plan.choices) {
    const p = s.panes[ch.pane];
    if (!p) continue;
    const key = `${p.building}|${p.facade}`;
    const g = groups.get(key) ?? { building: s.scene.buildings[p.building]?.name ?? '', facade: p.facade, interior: 0, exterior: 0, area: 0, saving: 0, lift: false };
    g[ch.treatment]++;
    g.area += p.area;
    g.saving += (s.risk[p.id]?.raw ?? 0) * (MARKER_FACTOR[p.treated] - MARKER_FACTOR[ch.treatment]);
    if (ch.treatment === 'exterior' && p.bottom >= 3) g.lift = true;
    groups.set(key, g);
  }
  const head = el('thead', {}, el('tr', {}, ...['Facade', 'Exterior panes', 'Interior panes', 'Glass', 'Lift', 'Strikes prevented'].map((c, i) => el('th', { scope: 'col', class: i > 0 && i !== 4 ? 'num' : undefined }, c))));
  const rows = [...groups.values()].map((g) =>
    el(
      'tr',
      {},
      el('th', { scope: 'row' }, `${g.building} · ${g.facade}`),
      el('td', { class: 'num' }, g.exterior),
      el('td', { class: 'num' }, g.interior),
      el('td', { class: 'num' }, fmt.area(g.area)),
      el('td', {}, g.lift ? 'yes' : 'no'),
      el('td', { class: 'num' }, fmt.n(g.saving, 2)),
    ),
  );
  const body = el('tbody', {}, ...(rows.length ? rows : [el('tr', {}, el('td', { colspan: 6, class: 'muted' }, 'Nothing to treat at this budget: a setup visit alone costs $600.'))]));
  replace('orders', head, body);
}

async function update(): Promise<void> {
  const s = current;
  if (!s) return;
  const budget = Number(budgetInput.value);
  setText('budget-out', fmt.money(budget));
  const ticket = ++pending;
  const reply = await engine.plan(budget);
  if (ticket !== pending) return; // a newer budget was asked for meanwhile
  last = reply;
  const p = reply.plan;
  const total = Math.max(1e-12, s.perYear);
  setText('kpi-saved', fmt.n(p.saving, 1));
  setText('kpi-share', fmt.pct(p.saving / total));
  setText('kpi-cost', fmt.money(p.cost));
  const area = p.choices.reduce((a, c) => a + (s.panes[c.pane]?.area ?? 0), 0);
  setText('kpi-area', fmt.area(area));
  const g = s.guideline;
  replace(
    'compare',
    el('li', {}, `Ranking panes by risk per dollar and working down the list prevents ${fmt.n(reply.greedy.saving, 1)} a year for ${fmt.money(reply.greedy.cost)}.`),
    el('li', {}, `Treating all ${g.count} panes below 16 m from outside (the usual guideline) would cost ${fmt.money(g.cost)} and prevent ${fmt.pct(g.saving / total)} of strikes.`),
  );
  const treated = new Map(p.choices.map((c) => [c.pane, c.treatment] as const));
  view.show(s, { treated });
  chart(s, budget, reply);
  orders(s, reply);
}

async function load(job: Promise<Summary>, label: string): Promise<void> {
  const err = $('form-error');
  err.hidden = true;
  setText('status', `Simulating flights for ${label}…`);
  try {
    current = await job;
    const max = Math.min(200_000, Math.max(5000, Math.ceil(Math.min(current.maxBudget, current.guideline.cost * 1.1) / 1000) * 1000));
    budgetInput.max = String(max);
    if (Number(budgetInput.value) > max) budgetInput.value = String(max);
    await update();
    setText('status', `${current.scene.name}: about ${fmt.n(current.perYear)} strikes a year before treatment. Move the budget to see the best plan for it.`);
  } catch (e) {
    err.textContent = `That scene could not be used: ${(e as Error).message}.`;
    err.hidden = false;
    setText('status', current ? `Still showing ${current.scene.name}.` : 'No site loaded.');
  }
}

budgetInput.addEventListener('input', () => void update());
$('site').addEventListener('change', () => {
  const name = ($('site') as HTMLSelectElement).value;
  void load(engine.preset(name), PRESET_NAMES[name] ?? 'the site');
});
$('file').addEventListener('change', () => {
  const f = ($('file') as HTMLInputElement).files?.[0];
  if (f) void load(readSceneFile(f).then((t) => engine.text(t)), 'your scene');
});
$('csv').addEventListener('click', () => {
  const s = current;
  if (!s || !last) return;
  const lines = [['Building', 'Facade', 'Floor', 'Bay', 'Glass', 'Area m2', 'Treatment', 'Strikes a year before'].map(csvCell).join(',')];
  for (const ch of last.plan.choices) {
    const p = s.panes[ch.pane];
    if (!p) continue;
    lines.push(
      [s.scene.buildings[p.building]?.name ?? '', p.facade, p.floor, p.column + 1, p.glass, p.area.toFixed(2), ch.treatment, (s.risk[p.id]?.raw ?? 0).toFixed(3)].map(csvCell).join(','),
    );
  }
  download(`clearflight-plan-${Math.round(Number(budgetInput.value))}.csv`, lines.join('\r\n') + '\r\n');
});

void load(engine.preset('riverside-library'), 'the Riverside Library').then(ready);
