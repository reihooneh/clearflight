// Talks to the engine worker with promises.
export const PRESET_NAMES = {
    'riverside-library': 'Riverside Library',
    'glass-tower': 'Glass Corner Tower',
    'garden-house': 'Garden House',
};
export class Engine {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    next = 1;
    waiting = new Map();
    constructor() {
        this.worker.addEventListener('message', (e) => {
            const w = this.waiting.get(e.data.id);
            if (!w)
                return;
            this.waiting.delete(e.data.id);
            if (e.data.error !== undefined)
                w.fail(new Error(e.data.error));
            else
                w.ok(e.data.result);
        });
    }
    ask(msg) {
        const id = this.next++;
        return new Promise((ok, fail) => {
            this.waiting.set(id, { ok: ok, fail });
            this.worker.postMessage({ ...msg, id });
        });
    }
    preset(name) {
        return this.ask({ kind: 'preset', name });
    }
    text(text) {
        return this.ask({ kind: 'text', text });
    }
    plan(budget) {
        return this.ask({ kind: 'plan', budget });
    }
}
/** Reads a user's scene file: size-checked before it is read, and only as text. */
export async function readSceneFile(file) {
    if (file.size > 256 * 1024)
        throw new Error('the scene file is larger than 256 KB');
    return file.text();
}
