#!/usr/bin/env node
/**
 * Build-time brand icon generator.
 *
 * Composes every shipped icon from the baked brand marks (src/lib/brand/mark.mjs) —
 * the ballot-column [1]/[2]/[3] with the preference "2" dominant, in real Newsreader
 * outlines, so nothing here depends on platform fonts:
 *   - icon.svg (ink column on opaque paper, margin so iOS's rounded mask never
 *     clips it) → icon-192.png / icon-512.png, apple-touch-icon.png (180)
 *   - icon-maskable.svg (paper column on ink ground, sized for the 40%-radius mask
 *     safe circle) → icon-maskable-512.png
 *   - favicon.svg (the boxed 2 alone — ghost cells would be fuzz at tab size —
 *     near-full-bleed on paper; flips to chalk-on-slate via prefers-color-scheme)
 *     → favicon-32.png / favicon-16.png (light-scheme bake)
 *
 * Outputs land in static/ and are COMMITTED: the store shells build with `build:app`,
 * which runs no generator (their install skips sharp's binaries entirely), yet the
 * prerenderer requires every icon app.html links. Run `pnpm icons:generate` after
 * changing the brand mark and commit the result; never hand-edit the outputs.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { columnMarkup, markMarkup } from "../src/lib/brand/mark.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC = resolve(HERE, "..", "static");

const PAPER = "#F6F4EE";
const INK = "#181611";
const SLATE = "#151410"; // dark-scheme ground (design tokens)
const CHALK = "#EBE8DF"; // dark-scheme ink

// The column mark lives on a 64 grid; `scale` sizes it inside a 512 canvas, centred.
const icon512 = ({ ground, mark, scale }) => {
  const offset = (512 - 64 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${ground}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">${columnMarkup(mark)}</g>
</svg>
`;
};

// Favicon: the boxed-2 mark at half scale fills the 32 tab canvas edge-to-edge.
// The SVG adapts to dark browser chrome; the PNG fallbacks bake the light scheme.
const favicon = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <style>
    .g{fill:${PAPER}}
    @media (prefers-color-scheme: dark){.g{fill:${SLATE}}.m rect{stroke:${CHALK}}.m path{fill:${CHALK}}}
  </style>
  <rect class="g" width="32" height="32"/>
  <g class="m" transform="scale(0.5)">${markMarkup(INK)}</g>
</svg>
`;

const SVGS = {
  "icon.svg": icon512({ ground: PAPER, mark: INK, scale: 6 }),
  // Maskable safe zone is a centred circle of 40% radius (205px); the column's
  // half-diagonal at scale 5 (±160 tall, ±84 wide) is ~181px, safely inside.
  "icon-maskable.svg": icon512({ ground: INK, mark: PAPER, scale: 5 }),
  "favicon.svg": favicon(),
};

/** [source SVG, output PNG, size] */
const TARGETS = [
  ["icon.svg", "apple-touch-icon.png", 180],
  ["favicon.svg", "favicon-32.png", 32],
  ["favicon.svg", "favicon-16.png", 16],
  ["icon.svg", "icon-192.png", 192],
  ["icon.svg", "icon-512.png", 512],
  ["icon-maskable.svg", "icon-maskable-512.png", 512],
];

await mkdir(STATIC, { recursive: true });
for (const [name, svg] of Object.entries(SVGS)) {
  await writeFile(join(STATIC, name), svg);
}
for (const [src, out, size] of TARGETS) {
  await sharp(Buffer.from(SVGS[src]), { density: 384 })
    .resize(size, size, { fit: "contain" })
    .png({ compressionLevel: 9 })
    .toFile(join(STATIC, out));
}
console.info(
  `✓ Generated ${Object.keys(SVGS).length} SVG + ${TARGETS.length} PNG icons → ${STATIC}`,
);
