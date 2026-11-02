// Safe DOM helpers: every piece of text goes in as text, never as HTML.

type Attrs = Record<string, string | number | boolean | undefined>;
type Child = Node | string | number | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on')) throw new Error('event handlers are added with addEventListener');
    node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(typeof c === 'number' ? String(c) : c);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on')) throw new Error('event handlers are added with addEventListener');
    node.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(typeof c === 'number' ? String(c) : c);
  return node;
}

export function $(id: string): HTMLElement {
  const n = document.getElementById(id);
  if (!n) throw new Error(`missing #${id}`);
  return n;
}

export function setText(id: string, text: string): void {
  $(id).textContent = text;
}

export function replace(id: string, ...children: Child[]): void {
  const n = $(id);
  n.replaceChildren(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false).map((c) => (typeof c === 'number' ? String(c) : c)));
}

export const fmt = {
  n: (v: number, d = 1) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-AU') : v.toFixed(d)),
  money: (v: number) => `$${Math.round(v).toLocaleString('en-AU')}`,
  pct: (v: number) => `${Math.round(v * 100)}%`,
  area: (v: number) => `${Math.round(v).toLocaleString('en-AU')} m²`,
};

/** Spreadsheet-safe CSV cell: quoted, and never starting with a formula character. */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function download(name: string, text: string, type = 'text/csv'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ready(): void {
  document.body.dataset.ready = 'yes';
}
