// The engine runs here, off the page's main thread, so the page never freezes.
import { analyse, byFacade, greedyPlan, parseScene, planFor, SceneError } from '../engine/index.js';
export const PRESETS = ['riverside-library', 'glass-tower', 'garden-house'];
const MAX_TEXT = 256 * 1024;
let current = null;
const scope = self;
function summary(a) {
    return {
        scene: a.scene,
        panes: a.risk.panes,
        risk: a.risk.risk,
        perYear: a.risk.perYear,
        flights: a.risk.flights,
        metGlass: a.risk.metGlass,
        metWall: a.risk.metWall,
        sample: a.risk.sample,
        facades: byFacade(a.risk),
        frontier: a.frontier,
        guideline: { cost: a.guideline.cost, saving: a.guideline.saving, count: a.guideline.choices.length },
        maxBudget: a.planner.cap * 50,
    };
}
async function handle(req) {
    if (req.kind === 'plan') {
        if (!current)
            throw new SceneError('no site is loaded yet');
        const budget = Number(req.budget);
        if (!Number.isFinite(budget) || budget < 0 || budget > 200_000)
            throw new SceneError('the budget must be from $0 to $200,000');
        const plan = planFor(current.planner, budget);
        const greedy = greedyPlan(current.planner, budget);
        return { plan, greedy: { cost: greedy.cost, saving: greedy.saving } };
    }
    let text;
    if (req.kind === 'preset') {
        const name = PRESETS.find((p) => p === req.name);
        if (!name)
            throw new SceneError('unknown example site');
        const res = await fetch(new URL(`../../scenes/${name}.json`, import.meta.url));
        if (!res.ok)
            throw new SceneError('the example site could not be loaded');
        text = await res.text();
    }
    else {
        if (typeof req.text !== 'string' || req.text.length > MAX_TEXT)
            throw new SceneError('the scene file is larger than 256 KB');
        text = req.text;
    }
    current = analyse(parseScene(text));
    return summary(current);
}
scope.addEventListener('message', (e) => {
    const req = e.data;
    handle(req).then((result) => scope.postMessage({ id: req.id, result }), (err) => scope.postMessage({ id: req.id, error: err instanceof SceneError ? err.message : 'the site could not be analysed' }));
});
