// One call for the web worker and the tests: simulate the flights, then build the planner.
import { guidelinePlan, planner, planFor, greedyPlan, PRICES } from './plan.js';
import { byFacade, simulate } from './risk.js';
import { checkScene, parseScene, LIMITS, SceneError } from './scene.js';
export { checkScene, parseScene, simulate, planner, planFor, guidelinePlan, greedyPlan, byFacade, PRICES, LIMITS, SceneError };
export function analyse(scene, budgetCap = LIMITS.budget) {
    const risk = simulate(scene);
    const pl = planner(risk, budgetCap);
    const frontier = [];
    let last = -1;
    for (let c = 0; c <= pl.cap; c++) {
        const v = pl.frontier[c];
        if (v > last + 1e-9) {
            frontier.push({ cost: c * PRICES.unit, saving: v });
            last = v;
        }
    }
    return { scene, risk, planner: pl, guideline: guidelinePlan(pl), frontier };
}
