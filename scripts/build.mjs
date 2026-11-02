// Builds the site from its sources (run after `tsc`, which compiles src/ into site/assets/js):
//   src/pages/*.html + the shared layout  ->  site/*.html (strict CSP, no inline code)
//   scenes/*.json                         ->  site/assets/scenes/
//   three.js and the fonts (pinned npm)   ->  site/assets/vendor, site/assets/fonts
//   bare 'three' imports in compiled code ->  the self-hosted copy
// CI rebuilds the site and checks the committed copy matches.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- Vendored and copied files ----------
const copies = [
  ['node_modules/three/build/three.module.min.js', 'site/assets/vendor/three.module.min.js'],
  ['node_modules/three/LICENSE', 'site/assets/vendor/three.LICENSE.txt'],
  ['node_modules/@fontsource/dm-serif-display/files/dm-serif-display-latin-400-normal.woff2', 'site/assets/fonts/dm-serif-display.woff2'],
  ['node_modules/@fontsource/dm-serif-display/LICENSE', 'site/assets/fonts/dm-serif-display.LICENSE.txt'],
  ['node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2', 'site/assets/fonts/manrope.woff2'],
  ['node_modules/@fontsource-variable/manrope/LICENSE', 'site/assets/fonts/manrope.LICENSE.txt'],
];
for (const f of readdirSync(join(root, 'scenes')).filter((x) => x.endsWith('.json')).sort()) {
  copies.push([`scenes/${f}`, `site/assets/scenes/${f}`]);
}
for (const [from, to] of copies) {
  mkdirSync(dirname(join(root, to)), { recursive: true });
  copyFileSync(join(root, from), join(root, to));
}

// ---------- Point the compiled browser code at the self-hosted three.js ----------
const webDir = join(root, 'site/assets/js/web');
for (const f of readdirSync(webDir).filter((x) => x.endsWith('.js'))) {
  const file = join(webDir, f);
  const js = readFileSync(file, 'utf8');
  const fixed = js.replace(/from 'three';/g, "from '../../vendor/three.module.min.js';");
  if (fixed !== js) writeFileSync(file, fixed);
}

// ---------- Pages ----------
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "worker-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
const NAV = [
  ['index', 'index.html', 'Home'],
  ['explore', 'explore.html', 'Explore a site'],
  ['plan', 'plan.html', 'Plan treatments'],
  ['method', 'method.html', 'How it works'],
];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pagesDir = join(root, 'src/pages');
const built = [];
for (const file of readdirSync(pagesDir).filter((f) => f.endsWith('.html')).sort()) {
  const raw = readFileSync(join(pagesDir, file), 'utf8');
  const m = raw.match(/^<!--(\{[\s\S]*?\})-->\n/);
  if (!m) throw new Error(`${file}: missing the JSON header comment`);
  const meta = JSON.parse(m[1]);
  const body = raw.slice(m[0].length);
  const nav = NAV.map(([id, href, label]) => `<a href="${href}"${id === meta.nav ? ' aria-current="page"' : ''}>${label}</a>`).join('\n        ');
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${CSP}">
  <meta name="referrer" content="no-referrer">
  <title>${esc(meta.title)}</title>
  <meta name="description" content="${esc(meta.description)}">
  <link rel="icon" href="assets/icon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="assets/css/site.css">
  <script type="module" src="assets/js/${meta.script}"></script>
</head>
<body class="page-${meta.nav}">
  <a class="skip" href="#main">Skip to the content</a>
  <header class="top">
    <div class="top-inner">
      <a class="mark" href="index.html" aria-label="Clearflight home">
        <svg class="mark-icon" viewBox="0 0 32 32" aria-hidden="true"><rect x="17" y="4" width="11" height="24" rx="1.5"/><path d="M3 19c4-5 8-6 12-4l-3 3 5 1"/></svg>
        <span>Clearflight</span>
      </a>
      <nav class="nav" aria-label="Pages">
        ${nav}
      </nav>
    </div>
  </header>
  <main id="main">
${body.trimEnd()}
  </main>
  <footer class="foot">
    <div class="foot-inner">
      <p>Clearflight is open source (MIT). It runs entirely in your browser: no sign-in, no tracking, and scene files you load never leave your device.</p>
      <p><a href="https://github.com/reihooneh/clearflight">Source code and tests on GitHub</a></p>
    </div>
  </footer>
</body>
</html>
`;
  writeFileSync(join(root, 'site', file), html);
  built.push(file);
}
console.log(`Built ${built.length} pages (${built.join(', ')}) and copied ${copies.length} files.`);
