// Choosing which glass to treat. Each pane can get interior markers (cheaper, less effective)
// or exterior markers (more effective). A facade costs a setup visit if anything on it is
// treated, and exterior work above the ground floor needs a lift, paid once per facade.
// Those fixed charges make it more than "best pane first": the plan is found exactly (in $50
// steps) by dynamic programming, first inside each facade, then across facades.
import { FACADES } from './scene.js';
import { MARKER_FACTOR } from './risk.js';
export const PRICES = Object.freeze({
    interior: 45, // $ per m² of interior marker film
    exterior: 110, // $ per m² of exterior marker film
    setup: 600, // $ per facade with any treatment
    lift: 1500, // $ per facade with exterior work above the ground floor
    liftAbove: 3, // metres: glass whose bottom edge is this high needs the lift from outside
    unit: 50, // $ steps of the plan
});
/** The ways of treating one pane, with what each costs and saves. */
export function options(p, raw) {
    const now = MARKER_FACTOR[p.treated];
    const out = [];
    for (const t of ['interior', 'exterior']) {
        const after = MARKER_FACTOR[t];
        if (after >= now)
            continue;
        out.push({
            pane: p.id,
            treatment: t,
            cost: Math.ceil((p.area * PRICES[t]) / PRICES.unit),
            saving: raw * (now - after),
            lift: t === 'exterior' && p.bottom >= PRICES.liftAbove,
        });
    }
    return out;
}
const NEG = -Infinity;
/**
 * Multiple-choice knapsack for one facade with two states: lift not yet paid, lift paid.
 * best[c] is the most strikes a year avoided spending exactly c units or less on this facade.
 */
function facadeTable(opts, cap, keep) {
    const setup = Math.ceil(PRICES.setup / PRICES.unit);
    const lift = Math.ceil(PRICES.lift / PRICES.unit);
    let s0 = new Float64Array(cap + 1).fill(NEG);
    let s1 = new Float64Array(cap + 1).fill(NEG);
    s0[0] = 0;
    const pick0 = [];
    const pick1 = [];
    for (const os of opts) {
        const n0 = Float64Array.from(s0);
        const n1 = Float64Array.from(s1);
        const p0 = keep ? new Int8Array(cap + 1).fill(-1) : undefined;
        const p1 = keep ? new Int8Array(cap + 1).fill(-1) : undefined;
        os.forEach((o, k) => {
            for (let c = o.cost; c <= cap; c++) {
                // Staying without the lift: only options that don't need it.
                if (!o.lift) {
                    const a = s0[c - o.cost] + o.saving;
                    if (a > n0[c])
                        (n0[c] = a), p0 && (p0[c] = k);
                    const b = s1[c - o.cost] + o.saving;
                    if (b > n1[c])
                        (n1[c] = b), p1 && (p1[c] = k);
                }
                else {
                    const b = s1[c - o.cost] + o.saving;
                    if (b > n1[c])
                        (n1[c] = b), p1 && (p1[c] = k);
                    if (c - o.cost - lift >= 0) {
                        const a = s0[c - o.cost - lift] + o.saving;
                        if (a > n1[c])
                            (n1[c] = a), p1 && (p1[c] = k + 64); // +64: this option paid the lift
                    }
                }
            }
        });
        s0 = n0;
        s1 = n1;
        if (p0 && p1)
            pick0.push(p0), pick1.push(p1);
    }
    // Any treatment at all costs the setup visit.
    const best = new Float64Array(cap + 1).fill(0);
    for (let c = 0; c <= cap; c++) {
        const inner = Math.max(s0[c - setup] ?? NEG, s1[c - setup] ?? NEG);
        best[c] = Math.max(c > 0 ? best[c - 1] : 0, inner > 0 ? inner : 0);
    }
    return keep ? { best, pick0, pick1 } : { best };
}
function undominated(best) {
    const pts = [{ cost: 0, saving: 0 }];
    for (let c = 1; c < best.length; c++) {
        if (best[c] > pts[pts.length - 1].saving + 1e-12)
            pts.push({ cost: c, saving: best[c] });
    }
    return pts;
}
/** Builds every facade's cost/saving curve and combines them for every budget up to `budget` $. */
export function planner(res, budget) {
    const opts = res.panes.map((p) => options(p, res.risk[p.id]?.raw ?? 0));
    const groups = new Map();
    for (const p of res.panes) {
        const k = p.building * 4 + FACADES.indexOf(p.facade);
        groups.set(k, [...(groups.get(k) ?? []), p.id]);
    }
    const needAll = res.panes.reduce((s, p) => s + Math.max(0, ...(opts[p.id] ?? []).map((o) => o.cost)), 0);
    const fixed = groups.size * Math.ceil((PRICES.setup + PRICES.lift) / PRICES.unit);
    const cap = Math.max(0, Math.min(Math.ceil(budget / PRICES.unit), needAll + fixed));
    const curves = [];
    for (const [k, ids] of [...groups].sort((a, b) => a[0] - b[0])) {
        const { best } = facadeTable(ids.map((id) => opts[id] ?? []), cap, false);
        curves.push({ building: Math.floor(k / 4), facade: FACADES[k % 4], panes: ids, points: undominated(best) });
    }
    // Across facades: each facade picks one point of its curve (max-plus convolution).
    let frontier = new Float64Array(cap + 1).fill(0);
    const stagePick = [];
    for (const cv of curves) {
        const next = new Float64Array(cap + 1).fill(NEG);
        const pick = new Int32Array(cap + 1).fill(0);
        for (let c = 0; c <= cap; c++) {
            cv.points.forEach((pt, i) => {
                if (pt.cost > c)
                    return;
                const v = frontier[c - pt.cost] + pt.saving;
                if (v > next[c] + 1e-12)
                    (next[c] = v), (pick[c] = i);
            });
        }
        frontier = next;
        stagePick.push(pick);
    }
    return { curves, cap, frontier, stagePick, res, opts };
}
/** The best plan for a budget in $ (at most the planner's budget). */
export function planFor(pl, budget) {
    let c = Math.max(0, Math.min(pl.cap, Math.floor(budget / PRICES.unit)));
    const choices = [];
    const facades = [];
    for (let s = pl.curves.length - 1; s >= 0; s--) {
        const cv = pl.curves[s];
        const pt = cv.points[pl.stagePick[s][c]];
        c -= pt.cost;
        if (pt.cost === 0)
            continue;
        // Rebuild this facade's choices for exactly this spend.
        const opts = cv.panes.map((id) => pl.opts[id] ?? []);
        const t = facadeTable(opts, pt.cost, true);
        const setup = Math.ceil(PRICES.setup / PRICES.unit);
        const spend = pt.cost - setup;
        // Find the state and spend that reach the saving.
        const s0 = replay(opts, t.pick0, t.pick1, spend);
        let lift = false;
        for (const ch of s0) {
            choices.push(ch);
            if ((pl.opts[ch.pane] ?? []).find((o) => o.treatment === ch.treatment)?.lift)
                lift = true;
        }
        facades.push({ building: cv.building, facade: cv.facade, cost: pt.cost * PRICES.unit, lift });
    }
    const saving = choices.reduce((sum, ch) => sum + ((pl.opts[ch.pane] ?? []).find((o) => o.treatment === ch.treatment)?.saving ?? 0), 0);
    const cost = costOf(pl, choices);
    facades.reverse();
    return { budget, cost, saving, left: pl.res.perYear - saving, choices: choices.sort((a, b) => a.pane - b.pane), facades };
}
/** Walks the per-pane picks back from the best end state within `spend` units. */
function replay(opts, pick0, pick1, spend) {
    // Recompute the two state tables forwards to know which end state is best.
    const lift = Math.ceil(PRICES.lift / PRICES.unit);
    let s0 = new Float64Array(spend + 1).fill(NEG);
    let s1 = new Float64Array(spend + 1).fill(NEG);
    s0[0] = 0;
    opts.forEach((os) => {
        const n0 = Float64Array.from(s0);
        const n1 = Float64Array.from(s1);
        for (const o of os) {
            for (let c = o.cost; c <= spend; c++) {
                if (!o.lift) {
                    n0[c] = Math.max(n0[c], s0[c - o.cost] + o.saving);
                    n1[c] = Math.max(n1[c], s1[c - o.cost] + o.saving);
                }
                else {
                    n1[c] = Math.max(n1[c], s1[c - o.cost] + o.saving);
                    if (c - o.cost - lift >= 0)
                        n1[c] = Math.max(n1[c], s0[c - o.cost - lift] + o.saving);
                }
            }
        }
        s0 = n0;
        s1 = n1;
    });
    let bestC = 0;
    let state = 0;
    let bestV = 0;
    for (let c = 0; c <= spend; c++) {
        if (s0[c] > bestV + 1e-12)
            (bestV = s0[c]), (bestC = c), (state = 0);
        if (s1[c] > bestV + 1e-12)
            (bestV = s1[c]), (bestC = c), (state = 1);
    }
    const out = [];
    let c = bestC;
    for (let i = opts.length - 1; i >= 0; i--) {
        const os = opts[i];
        const k = (state === 0 ? pick0[i] : pick1[i])[c];
        if (k < 0)
            continue; // nothing on this pane
        const paidLift = k >= 64;
        const o = os[paidLift ? k - 64 : k];
        out.push({ pane: o.pane, treatment: o.treatment });
        c -= o.cost;
        if (paidLift)
            (c -= lift), (state = 0);
    }
    return out;
}
/** What a set of choices really costs, fixed charges included ($). */
export function costOf(pl, choices) {
    let units = 0;
    const touched = new Set();
    const lifted = new Set();
    for (const ch of choices) {
        const p = pl.res.panes[ch.pane];
        const o = (pl.opts[ch.pane] ?? []).find((x) => x.treatment === ch.treatment);
        units += o.cost;
        const key = `${p.building}|${p.facade}`;
        touched.add(key);
        if (o.lift)
            lifted.add(key);
    }
    return units * PRICES.unit + touched.size * PRICES.setup + lifted.size * PRICES.lift;
}
/** Bird-friendly guidelines' usual rule: exterior markers on all glass up to 16 m. */
export function guidelinePlan(pl) {
    const choices = [];
    let saving = 0;
    for (const p of pl.res.panes) {
        if (p.bottom >= 16)
            continue;
        const o = (pl.opts[p.id] ?? []).find((x) => x.treatment === 'exterior');
        if (!o)
            continue;
        choices.push({ pane: p.id, treatment: 'exterior' });
        saving += o.saving;
    }
    const cost = costOf(pl, choices);
    return { budget: cost, cost, saving, left: pl.res.perYear - saving, choices, facades: [] };
}
/** "Riskiest square metre first" with the same prices: what a careful person would do by hand. */
export function greedyPlan(pl, budget) {
    const all = pl.opts.flat().filter((o) => o.treatment === 'exterior' || o.treatment === 'interior');
    all.sort((a, b) => b.saving / Math.max(1, b.cost) - a.saving / Math.max(1, a.cost) || a.pane - b.pane);
    const chosen = new Map();
    for (const o of all) {
        if (chosen.has(o.pane))
            continue;
        const trial = [...chosen.values(), o].map((x) => ({ pane: x.pane, treatment: x.treatment }));
        if (costOf(pl, trial) <= budget)
            chosen.set(o.pane, o);
    }
    const choices = [...chosen.values()].map((x) => ({ pane: x.pane, treatment: x.treatment }));
    const saving = [...chosen.values()].reduce((s, o) => s + o.saving, 0);
    return { budget, cost: costOf(pl, choices), saving, left: pl.res.perYear - saving, choices, facades: [] };
}
