// Why birds fly into glass, as a model: a bird flying across the site meets a pane. What it
// sees there is a mix of the reflection (trees and sky look like open space to fly into) and
// whatever shows through the glass (a dark room, or more trees through a see-through lobby).
// The more "open" the pane looks and the more head-on the approach, the likelier a strike.

import { FACADES, columns, facadeFrame, panes, type Building, type FacadeName, type Glass, type Pane, type Scene, type Treatment } from './scene.js';
import { add, dot, normalize, reflect, rng, scale, sub, type Vec } from './vec.js';

/** Reflectance at normal incidence and light let through, by kind of glass. */
export const OPTICS: Record<Glass, { r0: number; tau: number }> = {
  clear: { r0: 0.04, tau: 0.85 },
  'low-e': { r0: 0.1, tau: 0.7 },
  tinted: { r0: 0.06, tau: 0.4 },
  mirror: { r0: 0.45, tau: 0.15 },
};

/** How much of a strike risk is left with markers on the glass (CSA A460-style dot patterns). */
export const MARKER_FACTOR: Record<Treatment, number> = { none: 1, interior: 0.4, exterior: 0.1 };

/** How inviting each thing looks to a bird when seen in or through glass (1 = open habitat). */
export const LOOKS = { tree: 1, sky: 0.7, ground: 0.4, building: 0.2, interior: 0.1 } as const;
export type Seen = keyof typeof LOOKS;

/** Schlick's approximation to the Fresnel reflectance: glass reflects more at glancing angles. */
export function fresnel(cos: number, r0: number): number {
  const c = Math.min(1, Math.max(0, cos));
  return r0 + (1 - r0) * (1 - c) ** 5;
}

/**
 * Most birds that meet glass see it and turn away. This scale is chosen so the example sites
 * land in the ranges field studies report (Loss et al. 2014: a few strikes a year for a house,
 * tens for a low-rise or a high-rise near trees). Results are best read as relative: which
 * panes, and how much a plan helps.
 */
export const STRIKE_SCALE = 0.004;

/** Probability that a bird meeting a pane at this angle, seeing this much "open space", hits it. */
export function strikeChance(cos: number, open: number): number {
  return STRIKE_SCALE * Math.min(1, Math.max(0, open)) * (0.4 + 0.6 * Math.min(1, Math.max(0, cos)));
}

// ---------- Ray tests ----------

interface BoxHit {
  t: number;
  normal: Vec;
}

/** Where a ray enters (or, from inside, leaves) a building's box, with the face normal there. */
export function rayBox(o: Vec, d: Vec, b: Building, exit = false): BoxHit | null {
  const lo: Vec = [b.x, b.y, 0];
  const hi: Vec = [b.x + b.width, b.y + b.depth, b.floors * b.floorHeight];
  let tmin = -Infinity;
  let tmax = Infinity;
  let nmin: Vec = [0, 0, 0];
  let nmax: Vec = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const dk = d[k] as number;
    const ok = o[k] as number;
    if (Math.abs(dk) < 1e-12) {
      if (ok < (lo[k] as number) || ok > (hi[k] as number)) return null;
      continue;
    }
    let t1 = ((lo[k] as number) - ok) / dk;
    let t2 = ((hi[k] as number) - ok) / dk;
    const n1: [number, number, number] = [0, 0, 0];
    n1[k] = -1;
    const n2: [number, number, number] = [0, 0, 0];
    n2[k] = 1;
    let a: Vec = n1;
    let z: Vec = n2;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      [a, z] = [z, a];
    }
    if (t1 > tmin) (tmin = t1), (nmin = a);
    if (t2 < tmax) (tmax = t2), (nmax = z);
    if (tmin > tmax) return null;
  }
  if (exit) return tmax > 1e-9 ? { t: tmax, normal: nmax } : null;
  return tmin > 1e-9 ? { t: tmin, normal: nmin } : null;
}

/** Distance along a ray to a sphere (a tree crown), or null. */
export function raySphere(o: Vec, d: Vec, c: Vec, r: number): number | null {
  const oc = sub(o, c);
  const b = dot(oc, d);
  const cc = dot(oc, oc) - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t = -b - s > 1e-9 ? -b - s : -b + s;
  return t > 1e-9 ? t : null;
}

export function crownCentre(t: { x: number; y: number; height: number; crown: number }): Vec {
  return [t.x, t.y, t.height - t.crown];
}

/** What a bird sees looking along a ray: the first thing it meets. */
export function look(scene: Scene, o: Vec, d: Vec, skipBuilding = -1): Seen {
  let best = 400;
  let seen: Seen = 'sky';
  if (d[2] < -1e-9) {
    const tg = -o[2] / d[2];
    if (tg > 0 && tg < best) (best = tg), (seen = 'ground');
  }
  for (const tr of scene.trees) {
    const t = raySphere(o, d, crownCentre(tr), tr.crown);
    if (t !== null && t < best) (best = t), (seen = 'tree');
  }
  scene.buildings.forEach((b, i) => {
    if (i === skipBuilding) return;
    const h = rayBox(o, d, b);
    if (h && h.t < best) (best = h.t), (seen = 'building');
  });
  return seen;
}

export function facadeOf(normal: Vec): FacadeName {
  if (normal[1] > 0.5) return 'north';
  if (normal[1] < -0.5) return 'south';
  if (normal[0] > 0.5) return 'east';
  return 'west';
}

/** Finds which pane (if any) is at a point on a building's wall. */
export class PaneIndex {
  private readonly map = new Map<string, number>();
  constructor(readonly scene: Scene, readonly list: Pane[]) {
    for (const p of list) this.map.set(`${p.building}|${p.facade}|${p.floor}|${p.column}`, p.id);
  }
  at(bi: number, normal: Vec, point: Vec): Pane | null {
    if (Math.abs(normal[2]) > 0.5) return null; // roof or underside
    const b = this.scene.buildings[bi] as Building;
    const f = facadeOf(normal);
    const fr = facadeFrame(b, f);
    const s = dot(sub(point, fr.origin), fr.u);
    const cols = columns(fr.length);
    const col = Math.min(cols - 1, Math.max(0, Math.floor((s / fr.length) * cols)));
    const floor = Math.min(b.floors, Math.floor(point[2] / b.floorHeight) + 1);
    const id = this.map.get(`${bi}|${f}|${floor}|${col}`);
    if (id === undefined) return null;
    const p = this.list[id] as Pane;
    return point[2] >= p.bottom && point[2] <= p.top ? p : null;
  }
}

// ---------- Flights ----------

export interface Flight {
  from: Vec;
  to: Vec;
  pane: number; // pane met, or -1
  end: Vec; // where the flight stops (the pane or wall it met, or its destination)
  chance: number; // strike chance at that pane
}

export interface PaneRisk {
  id: number;
  meetings: number; // simulated flights that reached this pane
  strikes: number; // expected strikes a year, with any markers already on it
  raw: number; // ... as if it had no markers
  seen: Record<Seen, number>; // what the pane showed the birds that met it (reflection)
  through: number; // share of the "open look" that came through the glass
}

export interface RiskResult {
  panes: Pane[];
  risk: PaneRisk[];
  perYear: number; // expected strikes a year across the site, with existing markers
  rawPerYear: number;
  flights: number;
  metGlass: number;
  metWall: number;
  sample: Flight[];
}

function pointInCrown(t: Scene['trees'][number], r: () => number): Vec {
  const c = crownCentre(t);
  for (;;) {
    const v: Vec = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1];
    if (dot(v, v) <= 1) return add(c, scale(v, t.crown * 0.9));
  }
}

function pointOnEdge(scene: Scene, r: () => number, top: number): Vec {
  const p = r() * 2 * (scene.width + scene.depth);
  const z = 1.5 + r() * (top - 1.5);
  if (p < scene.width) return [p, 0, z];
  if (p < scene.width + scene.depth) return [scene.width, p - scene.width, z];
  if (p < 2 * scene.width + scene.depth) return [p - scene.width - scene.depth, scene.depth, z];
  return [0, p - 2 * scene.width - scene.depth, z];
}

/**
 * Simulates flights between tree crowns and across the site edges, and works out every
 * pane's yearly strikes. Deterministic for a given scene (seeded).
 */
export function simulate(scene: Scene, sampleSize = 80): RiskResult {
  const list = panes(scene);
  const index = new PaneIndex(scene, list);
  const r = rng(scene.seed);
  const risk: PaneRisk[] = list.map((p) => ({ id: p.id, meetings: 0, strikes: 0, raw: 0, seen: { tree: 0, sky: 0, ground: 0, building: 0, interior: 0 }, through: 0 }));
  const weights = scene.trees.map((t) => t.crown ** 3);
  const total = weights.reduce((a, b) => a + b, 0);
  const top = Math.max(12, ...scene.trees.map((t) => t.height));
  const pickTree = (): number => {
    let x = r() * total;
    for (let i = 0; i < weights.length; i++) {
      x -= weights[i] as number;
      if (x <= 0) return i;
    }
    return weights.length - 1;
  };
  const endpoint = (avoid: number): [Vec, number] => {
    if (scene.trees.length && r() < 0.7) {
      let i = pickTree();
      if (i === avoid && scene.trees.length > 1) i = (i + 1) % scene.trees.length;
      return [pointInCrown(scene.trees[i] as Scene['trees'][number], r), i];
    }
    return [pointOnEdge(scene, r, top), -1];
  };

  let metGlass = 0;
  let metWall = 0;
  let strikes = 0;
  let raw = 0;
  const sample: Flight[] = [];
  for (let f = 0; f < scene.flights; f++) {
    const [from, ti] = endpoint(-1);
    const [to] = endpoint(ti);
    const seg = sub(to, from);
    const len = Math.hypot(seg[0], seg[1], seg[2]);
    if (len < 0.5) continue;
    const d = scale(seg, 1 / len);
    let hitT = len;
    let hitB = -1;
    let hitN: Vec = [0, 0, 0];
    scene.buildings.forEach((b, bi) => {
      const h = rayBox(from, d, b);
      if (h && h.t < hitT) (hitT = h.t), (hitB = bi), (hitN = h.normal);
    });
    let flight: Flight = { from, to, pane: -1, end: to, chance: 0 };
    if (hitB >= 0) {
      const at = add(from, scale(d, hitT));
      const pane = index.at(hitB, hitN, at);
      flight = { ...flight, end: at };
      if (!pane) {
        metWall++;
      } else {
        metGlass++;
        const cos = -dot(d, pane.normal);
        const opt = OPTICS[pane.glass];
        const R = fresnel(cos, opt.r0);
        const T = (1 - R) * opt.tau;
        const reflected = look(scene, add(at, scale(pane.normal, 0.01)), normalize(reflect(d, pane.normal)), -1);
        let behind: Seen = 'interior';
        if (pane.seeThrough) {
          const b = scene.buildings[hitB] as Building;
          const inside = add(at, scale(d, 0.01));
          const out = rayBox(inside, d, b, true);
          if (out) {
            const exit = add(inside, scale(d, out.t));
            const far = index.at(hitB, out.normal, exit);
            if (far && far.seeThrough) behind = look(scene, add(exit, scale(d, 0.01)), d, hitB);
          }
        }
        const open = R * LOOKS[reflected] + T * LOOKS[behind];
        const chance = strikeChance(cos, open);
        const pr = risk[pane.id] as PaneRisk;
        pr.meetings++;
        pr.seen[reflected]++;
        pr.raw += chance;
        pr.strikes += chance * MARKER_FACTOR[pane.treated];
        pr.through += (T * LOOKS[behind]) / Math.max(open, 1e-9);
        raw += chance;
        strikes += chance * MARKER_FACTOR[pane.treated];
        flight = { ...flight, pane: pane.id, chance: chance * MARKER_FACTOR[pane.treated] };
      }
    }
    if (sample.length < sampleSize && f % 41 === 0) sample.push(flight); // an even sample, not just the strikes
  }
  const perFlight = (scene.flightsPerDay * 365) / scene.flights;
  for (const pr of risk) {
    pr.through = pr.meetings ? pr.through / pr.meetings : 0;
    pr.strikes *= perFlight;
    pr.raw *= perFlight;
  }
  return {
    panes: list,
    risk,
    perYear: strikes * perFlight,
    rawPerYear: raw * perFlight,
    flights: scene.flights,
    metGlass,
    metWall,
    sample,
  };
}

/** Sums of risk by building facade, for summaries. */
export function byFacade(res: RiskResult): { building: number; facade: FacadeName; strikes: number; area: number }[] {
  const out: { building: number; facade: FacadeName; strikes: number; area: number }[] = [];
  const key = (b: number, f: FacadeName) => b * 4 + FACADES.indexOf(f);
  const acc = new Map<number, { building: number; facade: FacadeName; strikes: number; area: number }>();
  for (const p of res.panes) {
    const k = key(p.building, p.facade);
    const e = acc.get(k) ?? { building: p.building, facade: p.facade, strikes: 0, area: 0 };
    e.strikes += (res.risk[p.id] as PaneRisk).strikes;
    e.area += p.area;
    acc.set(k, e);
  }
  for (const [, v] of [...acc].sort((a, b) => a[0] - b[0])) out.push(v);
  return out;
}
