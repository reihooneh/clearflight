// One call for the web worker and the tests: simulate the flights, then build the planner.

import { guidelinePlan, planner, planFor, greedyPlan, PRICES, type Plan, type Planner } from './plan.js';
import { byFacade, simulate, type RiskResult } from './risk.js';
import { checkScene, parseScene, LIMITS, SceneError, type Scene } from './scene.js';

export { checkScene, parseScene, simulate, planner, planFor, guidelinePlan, greedyPlan, byFacade, PRICES, LIMITS, SceneError };
export type { Scene, RiskResult, Planner, Plan };

export interface Analysis {
  scene: Scene;
  risk: RiskResult;
  planner: Planner;
  guideline: Plan;
  /** The frontier as ($, strikes a year avoided) points for drawing. */
  frontier: { cost: number; saving: number }[];
}

export function analyse(scene: Scene, budgetCap: number = LIMITS.budget): Analysis {
  const risk = simulate(scene);
  const pl = planner(risk, budgetCap);
  const frontier: { cost: number; saving: number }[] = [];
  let last = -1;
  for (let c = 0; c <= pl.cap; c++) {
    const v = pl.frontier[c] as number;
    if (v > last + 1e-9) {
      frontier.push({ cost: c * PRICES.unit, saving: v });
      last = v;
    }
  }
  return { scene, risk, planner: pl, guideline: guidelinePlan(pl), frontier };
}
