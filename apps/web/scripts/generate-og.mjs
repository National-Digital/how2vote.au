#!/usr/bin/env node
/**
 * Build-time OpenGraph image generator.
 *
 * Renders the shared 1200×630 social-preview cards from an inline SVG using sharp, so a shared
 * How2Vote link previews with a branded image on social and messaging platforms. One image per
 * election (`static/og-<id>.png`) plus the default `static/og.png` (the current election), each
 * labelled with the election it represents. The artwork uses only the two-tone brand palette (ink
 * on paper). The wordmark and the serif taglines are drawn from baked Newsreader paths
 * (src/lib/brand/mark.mjs, scripts/og-taglines.mjs) — librsvg ignores @font-face, so live text
 * would rasterise in a fontconfig fallback. Only the sans metadata lines use <text>, where the
 * system-ui stack is the design intent.
 *
 * The election list is read from the committed `data/dist/elections.json` so the images always
 * track the shipped datasets. Runs before `vite build` (see package.json "build"). Output is
 * gitignored — a deterministic build artifact regenerated from source, never hand-edited.
 */
import { readFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { WORDMARK, wordmarkDisplayMarkup } from "../src/lib/brand/mark.mjs";
import { TAGLINE_1, TAGLINE_2 } from "./og-taglines.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, ".."); // apps/web
const REPO = resolve(ROOT, "..", ".."); // repo root
const STATIC = join(ROOT, "static");

const PAPER = "#F6F4EE";
const INK = "#181611";
const WIDTH = 1200;
const HEIGHT = 630;

// XML-escape text baked into the SVG.
const esc = (s) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

// Wordmark row: scale so the *letters* keep an 88px box height; the display
// lockup's ghost [1]/[3] cells extend above and below that row.
const WM_SCALE = 88 / WORDMARK.height;
const WM_TOP = Number(WORDMARK.viewBox.split(" ")[1]); // box top, local units
const WM_BOX_Y = 110; // box top on the card; ghost cell clears the 40px border

function svgFor(meta) {
  // Current election reads as the live tool; past elections say so plainly.
  const sub = meta.current
    ? "Independent — scored on parties' real parliamentary votes."
    : `The ${meta.year} federal election, scored on the record as it stood then.`;
  // Election pill, right-aligned against the wordmark row.
  const pill = String(meta.year);
  const pillW = 150;
  const pillX = WIDTH - 96 - pillW;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <style>
    .ui{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;fill:${INK};}
  </style>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${PAPER}"/>
  <rect x="40" y="40" width="${WIDTH - 80}" height="${HEIGHT - 80}" rx="16" fill="none" stroke="${INK}" stroke-width="3"/>

  <!-- wordmark with its ballot column: baked brand paths, no font dependency -->
  <g transform="translate(96, ${WM_BOX_Y - WM_TOP * WM_SCALE}) scale(${WM_SCALE})">${wordmarkDisplayMarkup(INK)}</g>

  <!-- election pill -->
  <rect x="${pillX}" y="119" width="${pillW}" height="72" rx="36" fill="${INK}"/>
  <text x="${pillX + pillW / 2}" y="168" text-anchor="middle" class="ui" font-size="38" font-weight="700" style="fill:${PAPER}" letter-spacing="1">${esc(pill)}</text>

  <!-- taglines: baked Newsreader paths, 72px lines on the same baselines -->
  <path transform="translate(96 330)" fill="${INK}" d="${TAGLINE_1.d}"/>
  <path transform="translate(96 410)" fill="${INK}" d="${TAGLINE_2.d}"/>

  <!-- subline -->
  <text x="96" y="486" class="ui" font-size="30" fill-opacity="0.7">${esc(sub)}</text>

  <!-- footer -->
  <text x="96" y="560" class="ui" font-size="26" font-weight="600" letter-spacing="1.5">how2vote.au</text>
</svg>`;
}

async function render(meta, file) {
  const out = join(STATIC, file);
  await sharp(Buffer.from(svgFor(meta)))
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.info(`✓ OpenGraph image → static/${file} (${meta.id})`);
}

const elections = JSON.parse(await readFile(join(REPO, "data", "dist", "elections.json"), "utf8"));

await mkdir(STATIC, { recursive: true });
for (const meta of elections) {
  await render(meta, `og-${meta.id}.png`);
  if (meta.current) await render(meta, "og.png"); // default preview = current election
}
