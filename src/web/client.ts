// Talks to the engine worker with promises.

import type { Summary } from './worker.js';
import type { Plan } from '../engine/plan.js';

export type { Summary };
export interface PlanReply {
  plan: Plan;
  greedy: { cost: number; saving: number };
}

export const PRESET_NAMES: Record<string, string> = {
  'riverside-library': 'Riverside Library',
  'glass-tower': 'Glass Corner Tower',
  'garden-house': 'Garden House',
};

export class Engine {
  private readonly worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  private next = 1;
  private readonly waiting = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>();

  constructor() {
    this.worker.addEventListener('message', (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const w = this.waiting.get(e.data.id);
      if (!w) return;
      this.waiting.delete(e.data.id);
      if (e.data.error !== undefined) w.fail(new Error(e.data.error));
      else w.ok(e.data.result);
    });
  }

  private ask<T>(msg: Record<string, unknown>): Promise<T> {
    const id = this.next++;
    return new Promise<T>((ok, fail) => {
      this.waiting.set(id, { ok: ok as (v: unknown) => void, fail });
      this.worker.postMessage({ ...msg, id });
    });
  }

  preset(name: string): Promise<Summary> {
    return this.ask({ kind: 'preset', name });
  }
  text(text: string): Promise<Summary> {
    return this.ask({ kind: 'text', text });
  }
  plan(budget: number): Promise<PlanReply> {
    return this.ask({ kind: 'plan', budget });
  }
}

/** Reads a user's scene file: size-checked before it is read, and only as text. */
export async function readSceneFile(file: File): Promise<string> {
  if (file.size > 256 * 1024) throw new Error('the scene file is larger than 256 KB');
  return file.text();
}
