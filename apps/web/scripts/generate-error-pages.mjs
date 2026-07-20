#!/usr/bin/env node
/**
 * Build-time generator for the static edge error page (static/500.html).
 *
 * WHY THIS EXISTS
 * The in-app branded error page (src/routes/+error.svelte) only renders when the SvelteKit app can
 * load. When Cloudflare's edge itself can't reach the origin — a true 5xx — no app loads, so the
 * browser would otherwise see an unbranded default page. This emits a fully self-contained HTML
 * page (no JS, no external CSS/fonts/images — everything inline) to serve in that case.
 *
 * WHY IT CAN NEVER DRIFT
 * The copy comes from the same shared module as the in-app page (src/lib/errors.js → errorInfo),
 * and the palette is extracted from the one design-token source (src/app.css :root). The file is
 * gitignored and regenerated on every build (package.json prebuild:assets), so it is impossible for
 * a hand-edit to leave it stale or for it to disagree with the live app's branding.
 *
 * The webfont is deliberately NOT referenced: on an origin-down 5xx the font files can't load
 * either, so the wordmark falls back to the system serif in --serif. The page must survive a dead
 * origin with zero network of its own.
 *
 * Wiring note (one-time, manual): Cloudflare Pages serves 404.html for not-found automatically, but
 * 5xx edge pages are configured at the account level. To use this asset, upload build/500.html as
 * the Custom Error page for 5xx in the Cloudflare dashboard (Account Home → … → Custom Pages). Until
 * then it is still reachable directly at /500.html and used by the offline e2e checks.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { errorInfo } from "../src/lib/errors.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const APP_CSS = join(ROOT, "src", "app.css");
const OUT = join(ROOT, "static", "500.html");

/**
 * Pull the design tokens straight from app.css so the static page shares the exact palette of the
 * live app. Returns the raw declaration bodies for the light `:root` and the dark-scheme `:root`.
 *
 * @param {string} css
 * @returns {{ light: string, dark: string }}
 */
export function extractTokens(css) {
  const light = css.match(/:root\s*\{([^}]*)\}/);
  const dark = css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/);
  if (!light) throw new Error("generate-error-pages: could not find :root tokens in app.css");
  return {
    light: light[1].trim(),
    dark: (dark ? dark[1] : light[1]).trim(),
  };
}

/**
 * Render a complete, standalone HTML document for the given error. No external references of any
 * kind — safe to serve when the origin is unreachable.
 *
 * @param {import("../src/lib/errors.js").ErrorInfo} info
 * @param {{ light: string, dark: string }} tokens
 * @returns {string}
 */
export function renderErrorPage(info, tokens) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${info.title} — how2vote</title>
    <style>
      /* Design tokens copied verbatim from src/app.css at build time (single source of truth). */
      :root { ${tokens.light} }
      @media (prefers-color-scheme: dark) { :root { ${tokens.dark} } }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100dvh;
        display: flex;
        flex-direction: column;
        background: var(--paper);
        color: var(--ink);
        font-family: var(--serif);
        font-size: 17px;
        line-height: 1.55;
        -webkit-font-smoothing: antialiased;
      }
      .sheet {
        width: 100%;
        max-width: var(--sheet);
        margin: 0 auto;
        flex: 1;
        display: flex;
        flex-direction: column;
        background: var(--raise);
      }
      @media (min-width: 720px) {
        .sheet { margin: 32px auto; min-height: auto; border: 1px solid var(--line);
          border-radius: 12px; box-shadow: 0 1px 0 var(--line); overflow: clip; }
      }
      .top { padding: 14px 18px 6px; }
      .logo { display: inline-flex; align-items: baseline; font-family: var(--serif);
        font-weight: 600; letter-spacing: -0.015em; line-height: 1; white-space: nowrap;
        font-size: 20px; }
      .logo .bx { display: inline-flex; align-items: center; justify-content: center;
        width: 0.98em; height: 0.98em; border: 0.065em solid currentColor; margin: 0 0.1em;
        transform: translateY(0.12em); font-style: italic; font-weight: 600; font-size: 0.92em; }
      .logo .bx i { font-style: italic; transform: rotate(-4deg) translateY(-0.02em); }
      .body { flex: 1; display: flex; flex-direction: column; justify-content: center;
        padding: 8px 18px 40px; }
      .code { font-family: var(--ui); font-size: 12px; font-weight: 600; letter-spacing: 0.13em;
        color: var(--ink3); margin: 0 0 8px; }
      h1 { font-family: var(--serif); font-weight: 600; font-size: clamp(27px, 7vw, 32px);
        line-height: 1.14; margin: 0; text-wrap: balance; }
      .lede { font-size: 15px; color: var(--ink2); margin: 14px 0 0; }
      .cta { margin-top: 28px; }
      .btn { display: flex; align-items: center; justify-content: center; width: 100%;
        min-height: 50px; border-radius: var(--radius); background: var(--ink);
        color: var(--on-fill); font-family: var(--ui); font-size: 15px; font-weight: 600;
        text-decoration: none; }
      a:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
    </style>
  </head>
  <body>
    <div class="sheet">
      <header class="top">
        <span class="logo" aria-label="how2vote">how<span class="bx"><i>2</i></span>vote</span>
      </header>
      <div class="body">
        <p class="code">${info.code}</p>
        <h1>${info.title}</h1>
        <p class="lede">${info.lede}</p>
        <div class="cta"><a class="btn" href="/">Back to how2vote</a></div>
      </div>
    </div>
  </body>
</html>
`;
}

// Run as a script (skipped when imported by the unit test).
if (import.meta.url === `file://${process.argv[1]}`) {
  const tokens = extractTokens(await readFile(APP_CSS, "utf8"));
  // The static asset stands in for a genuine edge/server failure, so it uses the 5xx wording.
  const html = renderErrorPage(errorInfo(500), tokens);
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, html, "utf8");
  console.info(`✓ Generated static edge error page → ${OUT}`);
}
