# Security policy

Clearflight is a static website: HTML, CSS and JavaScript served from GitHub Pages, with the model running in the visitor's own browser. There is no server-side code, no database, no accounts and no cookies. No software is perfectly secure, so this page sets out what an attacker could try, how the project defends against each attempt, and how to report a problem.

## Threat model

| What an attacker could try | How Clearflight defends |
|---|---|
| **A crafted scene file** with script or HTML in a building name, hoping it ends up in the page (XSS) | Names must match a strict pattern (letters, digits, spaces and `' . , & ( ) -`). All text goes into the page with `textContent` or `createTextNode`, never `innerHTML`; a test greps the built code for `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval` and `new Function`. A strict Content-Security-Policy (`default-src 'none'; script-src 'self'`, no `unsafe-inline`) blocks inline scripts even if markup were injected. |
| **Prototype pollution** through `"__proto__"` or `"constructor"` keys in JSON | The file is parsed with `JSON.parse` (never evaluated), then checked against a list of allowed keys for every object; any other key is refused. The checked scene is rebuilt from scratch rather than reused. A browser test loads such a file and checks nothing was polluted. |
| **Resource exhaustion**: a huge file, thousands of buildings, a facade with millions of panes, or a budget that makes the planner's tables enormous | Files over 256 KB are refused before they're read. Scenes are limited to 12 buildings, 300 trees, 30 floors, 8,000 panes and 100,000 flights. The planner's tables are capped at $200,000 in $50 steps. The engine runs in a Web Worker, so even a slow scene can't freeze the page. |
| **Hidden characters** (right-to-left overrides, zero-width or control characters) to disguise a name | Control (`Cc`) and invisible formatting (`Cf`) characters are refused in names. |
| **Spreadsheet formula injection** through the downloaded work order | Every CSV cell is quoted, and any cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with `'`. |
| **Loading something from elsewhere** (a tracker, a tampered CDN script) | Everything is self-hosted, including three.js and the fonts, which come from pinned npm versions. The CSP allows only the site's own origin, and a test fails if a page links anything outside the site (apart from the GitHub repository). No analytics, no third-party requests, `referrer: no-referrer`. |
| **Path traversal** against the local preview server | `scripts/serve.mjs` resolves paths inside `site/` only, serves a fixed list of file types, and sends `nosniff`. A test requests `../`-style paths and expects them to be refused. It's a development tool and is never deployed. |
| **A compromised build dependency** | Dependencies are few, pinned in `package-lock.json`, installed with `npm ci`, and checked with `npm audit` in CI. CI rebuilds the site and fails if it doesn't match the committed copy, so the published files are exactly what the sources produce. The workflow runs with read-only permissions, except for the deploy job's Pages permissions. |

## What it doesn't protect against

- Someone who controls your browser or device can change what the page shows.
- The model's numbers are estimates. Don't treat them as a safety certification for a building; bird-friendly design standards (such as CSA A460) and local experts come first.

## Reporting a problem

Please open a private security advisory on the repository (**Security → Report a vulnerability**) or an issue without exploit details, and I'll respond as soon as I can. Include the page, the steps or the scene file that shows the problem, and what you expected to happen.
