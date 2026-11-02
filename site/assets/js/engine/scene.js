// The scene: a site with buildings, their glass, and trees. Scenes can come from a file the
// user loads, so everything is checked strictly: known keys only, finite numbers in range,
// bounded lists and safe names. The checked scene is rebuilt from scratch, never reused.
export const GLASS = ['clear', 'low-e', 'tinted', 'mirror'];
export const TREATMENT = ['none', 'interior', 'exterior'];
export const FACADES = ['north', 'east', 'south', 'west'];
export const LIMITS = Object.freeze({
    bytes: 256 * 1024,
    site: 400,
    buildings: 12,
    trees: 300,
    floors: 30,
    panes: 8000,
    flights: 100_000,
    budget: 200_000,
});
export class SceneError extends Error {
}
const SAFE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} '.,&()-]{0,59}$/u;
const HIDDEN = /[\p{Cc}\p{Cf}]/u;
function object(v, where, keys) {
    if (typeof v !== 'object' || v === null || Array.isArray(v))
        throw new SceneError(`${where} must be an object`);
    for (const k of Object.keys(v)) {
        if (!keys.includes(k))
            throw new SceneError(`${where} has an unknown setting (allowed: ${keys.join(', ')})`);
    }
    return v;
}
function num(o, key, where, lo, hi, fallback) {
    const v = o[key] ?? fallback;
    if (typeof v !== 'number' || !Number.isFinite(v))
        throw new SceneError(`${where}.${key} must be a number`);
    if (v < lo || v > hi)
        throw new SceneError(`${where}.${key} must be from ${lo} to ${hi}`);
    return v;
}
function int(o, key, where, lo, hi, fallback) {
    const v = num(o, key, where, lo, hi, fallback);
    if (!Number.isInteger(v))
        throw new SceneError(`${where}.${key} must be a whole number`);
    return v;
}
function name(o, key, where, fallback) {
    const v = o[key] ?? fallback;
    if (typeof v !== 'string' || HIDDEN.test(v) || !SAFE_NAME.test(v.trim())) {
        throw new SceneError(`${where}.${key} must be a name of letters, digits, spaces and ' . , & ( ) - (up to 60)`);
    }
    return v.trim();
}
function choice(o, key, where, allowed, fallback) {
    const v = o[key] ?? fallback;
    if (typeof v !== 'string' || !allowed.includes(v)) {
        throw new SceneError(`${where}.${key} must be one of ${allowed.join(', ')}`);
    }
    return v;
}
function list(v, where, max) {
    if (v === undefined)
        return [];
    if (!Array.isArray(v))
        throw new SceneError(`${where} must be a list`);
    if (v.length > max)
        throw new SceneError(`${where} can have at most ${max} entries`);
    return v;
}
function facade(v, where, fallback) {
    if (v === undefined)
        return { ...fallback };
    const o = object(v, where, ['glazing', 'glass', 'treated']);
    return {
        glazing: num(o, 'glazing', where, 0, 1, fallback.glazing),
        glass: choice(o, 'glass', where, GLASS, fallback.glass),
        treated: choice(o, 'treated', where, TREATMENT, fallback.treated),
    };
}
/** Checks a parsed JSON value and returns a clean scene. */
export function checkScene(raw) {
    const o = object(raw, 'scene', ['name', 'width', 'depth', 'flightsPerDay', 'flights', 'seed', 'buildings', 'trees']);
    const scene = {
        name: name(o, 'name', 'scene', 'My site'),
        width: num(o, 'width', 'scene', 10, LIMITS.site),
        depth: num(o, 'depth', 'scene', 10, LIMITS.site),
        flightsPerDay: num(o, 'flightsPerDay', 'scene', 1, 100_000, 500),
        flights: int(o, 'flights', 'scene', 1000, LIMITS.flights, 20_000),
        seed: int(o, 'seed', 'scene', 0, 2 ** 31 - 1, 1),
        buildings: [],
        trees: [],
    };
    list(o.buildings, 'scene.buildings', LIMITS.buildings).forEach((b, i) => {
        const where = `building ${i + 1}`;
        const bo = object(b, where, ['name', 'x', 'y', 'width', 'depth', 'floors', 'floorHeight', 'seeThrough', 'facades', 'all']);
        const all = facade(bo.all, `${where}.all`, { glazing: 0.5, glass: 'clear', treated: 'none' });
        const fo = bo.facades === undefined ? {} : object(bo.facades, `${where}.facades`, FACADES);
        const floors = int(bo, 'floors', where, 1, LIMITS.floors);
        const building = {
            name: name(bo, 'name', where, `Building ${i + 1}`),
            x: num(bo, 'x', where, 0, scene.width),
            y: num(bo, 'y', where, 0, scene.depth),
            width: num(bo, 'width', where, 2, LIMITS.site),
            depth: num(bo, 'depth', where, 2, LIMITS.site),
            floors,
            floorHeight: num(bo, 'floorHeight', where, 2.5, 8, 3.5),
            seeThrough: list(bo.seeThrough, `${where}.seeThrough`, LIMITS.floors).map((f) => {
                if (typeof f !== 'number' || !Number.isInteger(f) || f < 1 || f > floors) {
                    throw new SceneError(`${where}.seeThrough lists floors from 1 to ${floors}`);
                }
                return f;
            }),
            facades: {
                north: facade(fo.north, `${where}.facades.north`, all),
                east: facade(fo.east, `${where}.facades.east`, all),
                south: facade(fo.south, `${where}.facades.south`, all),
                west: facade(fo.west, `${where}.facades.west`, all),
            },
        };
        if (building.x + building.width > scene.width || building.y + building.depth > scene.depth) {
            throw new SceneError(`${where} must fit inside the site`);
        }
        for (const other of scene.buildings) {
            const apart = building.x >= other.x + other.width || other.x >= building.x + building.width ||
                building.y >= other.y + other.depth || other.y >= building.y + building.depth;
            if (!apart)
                throw new SceneError(`${where} overlaps ${other.name}`);
        }
        scene.buildings.push(building);
    });
    list(o.trees, 'scene.trees', LIMITS.trees).forEach((t, i) => {
        const where = `tree ${i + 1}`;
        const to = object(t, where, ['x', 'y', 'height', 'crown']);
        const tree = {
            x: num(to, 'x', where, 0, scene.width),
            y: num(to, 'y', where, 0, scene.depth),
            height: num(to, 'height', where, 1, 60),
            crown: num(to, 'crown', where, 0.5, 20),
        };
        if (tree.crown * 2 > tree.height + 1)
            throw new SceneError(`${where}: the crown is wider than the tree is tall`);
        for (const b of scene.buildings) {
            const dx = Math.max(b.x - tree.x, 0, tree.x - (b.x + b.width));
            const dy = Math.max(b.y - tree.y, 0, tree.y - (b.y + b.depth));
            if (Math.hypot(dx, dy) < tree.crown)
                throw new SceneError(`${where} grows into ${b.name}`);
        }
        scene.trees.push(tree);
    });
    if (!scene.buildings.length)
        throw new SceneError('the scene needs at least one building');
    if (panes(scene).length > LIMITS.panes)
        throw new SceneError(`the scene has more than ${LIMITS.panes} panes of glass`);
    return scene;
}
/** Parses text as JSON (never as code) and checks it. */
export function parseScene(text) {
    if (text.length > LIMITS.bytes)
        throw new SceneError('the scene file is larger than 256 KB');
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch {
        throw new SceneError('the scene file is not valid JSON');
    }
    return checkScene(raw);
}
export const PANE_WIDTH = 1.5;
export function facadeFrame(b, f) {
    switch (f) {
        case 'north':
            return { origin: [b.x + b.width, b.y + b.depth, 0], u: [-1, 0, 0], normal: [0, 1, 0], length: b.width };
        case 'south':
            return { origin: [b.x, b.y, 0], u: [1, 0, 0], normal: [0, -1, 0], length: b.width };
        case 'east':
            return { origin: [b.x + b.width, b.y, 0], u: [0, 1, 0], normal: [1, 0, 0], length: b.depth };
        case 'west':
            return { origin: [b.x, b.y + b.depth, 0], u: [0, -1, 0], normal: [-1, 0, 0], length: b.depth };
    }
}
/** Glazed band of a floor: a ribbon window centred in the floor's height. */
export function band(b, f, floor) {
    const g = b.facades[f].glazing;
    if (g <= 0)
        return null;
    const base = (floor - 1) * b.floorHeight;
    const h = b.floorHeight * g;
    const sill = base + (b.floorHeight - h) / 2;
    return [sill, sill + h];
}
export function columns(length) {
    return Math.max(1, Math.round(length / PANE_WIDTH));
}
/** Every pane of glass in the scene, in a fixed order. */
export function panes(scene) {
    const out = [];
    scene.buildings.forEach((b, bi) => {
        for (const f of FACADES) {
            const fr = facadeFrame(b, f);
            const cols = columns(fr.length);
            const w = fr.length / cols;
            for (let floor = 1; floor <= b.floors; floor++) {
                const bd = band(b, f, floor);
                if (!bd)
                    continue;
                for (let c = 0; c < cols; c++) {
                    const s = (c + 0.5) * w;
                    const z = (bd[0] + bd[1]) / 2;
                    out.push({
                        id: out.length,
                        building: bi,
                        facade: f,
                        floor,
                        column: c,
                        center: [fr.origin[0] + fr.u[0] * s, fr.origin[1] + fr.u[1] * s, z],
                        normal: fr.normal,
                        u: fr.u,
                        halfW: w / 2,
                        halfH: (bd[1] - bd[0]) / 2,
                        area: w * (bd[1] - bd[0]),
                        bottom: bd[0],
                        top: bd[1],
                        glass: b.facades[f].glass,
                        treated: b.facades[f].treated,
                        seeThrough: b.seeThrough.includes(floor),
                    });
                }
            }
        }
    });
    return out;
}
