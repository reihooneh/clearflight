// Small SVG charts drawn from the engine's numbers. All text goes in as text nodes.
import { svg } from './dom.js';
const W = 640;
const H = 330;
const M = { l: 64, r: 22, t: 40, b: 56 };
export function lineChart(series, o) {
    const x = (v) => M.l + (Math.min(v, o.xMax) / o.xMax) * (W - M.l - M.r);
    const y = (v) => H - M.b - (Math.min(v, o.yMax) / o.yMax) * (H - M.t - M.b);
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'chart-svg' });
    for (const t of o.yTicks) {
        root.append(svg('line', { x1: M.l, x2: W - M.r, y1: y(t), y2: y(t), class: 'grid' }));
        // The zero is left to the x axis's first label, so the two never collide.
        if (t !== 0)
            root.append(svg('text', { x: M.l - 8, y: y(t) + 5, 'text-anchor': 'end', class: 'tick' }, o.yFmt(t)));
    }
    for (const t of o.xTicks) {
        root.append(svg('line', { x1: x(t), x2: x(t), y1: H - M.b, y2: H - M.b + 5, class: 'axis' }));
        root.append(svg('text', { x: x(t), y: H - M.b + 20, 'text-anchor': 'middle', class: 'tick' }, o.xFmt(t)));
    }
    root.append(svg('line', { x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b, class: 'axis' }));
    root.append(svg('line', { x1: M.l, x2: M.l, y1: M.t, y2: H - M.b, class: 'axis' }));
    root.append(svg('text', { x: (M.l + W - M.r) / 2, y: H - 10, 'text-anchor': 'middle', class: 'axis-label' }, o.xLabel));
    root.append(svg('text', { x: 4, y: 26, 'text-anchor': 'start', class: 'axis-label' }, `${o.yLabel} ↑`));
    if (o.vline)
        root.append(svg('line', { x1: x(o.vline.x), x2: x(o.vline.x), y1: M.t, y2: H - M.b, class: o.vline.cls }));
    for (const s of series) {
        let d = '';
        s.points.forEach(([px, py], i) => {
            if (px > o.xMax && i > 0)
                return;
            if (i === 0)
                d += `M${x(px).toFixed(1)},${y(py).toFixed(1)}`;
            else if (o.step)
                d += `H${x(px).toFixed(1)}V${y(py).toFixed(1)}`;
            else
                d += `L${x(px).toFixed(1)},${y(py).toFixed(1)}`;
        });
        if (o.step && s.points.length)
            d += `H${x(o.xMax).toFixed(1)}`;
        const path = svg('path', { d, class: s.cls });
        path.append(svg('title', {}, s.label));
        root.append(path);
    }
    (o.marks ?? []).forEach((m, i) => {
        const cx = x(m.x);
        const cy = y(m.y);
        root.append(svg('circle', { cx, cy, r: 6 - i, class: m.cls }));
        if (o.markLabels === false)
            return;
        const anchor = m.anchor ?? (cx > W * 0.6 ? 'end' : 'start');
        root.append(svg('text', { x: anchor === 'end' ? cx - 9 : cx + 9, y: cy + (cy < M.t + 20 ? 16 : -9), 'text-anchor': anchor, class: `mark-label ${m.cls}` }, m.label));
    });
    return root;
}
/** Round "nice" tick values from 0 to max. */
export function ticks(max, count = 5) {
    const raw = max / count;
    const mag = 10 ** Math.floor(Math.log10(raw || 1));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
    const out = [];
    for (let v = 0; v <= max + 1e-9; v += step)
        out.push(Number(v.toFixed(10)));
    return out;
}
