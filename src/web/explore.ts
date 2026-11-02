import { Engine, PRESET_NAMES, readSceneFile, type Summary } from './client.js';
import { $, el, fmt, ready, replace, setText } from './dom.js';
import { heatCss, densities, SiteView } from './view3d.js';

const engine = new Engine();
const view = new SiteView($('view'));
let current: Summary | null = null;
let selected = -1;

const SEEN_LABEL = { tree: 'Trees', sky: 'Sky', ground: 'Ground', building: 'Buildings', interior: 'A dark room' } as const;
const FLOOR = (n: number) => (n === 1 ? 'ground floor' : `floor ${n}`);

function paneName(s: Summary, id: number): string {
  const p = s.panes[id];
  if (!p) return '';
  const b = s.scene.buildings[p.building];
  return `${b?.name ?? 'Building'}, ${p.facade} facade, ${FLOOR(p.floor)}, bay ${p.column + 1}`;
}

function draw(): void {
  if (!current) return;
  view.show(current, { flights: ($('flights') as HTMLInputElement).checked, ...(selected >= 0 ? { selected } : {}) });
}

function showPane(id: number): void {
  const s = current;
  if (!s) return;
  const p = s.panes[id];
  const r = s.risk[id];
  if (!p || !r) return;
  selected = id;
  setText('pane-hint', paneName(s, id));
  const items: [string, string][] = [
    ['Glass', `${p.glass}${p.treated !== 'none' ? `, ${p.treated} markers` : ''}`],
    ['Size', `${p.area.toFixed(1)} m², ${p.bottom.toFixed(1)} to ${p.top.toFixed(1)} m up`],
    ['Flights that met it', fmt.n(r.meetings, 0)],
    ['Strikes a year', fmt.n(r.strikes, 2)],
    ['Open look from behind the glass', fmt.pct(r.through)],
  ];
  replace('pane-info', ...items.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
  const total = Object.values(r.seen).reduce((a, b) => a + b, 0);
  const bars = el('div', { class: 'bars' }, el('p', { class: 'bars-title' }, 'What it reflected to those birds'));
  for (const [k, label] of Object.entries(SEEN_LABEL)) {
    if (k === 'interior') continue;
    const v = total ? (r.seen[k as keyof typeof r.seen] ?? 0) / total : 0;
    const fill = el('span', { class: `bar-fill seen-${k}` });
    fill.style.width = `${(v * 100).toFixed(1)}%`;
    bars.append(el('div', { class: 'bar-row' }, el('span', { class: 'bar-label' }, label), el('span', { class: 'bar' }, fill), el('span', { class: 'bar-value' }, fmt.pct(v))));
  }
  replace('pane-seen', total ? bars : el('p', { class: 'muted' }, 'No simulated flight met this pane.'));
  draw();
}

function tables(s: Summary): void {
  const head = (...cells: string[]) => el('thead', {}, el('tr', {}, ...cells.map((c, i) => el('th', { scope: 'col', class: i > 0 && c !== 'Share' ? 'num' : undefined }, c))));
  const rows = s.facades
    .filter((f) => f.area > 0)
    .map((f) => {
      const share = f.strikes / Math.max(1e-12, s.perYear);
      const fill = el('span', { class: 'bar-fill' });
      fill.style.width = `${(share * 100).toFixed(1)}%`;
      return el(
        'tr',
        {},
        el('th', { scope: 'row' }, `${s.scene.buildings[f.building]?.name ?? ''} · ${f.facade}`),
        el('td', { class: 'num' }, fmt.area(f.area)),
        el('td', { class: 'num' }, fmt.n(f.strikes, 1)),
        el('td', { class: 'share' }, el('span', { class: 'bar' }, fill), el('span', { class: 'bar-value' }, fmt.pct(share))),
      );
    });
  replace('facades', head('Facade', 'Glass', 'Strikes a year', 'Share'), el('tbody', {}, ...rows));

  const dens = densities(s);
  const top = s.panes
    .map((p) => ({ p, r: s.risk[p.id] }))
    .filter((x) => x.r && x.r.strikes > 0)
    .sort((a, b) => (b.r?.strikes ?? 0) - (a.r?.strikes ?? 0))
    .slice(0, 10);
  const topRows = top.map(({ p, r }) => {
    const button = el('button', { type: 'button', class: 'link' }, paneName(s, p.id));
    button.addEventListener('click', () => {
      showPane(p.id);
      $('pane-title').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    const dot = el('span', { class: 'dot', 'aria-hidden': 'true' });
    dot.style.background = heatCss(dens[p.id] ?? 0);
    return el('tr', {}, el('td', {}, dot, button), el('td', { class: 'num' }, p.glass), el('td', { class: 'num' }, fmt.n(r?.strikes ?? 0, 2)));
  });
  replace('top', head('Pane', 'Glass', 'Strikes a year'), el('tbody', {}, ...topRows));
}

async function load(job: Promise<Summary>, label: string): Promise<void> {
  const err = $('form-error');
  err.hidden = true;
  setText('status', `Simulating flights for ${label}…`);
  try {
    current = await job;
    selected = -1;
    setText('pane-hint', 'Click a pane in the 3D view, or pick one from the riskiest panes below.');
    replace('pane-info');
    replace('pane-seen');
    draw();
    tables(current);
    setText('status', `${current.scene.name}: about ${fmt.n(current.perYear)} strikes a year from ${current.flights.toLocaleString('en-AU')} simulated flights (${current.metGlass.toLocaleString('en-AU')} met glass).`);
  } catch (e) {
    err.textContent = `That scene could not be used: ${(e as Error).message}.`;
    err.hidden = false;
    setText('status', current ? `Still showing ${current.scene.name}.` : 'No site loaded.');
  }
}

view.onPick(showPane);
$('flights').addEventListener('change', draw);
$('site').addEventListener('change', () => {
  const name = ($('site') as HTMLSelectElement).value;
  const a = $('example') as HTMLAnchorElement;
  a.href = `assets/scenes/${name}.json`;
  a.download = `${name}.json`;
  void load(engine.preset(name), PRESET_NAMES[name] ?? 'the site');
});
$('file').addEventListener('change', () => {
  const f = ($('file') as HTMLInputElement).files?.[0];
  if (!f) return;
  void load(
    readSceneFile(f).then((t) => engine.text(t)),
    'your scene',
  );
});

void load(engine.preset('riverside-library'), 'the Riverside Library').then(ready);
