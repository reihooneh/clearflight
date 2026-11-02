// Engine tests, run on the compiled modules the site uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkScene, parseScene, panes, SceneError, LIMITS } from '../../site/assets/js/engine/scene.js';
import { fresnel, strikeChance, rayBox, raySphere, look, PaneIndex, simulate, OPTICS } from '../../site/assets/js/engine/risk.js';
import { planner, planFor, costOf, greedyPlan, guidelinePlan, options, PRICES } from '../../site/assets/js/engine/plan.js';
import { analyse } from '../../site/assets/js/engine/index.js';

const scene = (name) => parseScene(readFileSync(new URL(`../../scenes/${name}.json`, import.meta.url), 'utf8'));
const box = (extra = {}) => ({ width: 60, depth: 60, flights: 4000, buildings: [{ x: 20, y: 20, width: 20, depth: 10, floors: 2, ...extra }], trees: [] });
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// ---------- Optics ----------

test('Fresnel: the glass reflectance at head-on, rising to a mirror at a glancing angle', () => {
  for (const { r0 } of Object.values(OPTICS)) {
    assert.ok(near(fresnel(1, r0), r0));
    assert.ok(near(fresnel(0, r0), 1));
    let last = Infinity;
    for (let c = 0; c <= 1; c += 0.05) {
      const r = fresnel(c, r0);
      assert.ok(r <= last + 1e-12, 'falls as the approach gets more head-on');
      last = r;
    }
  }
  assert.ok(strikeChance(1, 1) > strikeChance(0.2, 1), 'head-on is worse than glancing');
  assert.equal(strikeChance(1, 0), 0);
});

// ---------- Geometry ----------

test('rays meet boxes and crowns where the geometry says', () => {
  const b = { x: 10, y: 10, width: 10, depth: 4, floors: 2, floorHeight: 3 };
  const enter = rayBox([0, 12, 2], [1, 0, 0], b);
  assert.ok(enter && near(enter.t, 10) && enter.normal[0] === -1);
  const exit = rayBox([15, 12, 2], [1, 0, 0], b, true);
  assert.ok(exit && near(exit.t, 5) && exit.normal[0] === 1);
  assert.equal(rayBox([0, 12, 7], [1, 0, 0], b), null, 'passes over the roof');
  assert.equal(rayBox([0, 12, 2], [-1, 0, 0], b), null, 'flying away');
  assert.ok(near(/** @type {number} */ (raySphere([0, 0, 0], [1, 0, 0], [10, 0, 0], 2)), 8));
  assert.equal(raySphere([0, 0, 0], [0, 1, 0], [10, 0, 0], 2), null);
});

test('what a bird sees along a ray', () => {
  const s = checkScene({ ...box(), trees: [{ x: 5, y: 5, height: 10, crown: 3 }] });
  assert.equal(look(s, [5, 50, 5], [0, 0, 1]), 'sky');
  assert.equal(look(s, [5, 50, 5], [0, 0, -1]), 'ground');
  assert.equal(look(s, [5, 50, 7], [0, -1, 0]), 'tree');
  assert.equal(look(s, [0, 25, 3], [1, 0, 0]), 'building');
});

test('every pane is found again from its own centre', () => {
  for (const name of ['riverside-library', 'glass-tower', 'garden-house']) {
    const s = scene(name);
    const list = panes(s);
    const idx = new PaneIndex(s, list);
    for (const p of list) assert.equal(idx.at(p.building, p.normal, p.center)?.id, p.id, `${name} pane ${p.id}`);
  }
});

test('panes: ribbon windows per floor, sized by glazing', () => {
  const s = checkScene(box({ all: { glazing: 0.5 }, floorHeight: 4 }));
  const list = panes(s);
  // 20 m faces: 13 columns; 10 m faces: 7 columns; two floors each.
  assert.equal(list.length, 2 * (13 + 7 + 13 + 7));
  for (const p of list) assert.ok(near(p.top - p.bottom, 2));
  const area = list.reduce((a, p) => a + p.area, 0);
  assert.ok(near(area, 0.5 * 4 * 2 * (20 + 10) * 2, 1e-6), 'half of every wall is glass');
});

// ---------- Hostile and broken scenes ----------

test('scene files are checked strictly and never run', () => {
  const bad = [
    ['not json {', 'not valid JSON'],
    ['[1,2]', 'must be an object'],
    ['{"width":60,"depth":60,"buildings":[],"extra":1}', 'unknown setting'],
    ['{"width":60,"depth":60,"__proto__":{"polluted":1},"buildings":[]}', 'unknown setting'],
    ['{"width":1e999,"depth":60,"buildings":[]}', 'must be a number'],
    ['{"width":60,"depth":60,"buildings":[]}', 'at least one building'],
    ['{"width":60,"depth":60,"buildings":[{"x":50,"y":0,"width":20,"depth":5,"floors":1}]}', 'fit inside the site'],
    ['{"width":60,"depth":60,"buildings":[{"x":0,"y":0,"width":20,"depth":5,"floors":1},{"x":10,"y":2,"width":5,"depth":5,"floors":1}]}', 'overlaps'],
    ['{"width":60,"depth":60,"buildings":[{"x":0,"y":0,"width":20,"depth":5,"floors":1,"name":"<img src=x onerror=alert(1)>"}]}', 'must be a name'],
    ['{"width":60,"depth":60,"buildings":[{"x":0,"y":0,"width":20,"depth":5,"floors":1,"name":"Lab\\u202eSECRET"}]}', 'must be a name'],
    ['{"width":60,"depth":60,"buildings":[{"x":0,"y":0,"width":20,"depth":5,"floors":1.5}]}', 'whole number'],
    ['{"width":60,"depth":60,"buildings":[{"x":0,"y":0,"width":20,"depth":5,"floors":2,"seeThrough":[3]}]}', 'seeThrough'],
    ['{"width":60,"depth":60,"buildings":[{"x":0,"y":0,"width":20,"depth":5,"floors":1,"all":{"glass":"diamond"}}]}', 'must be one of'],
    ['{"width":60,"depth":60,"buildings":[{"x":20,"y":20,"width":20,"depth":5,"floors":1}],"trees":[{"x":21,"y":21,"height":8,"crown":3}]}', 'grows into'],
    ['{"width":400,"depth":400,"buildings":[{"x":0,"y":0,"width":400,"depth":400,"floors":30,"all":{"glazing":1}}]}', 'more than 8000 panes'],
    [`{"width":60,"depth":60,"buildings":[],"trees":[${Array(301).fill('{"x":1,"y":1,"height":5,"crown":1}').join(',')}]}`, 'at most 300'],
    ['x'.repeat(LIMITS.bytes + 1), 'larger than 256 KB'],
  ];
  for (const [text, want] of bad) {
    assert.throws(() => parseScene(text), (e) => {
      assert.ok(e instanceof SceneError, String(e));
      assert.ok(e.message.includes(want), `${text.slice(0, 60)} gave ${e.message}`);
      assert.ok(!/SECRET|onerror|alert/.test(e.message), 'never echoes the input');
      return true;
    });
  }
  assert.equal(/** @type {any} */ ({}).polluted, undefined, 'no prototype pollution');
});

// ---------- The simulation ----------

test('the same scene always gives the same answer; another seed differs a little', () => {
  const s = scene('garden-house');
  const a = simulate(s);
  const b = simulate(s);
  assert.equal(a.perYear, b.perYear);
  const c = simulate({ ...s, seed: s.seed + 1 });
  assert.notEqual(a.perYear, c.perYear);
  assert.ok(Math.abs(a.perYear - c.perYear) / a.perYear < 0.1, 'Monte Carlo noise stays small');
});

test('mirror glass, nearby trees and see-through floors all raise the risk', () => {
  const base = { ...box({ all: { glazing: 0.8, glass: 'clear' } }), flights: 20000, trees: [{ x: 30, y: 8, height: 10, crown: 4 }, { x: 30, y: 45, height: 10, crown: 4 }, { x: 8, y: 25, height: 10, crown: 4 }] };
  const clear = simulate(checkScene(base)).perYear;
  const mirror = simulate(checkScene({ ...base, buildings: [{ ...base.buildings[0], all: { glazing: 0.8, glass: 'mirror' } }] })).perYear;
  const open = simulate(checkScene({ ...base, buildings: [{ ...base.buildings[0], seeThrough: [1] }] })).perYear;
  const bare = simulate(checkScene({ ...base, trees: [] })).perYear;
  assert.ok(mirror > clear * 1.5, `mirror ${mirror} vs clear ${clear}`);
  assert.ok(open > clear, `see-through ${open} vs ${clear}`);
  assert.ok(bare < clear, `no trees ${bare} vs ${clear}`);
});

test('markers already on the glass cut that glass\'s strikes by the marker factor', () => {
  const s = checkScene({ ...box({ all: { glazing: 0.8 } }), trees: [{ x: 30, y: 8, height: 10, crown: 4 }] });
  const t = checkScene({ ...box({ all: { glazing: 0.8, treated: 'exterior' } }), trees: [{ x: 30, y: 8, height: 10, crown: 4 }] });
  const a = simulate(s);
  const b = simulate(t);
  assert.ok(near(a.rawPerYear, b.rawPerYear, 1e-9));
  assert.ok(near(b.perYear, a.perYear * 0.1, 1e-9));
});

// ---------- Planning ----------

/** A small result with made-up risks, for checking the planner against every possible choice. */
function smallResult(seed, floors = 2) {
  const s = checkScene({ width: 40, depth: 40, flights: 1000, buildings: [{ x: 10, y: 10, width: 2, depth: 2, floors, floorHeight: 3.5, all: { glazing: 0.6 } }] });
  const res = simulate(s);
  let x = seed;
  const r = () => ((x = (x * 1103515245 + 12345) >>> 0) >>> 8) / 2 ** 24;
  for (const pr of res.risk) pr.raw = pr.strikes = r() * 5;
  res.perYear = res.rawPerYear = res.risk.reduce((a, p) => a + p.raw, 0);
  return res;
}

test('the plan is the true best for every budget (checked against every combination)', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const res = smallResult(seed);
    const pl = planner(res, 6000);
    const n = res.panes.length;
    assert.ok(n <= 9, `small enough to enumerate (${n})`);
    // Enumerate every assignment of none / interior / exterior to every pane.
    const best = new Map();
    const total = 3 ** n;
    for (let code = 0; code < total; code++) {
      const choices = [];
      let saving = 0;
      let k = code;
      for (let i = 0; i < n; i++) {
        const t = k % 3;
        k = Math.floor(k / 3);
        if (t === 0) continue;
        const o = options(res.panes[i], res.risk[i].raw).find((x) => x.treatment === (t === 1 ? 'interior' : 'exterior'));
        choices.push({ pane: i, treatment: o.treatment });
        saving += o.saving;
      }
      const cost = costOf(pl, choices);
      best.set(cost, Math.max(best.get(cost) ?? 0, saving));
    }
    for (let budget = 0; budget <= 6000; budget += 250) {
      let want = 0;
      for (const [c, s] of best) if (c <= budget) want = Math.max(want, s);
      const got = planFor(pl, budget);
      assert.ok(near(got.saving, want, 1e-9), `seed ${seed} budget ${budget}: ${got.saving} vs ${want}`);
      assert.ok(got.cost <= budget, 'within budget');
      assert.ok(near(costOf(pl, got.choices), got.cost));
    }
  }
});

test('the plan never does worse than riskiest-first, and often better', () => {
  let better = 0;
  for (const name of ['riverside-library', 'glass-tower', 'garden-house']) {
    const a = analyse(scene(name));
    for (const budget of [1000, 3000, 6000, 12000, 25000]) {
      const p = planFor(a.planner, budget);
      const g = greedyPlan(a.planner, budget);
      assert.ok(p.saving >= g.saving - 1e-9, `${name} ${budget}`);
      if (p.saving > g.saving * 1.02) better++;
    }
  }
  assert.ok(better >= 5, `the exact plan beat the greedy one ${better} times`);
});

test('the guideline plan treats every pane below 16 m from the outside', () => {
  const a = analyse(scene('glass-tower'));
  const g = guidelinePlan(a.planner);
  const low = a.risk.panes.filter((p) => p.bottom < 16 && p.treated !== 'exterior');
  assert.equal(g.choices.length, low.length);
  assert.ok(g.choices.every((c) => c.treatment === 'exterior'));
  // The frontier reaches the same saving for less once the budget allows it.
  const p = planFor(a.planner, g.cost);
  assert.ok(p.saving >= g.saving - 1e-9);
  assert.equal(PRICES.unit, 50);
});
