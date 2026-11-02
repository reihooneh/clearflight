// Choosing which glass to treat. Each pane can get interior markers (cheaper, less effective)
// or exterior markers (more effective). A facade costs a setup visit if anything on it is
// treated, and exterior work above the ground floor needs a lift, paid once per facade.
// Those fixed charges make it more than "best pane first": the plan is found exactly (in $50
// steps) by dynamic programming, first inside each facade, then across facades.

import { FACADES, type FacadeName, type Pane, type Treatment } from './scene.js';
import { MARKER_FACTOR, type RiskResult } from './risk.js';

export const PRICES = Object.freeze({
  interior: 45, // $ per m² of interior marker film
  exterior: 110, // $ per m² of exterior marker film
  setup: 600, // $ per facade with any treatment
  lift: 1500, // $ per facade with exterior work above the ground floor
  liftAbove: 3, // metres: glass whose bottom edge is this high needs the lift from outside
  unit: 50, // $ steps of the plan
});

export interface Option {
  pane: number;
  treatment: Exclude<Treatment, 'none'>;
  cost: number; // in units
  saving: number; // strikes a year avoided
  lift: boolean;
}

export interface FacadeCurve {
  building: number;
  facade: FacadeName;
  panes: number[];
  points: { cost: number; saving: number }[]; // undominated (cost, saving) choices, cost 0 first
}

export interface Plan {
  budget: number; // $
  cost: number; // $
  saving: number; // strikes a year avoided
  left: number; // strikes a year left
  choices: { pane: number; treatment: Exclude<Treatment, 'none'> }[];
  facades: { building: number; facade: FacadeName; cost: number; lift: boolean }[];
}

/** The ways of treating one pane, with what each costs and saves. */
export function options(p: Pane, raw: number): Option[] {
  const now = MARKER_FACTOR[p.treated];
  const out: Option[] = [];
  for (const t of ['interior', 'exterior'] as const) {
    const after = MARKER_FACTOR[t];
    if (after >= now) continue;
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

interface FacadeTable {
  best: Float64Array; // best saving for each cost, fixed charges included
  pick?: Int8Array[]; // per pane and state: the option taken at each cost (for rebuilding)
}

/**
 * Multiple-choice knapsack for one facade with two states: lift not yet paid, lift paid.
 * best[c] is the most strikes a year avoided spending exactly c units or less on this facade.
 */
function facadeTable(opts: Option[][], cap: number, keep: boolean): { best: Float64Array; pick0?: Int8Array[]; pick1?: Int8Array[] } {
  const setup = Math.ceil(PRICES.setup / PRICES.unit);
  const lift = Math.ceil(PRICES.lift / PRICES.unit);
  let s0 = new Float64Array(cap + 1).fill(NEG);
  let s1 = new Float64Array(cap + 1).fill(NEG);
  s0[0] = 0;
  const pick0: Int8Array[] = [];
  const pick1: Int8Array[] = [];
  for (const os of opts) {
    const n0 = Float64Array.from(s0);
    const n1 = Float64Array.from(s1);
    const p0 = keep ? new Int8Array(cap + 1).fill(-1) : undefined;
    const p1 = keep ? new Int8Array(cap + 1).fill(-1) : undefined;
    os.forEach((o, k) => {
      for (let c = o.cost; c <= cap; c++) {
        // Staying without the lift: only options that don't need it.
        if (!o.lift) {
          const a = (s0[c - o.cost] as number) + o.saving;
          if (a > (n0[c] as number)) (n0[c] = a), p0 && (p0[c] = k);
          const b = (s1[c - o.cost] as number) + o.saving;
          if (b > (n1[c] as number)) (n1[c] = b), p1 && (p1[c] = k);
        } else {
          const b = (s1[c - o.cost] as number) + o.saving;
          if (b > (n1[c] as number)) (n1[c] = b), p1 && (p1[c] = k);
          if (c - o.cost - lift >= 0) {
            const a = (s0[c - o.cost - lift] as number) + o.saving;
            if (a > (n1[c] as number)) (n1[c] = a), p1 && (p1[c] = k + 64); // +64: this option paid the lift
          }
        }
      }
    });
    s0 = n0;
    s1 = n1;
    if (p0 && p1) pick0.push(p0), pick1.push(p1);
  }
  // Any treatment at all costs the setup visit.
  const best = new Float64Array(cap + 1).fill(0);
  for (let c = 0; c <= cap; c++) {
    const inner = Math.max(s0[c - setup] ?? NEG, s1[c - setup] ?? NEG);
    best[c] = Math.max(c > 0 ? (best[c - 1] as number) : 0, inner > 0 ? inner : 0);
  }
  return keep ? { best, pick0, pick1 } : { best };
}

function undominated(best: Float64Array): { cost: number; saving: number }[] {
  const pts = [{ cost: 0, saving: 0 }];
  for (let c = 1; c < best.length; c++) {
    if ((best[c] as number) > (pts[pts.length - 1] as { saving: number }).saving + 1e-12) pts.push({ cost: c, saving: best[c] as number });
  }
  return pts;
}

export interface Planner {
  curves: FacadeCurve[];
  cap: number; // units
  frontier: Float64Array; // best saving for each budget (units), across all facades
  stagePick: Int32Array[]; // per facade stage: which point of its curve was used at each budget
  res: RiskResult;
  opts: Option[][]; // per pane
}

/** Builds every facade's cost/saving curve and combines them for every budget up to `budget` $. */
export function planner(res: RiskResult, budget: number): Planner {
  const opts = res.panes.map((p) => options(p, res.risk[p.id]?.raw ?? 0));
  const groups = new Map<number, number[]>();
  for (const p of res.panes) {
    const k = p.building * 4 + FACADES.indexOf(p.facade);
    groups.set(k, [...(groups.get(k) ?? []), p.id]);
  }
  const needAll = res.panes.reduce((s, p) => s + Math.max(0, ...(opts[p.id] ?? []).map((o) => o.cost)), 0);
  const fixed = groups.size * Math.ceil((PRICES.setup + PRICES.lift) / PRICES.unit);
  const cap = Math.max(0, Math.min(Math.ceil(budget / PRICES.unit), needAll + fixed));
  const curves: FacadeCurve[] = [];
  for (const [k, ids] of [...groups].sort((a, b) => a[0] - b[0])) {
    const { best } = facadeTable(ids.map((id) => opts[id] ?? []), cap, false);
    curves.push({ building: Math.floor(k / 4), facade: FACADES[k % 4] as FacadeName, panes: ids, points: undominated(best) });
  }
  // Across facades: each facade picks one point of its curve (max-plus convolution).
  let frontier = new Float64Array(cap + 1).fill(0);
  const stagePick: Int32Array[] = [];
  for (const cv of curves) {
    const next = new Float64Array(cap + 1).fill(NEG);
    const pick = new Int32Array(cap + 1).fill(0);
    for (let c = 0; c <= cap; c++) {
      cv.points.forEach((pt, i) => {
        if (pt.cost > c) return;
        const v = (frontier[c - pt.cost] as number) + pt.saving;
        if (v > (next[c] as number) + 1e-12) (next[c] = v), (pick[c] = i);
      });
    }
    frontier = next;
    stagePick.push(pick);
  }
  return { curves, cap, frontier, stagePick, res, opts };
}

/** The best plan for a budget in $ (at most the planner's budget). */
export function planFor(pl: Planner, budget: number): Plan {
  let c = Math.max(0, Math.min(pl.cap, Math.floor(budget / PRICES.unit)));
  const choices: Plan['choices'] = [];
  const facades: Plan['facades'] = [];
  for (let s = pl.curves.length - 1; s >= 0; s--) {
    const cv = pl.curves[s] as FacadeCurve;
    const pt = cv.points[(pl.stagePick[s] as Int32Array)[c] as number] as { cost: number; saving: number };
    c -= pt.cost;
    if (pt.cost === 0) continue;
    // Rebuild this facade's choices for exactly this spend.
    const opts = cv.panes.map((id) => pl.opts[id] ?? []);
    const t = facadeTable(opts, pt.cost, true);
    const setup = Math.ceil(PRICES.setup / PRICES.unit);
    const spend = pt.cost - setup;
    // Find the state and spend that reach the saving.
    const s0 = replay(opts, t.pick0 as Int8Array[], t.pick1 as Int8Array[], spend);
    let lift = false;
    for (const ch of s0) {
      choices.push(ch);
      if ((pl.opts[ch.pane] ?? []).find((o) => o.treatment === ch.treatment)?.lift) lift = true;
    }
    facades.push({ building: cv.building, facade: cv.facade, cost: pt.cost * PRICES.unit, lift });
  }
  const saving = choices.reduce((sum, ch) => sum + ((pl.opts[ch.pane] ?? []).find((o) => o.treatment === ch.treatment)?.saving ?? 0), 0);
  const cost = costOf(pl, choices);
  facades.reverse();
  return { budget, cost, saving, left: pl.res.perYear - saving, choices: choices.sort((a, b) => a.pane - b.pane), facades };
}

/** Walks the per-pane picks back from the best end state within `spend` units. */
function replay(opts: Option[][], pick0: Int8Array[], pick1: Int8Array[], spend: number): { pane: number; treatment: Exclude<Treatment, 'none'> }[] {
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
          n0[c] = Math.max(n0[c] as number, (s0[c - o.cost] as number) + o.saving);
          n1[c] = Math.max(n1[c] as number, (s1[c - o.cost] as number) + o.saving);
        } else {
          n1[c] = Math.max(n1[c] as number, (s1[c - o.cost] as number) + o.saving);
          if (c - o.cost - lift >= 0) n1[c] = Math.max(n1[c] as number, (s0[c - o.cost - lift] as number) + o.saving);
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
    if ((s0[c] as number) > bestV + 1e-12) (bestV = s0[c] as number), (bestC = c), (state = 0);
    if ((s1[c] as number) > bestV + 1e-12) (bestV = s1[c] as number), (bestC = c), (state = 1);
  }
  const out: { pane: number; treatment: Exclude<Treatment, 'none'> }[] = [];
  let c = bestC;
  for (let i = opts.length - 1; i >= 0; i--) {
    const os = opts[i] as Option[];
    const k = (state === 0 ? (pick0[i] as Int8Array) : (pick1[i] as Int8Array))[c] as number;
    if (k < 0) continue; // nothing on this pane
    const paidLift = k >= 64;
    const o = os[paidLift ? k - 64 : k] as Option;
    out.push({ pane: o.pane, treatment: o.treatment });
    c -= o.cost;
    if (paidLift) (c -= lift), (state = 0);
  }
  return out;
}

/** What a set of choices really costs, fixed charges included ($). */
export function costOf(pl: Planner | { res: RiskResult; opts: Option[][] }, choices: { pane: number; treatment: Exclude<Treatment, 'none'> }[]): number {
  let units = 0;
  const touched = new Set<string>();
  const lifted = new Set<string>();
  for (const ch of choices) {
    const p = pl.res.panes[ch.pane] as Pane;
    const o = (pl.opts[ch.pane] ?? []).find((x) => x.treatment === ch.treatment) as Option;
    units += o.cost;
    const key = `${p.building}|${p.facade}`;
    touched.add(key);
    if (o.lift) lifted.add(key);
  }
  return units * PRICES.unit + touched.size * PRICES.setup + lifted.size * PRICES.lift;
}

/** Bird-friendly guidelines' usual rule: exterior markers on all glass up to 16 m. */
export function guidelinePlan(pl: Planner): Plan {
  const choices: Plan['choices'] = [];
  let saving = 0;
  for (const p of pl.res.panes) {
    if (p.bottom >= 16) continue;
    const o = (pl.opts[p.id] ?? []).find((x) => x.treatment === 'exterior');
    if (!o) continue;
    choices.push({ pane: p.id, treatment: 'exterior' });
    saving += o.saving;
  }
  const cost = costOf(pl, choices);
  return { budget: cost, cost, saving, left: pl.res.perYear - saving, choices, facades: [] };
}

/** "Riskiest square metre first" with the same prices: what a careful person would do by hand. */
export function greedyPlan(pl: Planner, budget: number): Plan {
  const all = pl.opts.flat().filter((o) => o.treatment === 'exterior' || o.treatment === 'interior');
  all.sort((a, b) => b.saving / Math.max(1, b.cost) - a.saving / Math.max(1, a.cost) || a.pane - b.pane);
  const chosen = new Map<number, Option>();
  for (const o of all) {
    if (chosen.has(o.pane)) continue;
    const trial = [...chosen.values(), o].map((x) => ({ pane: x.pane, treatment: x.treatment }));
    if (costOf(pl, trial) <= budget) chosen.set(o.pane, o);
  }
  const choices = [...chosen.values()].map((x) => ({ pane: x.pane, treatment: x.treatment }));
  const saving = [...chosen.values()].reduce((s, o) => s + o.saving, 0);
  return { budget, cost: costOf(pl, choices), saving, left: pl.res.perYear - saving, choices, facades: [] };
}
