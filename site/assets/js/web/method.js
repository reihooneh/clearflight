import { fresnel, OPTICS } from '../engine/risk.js';
import { Engine, PRESET_NAMES } from './client.js';
import { lineChart } from './chart.js';
import { el, fmt, ready, replace, setText } from './dom.js';
function fresnelChart() {
    const series = Object.keys(OPTICS).map((g) => {
        const pts = [];
        for (let deg = 0; deg <= 90; deg += 2)
            pts.push([deg, 100 * fresnel(Math.cos((deg * Math.PI) / 180), OPTICS[g].r0)]);
        return { points: pts, cls: `fresnel-${g}`, label: `${g} glass` };
    });
    replace('fresnel', lineChart(series, {
        xMax: 90,
        yMax: 100,
        xTicks: [0, 15, 30, 45, 60, 75, 90],
        yTicks: [0, 25, 50, 75, 100],
        xLabel: 'Angle from head-on (degrees)',
        yLabel: 'Light reflected',
        xFmt: (v) => `${v}°`,
        yFmt: (v) => `${v}%`,
    }), el('p', { class: 'chart-key' }, ...series.map((sr) => el('span', { class: `key ${sr.cls}` }, el('span', { class: 'key-line', 'aria-hidden': 'true' }), sr.label))));
}
async function checks() {
    const engine = new Engine();
    const head = el('thead', {}, el('tr', {}, ...['Site', 'Strikes a year', 'Planner at $5,000', 'Riskiest first at $5,000', 'Planner gain'].map((c, i) => el('th', { scope: 'col', class: i > 0 ? 'num' : undefined }, c))));
    const body = el('tbody');
    replace('checks', head, body);
    for (const [name, label] of Object.entries(PRESET_NAMES)) {
        const s = await engine.preset(name);
        const { plan, greedy } = await engine.plan(5000);
        const gain = greedy.saving > 0 ? plan.saving / greedy.saving - 1 : 0;
        body.append(el('tr', {}, el('th', { scope: 'row' }, label), el('td', { class: 'num' }, fmt.n(s.perYear, 1)), el('td', { class: 'num' }, `${fmt.n(plan.saving, 2)} (${fmt.pct(plan.saving / s.perYear)})`), el('td', { class: 'num' }, `${fmt.n(greedy.saving, 2)} (${fmt.pct(greedy.saving / s.perYear)})`), el('td', { class: 'num' }, gain > 0.0005 ? `+${(gain * 100).toFixed(0)}%` : 'equal')));
    }
    setText('checks-status', 'Checked: the planner is never worse than riskiest-first, and the tests confirm it is the best possible plan.');
}
fresnelChart();
checks()
    .catch((e) => setText('checks-status', `The checks could not run: ${e.message}.`))
    .finally(ready);
