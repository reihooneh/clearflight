import { Engine } from './client.js';
import { fmt, ready, setText } from './dom.js';
import { SiteView } from './view3d.js';

const FACADE = { north: 'north', east: 'east', south: 'south', west: 'west' } as const;

async function main(): Promise<void> {
  const engine = new Engine();
  const view = new SiteView(document.getElementById('hero-view') as HTMLElement, { spin: true });
  try {
    const s = await engine.preset('riverside-library');
    view.show(s, { flights: true });
    setText('fact-year', fmt.n(s.perYear));
    const worst = [...s.facades].sort((a, b) => b.strikes - a.strikes)[0];
    if (worst) {
      setText('fact-face', fmt.pct(worst.strikes / s.perYear));
      setText('fact-face-label', `of them on the ${s.scene.buildings[worst.building]?.name ?? ''} ${FACADE[worst.facade]} facade`);
    }
    const half = s.frontier.find((p) => p.saving >= 0.5 * s.perYear);
    if (half) {
      const { plan } = await engine.plan(half.cost);
      setText('fact-plan', fmt.money(plan.cost));
    }
    setText('fact-guide', fmt.money(s.guideline.cost));
    setText('home-status', `${s.flights.toLocaleString('en-AU')} flights simulated: ${s.metGlass.toLocaleString('en-AU')} met glass and ${s.metWall.toLocaleString('en-AU')} met a wall.`);
  } catch (err) {
    setText('home-status', `The model could not run: ${(err as Error).message}.`);
  }
  ready();
}

void main();
