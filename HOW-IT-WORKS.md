# How Clearflight works

A walkthrough of the model, the optimiser and the website, written so you can explain every part of it in an interview.

## 1. Architecture

```
 scene JSON ──▶ scene.ts    strict checks → buildings, trees, and every pane of glass
                   │
                   ▼
                risk.ts     20,000 seeded flights → first thing each flight meets
                   │        at glass: Fresnel reflection + view through → strike chance
                   ▼
                plan.ts     per-facade knapsack (2 states: lift paid or not)
                   │        → max-plus combine across facades → best plan for every budget
                   ▼
   web worker ──▶ pages     3D view (three.js), tables, SVG charts, CSV work order
```

The engine is pure TypeScript with no dependencies. The same compiled files run in a Web Worker on the site and under `node --test` in CI.

## 2. File tour

| File | Job |
|---|---|
| `src/engine/vec.ts` | 3D vectors, mirror reflection, and a seeded random generator (mulberry32) |
| `src/engine/scene.ts` | The scene format, strict validation, and generating panes (ribbon windows per floor and bay) |
| `src/engine/risk.ts` | Fresnel optics, ray–box and ray–sphere tests, what a bird sees, the flight simulation, pane lookup |
| `src/engine/plan.ts` | Treatment options, the per-facade knapsack, the cross-facade combination, rebuilding a plan, and the guideline and greedy plans |
| `src/engine/index.ts` | `analyse()`: simulate, then build the planner and the frontier |
| `src/web/worker.ts`, `client.ts` | The engine off the main thread, with promise-based messages |
| `src/web/view3d.ts` | three.js view: instanced panes coloured by risk, trees, flights, picking, orbit by pointer, keyboard and pinch |
| `src/web/home.ts`, `explore.ts`, `plan.ts`, `method.ts` | One script per page |
| `src/web/chart.ts`, `dom.ts` | SVG charts and safe DOM helpers (no HTML strings anywhere) |
| `scripts/build.mjs`, `serve.mjs`, `shoot.mjs` | Page layout with the CSP, vendoring, a contained static server, screenshots |
| `tests/engine`, `tests/web` | 12 engine tests and 19 browser tests |

## 3. Key ideas, simply

### Why birds hit glass
Birds don't see glass. They see what's in it: a reflection of trees or sky looks like more trees and sky, and clear glass with daylight behind it looks like a gap. So the danger of a pane depends on **what it shows from where birds actually fly**, not just what it's made of.

### Flights as rays
Each simulated flight is a straight segment between two points:
- inside tree crowns (chosen in proportion to crown volume);
- low over open ground;
- at the site's edge.

The first thing on the segment is found with a **slab test** against each building's box. If the entry point lands on a glass pane, the bird meets that pane; if it lands on a wall, it turns away. Pane lookup is O(1): the hit point's distance along the facade gives the bay, its height gives the floor, and a map keyed by `building|facade|floor|bay` returns the pane.

### The Fresnel effect
How much glass reflects depends on the angle. Schlick's approximation is

```
R(θ) = R₀ + (1 − R₀)(1 − cos θ)⁵
```

R₀ is the reflectance head-on: 4% for clear glass, 45% for mirror glass. At a glancing angle every glass becomes a mirror. That's why a bird skimming along a facade sees a strong reflection.

### What the pane looks like
At the meeting point two rays are traced:
- **The mirror ray** `d − 2(d·n)n` finds what's reflected: tree, sky, ground or building.
- **The straight-on ray** finds what's behind the glass. On ordinary floors that's a dark room. On see-through floors, the ray crosses the building and, if it leaves through glass on the far side, keeps going to whatever is beyond. That's how glass lobbies and corners become traps.

Each thing has an "openness" (tree 1.0, sky 0.7, ground 0.4, building 0.2, dark room 0.1), and the pane's look is

```
open = R(θ) · reflected + (1 − R(θ)) · τ · through
```

where τ is the glass's light transmission. The strike chance is the pane's openness, times a factor that favours head-on approaches, times what any existing markers leave (exterior 10%, interior 40%), times one calibration constant.

### Choosing treatments: why not just sort?
If every pane cost the same and had no fixed costs, you'd sort panes by strikes avoided per dollar and stop at the budget. But the real costs aren't like that:
- **Setup:** the first pane on a facade brings a $600 setup visit.
- **Lift:** the first exterior pane above the ground floor brings a $1,500 lift for that facade.
- **Choice:** each pane can be left alone, given interior markers or given exterior markers.

These make it a **multiple-choice knapsack with fixed charges**, where sorting can go badly wrong. On the three examples at $5,000 the sorted plan is 13–34% worse.

### The exact planner
Money is counted in $50 units.
1. **Inside a facade:** keep two tables, `s0[c]` (best saving spending c units, no lift paid yet) and `s1[c]` (lift paid). Each pane updates both tables:
   - an option that doesn't need the lift moves within the same table;
   - an exterior option above the ground floor moves within `s1`, or from `s0` into `s1` while paying for the lift.

   At the end, adding the setup cost gives the facade's best saving for every spend.
2. **Across facades:** keep only the undominated points of each facade's curve, then combine facade by facade: `F'[c] = max over points (k, v) of F[c − k] + v`. That's a **max-plus convolution**. After the last facade, `F[c]` is the best saving for **every** budget c, which makes the chart and the instant slider possible.
3. **Rebuilding the plan** for one budget walks the stored choices backwards: which point each facade used, then which option each pane took (re-running that facade's table with choice arrays).

The tests check this against brute force: every one of the 3⁸ = 6,561 combinations on random small buildings, at 25 budgets each.

### The 3D view
All panes are **one `InstancedMesh`**: a single unit square drawn hundreds of times with a per-instance matrix (position, facade orientation, size) and colour. That's one draw call instead of 1,000. Clicking uses a `Raycaster` against the instanced mesh, which returns the instance id, and so the pane. Colours run from pale glass blue through amber to deep red by the square root of strikes per m², so the smaller differences stay visible.

## 4. Trade-offs

- **Straight-line flights** rather than flocking or species-specific behaviour: simple, fast and explainable. The model is best at ranking panes, not predicting exact counts.
- **Monte Carlo with a fixed seed**: the results are repeatable, and the tests show another seed changes the total by under 10%.
- **$50 steps** in the planner: exact at that resolution. Finer steps grow the tables linearly.
- **Boxes and ribbon windows**: they keep pane lookup O(1) and the scene format small, at the cost of curved facades and balconies.
- **Web Worker and plain TypeScript, no framework**: a small attack surface and fast loading, at the cost of writing DOM code by hand.

## 5. Interview questions

**Q: Why is greedy wrong here, when it's optimal for fractional knapsack?**
A: Greedy by value per cost is optimal only when items are divisible and independent. Here each pane is all-or-nothing, a pane has three options, and setup and lift costs are shared across the panes of a facade. So the first pane on a facade is expensive and later ones are cheap. Greedy can refuse that first pane even when the facade is the best investment, or spend its last dollars on a fixed charge it can't use. The DP accounts for the shared costs exactly.

**Q: What's the complexity of the planner?**
A: Inside facades it's O(panes × budget units × options), because each pane updates two tables of size B. Across facades it's O(facades × B × points per facade). With 8,000 panes and B = 4,000 (that is, $200,000) that's tens of millions of simple operations, under a second in a worker, and it's done once per scene. After that, every budget is a lookup.

**Q: How do you know the model is right?**
A: There are two separate claims. The *computation* is verified: the geometry, the Fresnel limits, every pane's lookup, and the planner against brute force. The *model* is checked against what field research agrees on: reflected vegetation, see-through glass and low heights raise the risk, and the tests check it moves in those directions. Its absolute numbers are calibrated to published ranges and shown as estimates. Being clear about which claim is which matters.

**Q: How does the site stay safe when people upload their own files?**
A: The file is parsed as JSON, never evaluated, and every object is checked against a list of allowed keys (so `__proto__` is refused). Numbers are range-checked, names are limited to a safe character set, and sizes and counts are capped. All text is added with `textContent`, and a strict CSP forbids inline scripts. The heavy work happens in a Web Worker, so a hostile file can't freeze the page.

**Q: Why is the slider instant?**
A: Because the max-plus combination computes the best saving for every budget at once. Moving the slider only rebuilds which panes to treat for that budget, which is a backwards walk through stored choices.

## 6. Extension ideas

1. **Night strikes:** model lit floors after dark as attractors for migrating birds, and add "lights out" as a zero-cost treatment the planner can choose.
2. **Uncertainty bands:** run several seeds and openness settings, and show the range of strikes per pane, so a facility manager sees which conclusions are robust.
3. **Planting as a treatment:** moving or adding trees changes both where birds fly and what the glass reflects. Searching over planting positions would be a fascinating extension.
