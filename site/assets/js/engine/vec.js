// Small 3D vector helpers. x points east, y north, z up; all lengths in metres.
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const length = (a) => Math.sqrt(dot(a, a));
export function normalize(a) {
    const n = length(a);
    return n > 0 ? scale(a, 1 / n) : [0, 0, 0];
}
/** The mirror direction of `d` in a surface with unit normal `n`. */
export function reflect(d, n) {
    return sub(d, scale(n, 2 * dot(d, n)));
}
/** A small, fast, seeded random number generator (mulberry32), so every run is repeatable. */
export function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
