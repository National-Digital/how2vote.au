#!/usr/bin/env node
/**
 * Native store-asset source generator.
 *
 * Renders the SAME baked brand marks the web icons use (apps/web/src/lib/brand/mark.mjs — the
 * ballot-column [1]/[2]/[3] with the preference "2" dominant) into the source PNGs that
 * `@capacitor/assets generate` consumes (see package.json assets:generate), which in turn
 * populates the committed iOS asset catalog and Android mipmap/drawable resources:
 *
 *   - icon-only.png (1024, opaque paper ground — Apple requires no alpha, no rounded corners)
 *   - icon-foreground.png / icon-background.png (1024, Android adaptive icon layers; the mark
 *     sits inside the ~66% safe zone so launcher masks never clip it)
 *   - splash.png / splash-dark.png (2732², centred mark on paper / slate, matching the app's
 *     two-tone light and dark schemes)
 *
 * Outputs land in assets/ (gitignored intermediates, deterministic, never hand-edited).
 */
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { columnMarkup } from "../../web/src/lib/brand/mark.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "assets");

// Brand palette (design tokens; identical to apps/web/scripts/generate-icons.mjs).
const PAPER = "#F6F4EE";
const INK = "#181611";
const SLATE = "#151410";
const CHALK = "#EBE8DF";

/** The column mark lives on a 64 grid; centre it at `scale` inside a square `canvas`.
 *  `scale: 0` (or a null mark) yields a flat ground with no mark — the adaptive background layer. */
const square = ({ canvas, ground, mark, scale }) => {
  const offset = (canvas - 64 * scale) / 2;
  const rect =
    ground === "transparent" ? "" : `<rect width="${canvas}" height="${canvas}" fill="${ground}"/>`;
  const glyph =
    mark && scale > 0
      ? `<g transform="translate(${offset} ${offset}) scale(${scale})">${columnMarkup(mark)}</g>`
      : "";
  // Explicit width/height so the rasteriser's output size is deterministic and independent of its
  // default DPI (the resize below then supersamples down for clean edges).
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}">
  ${rect}
  ${glyph}
</svg>
`;
};

/** [filename, svg, size] */
const TARGETS = [
  // App Store icon proportions match the web icon (mark at 75% of canvas).
  ["icon-only.png", square({ canvas: 1024, ground: PAPER, mark: INK, scale: 12 }), 1024],
  // Adaptive layers: foreground inside the 66% safe zone; background is the flat ground (no mark).
  [
    "icon-foreground.png",
    square({ canvas: 1024, ground: "transparent", mark: INK, scale: 10 }),
    1024,
  ],
  ["icon-background.png", square({ canvas: 1024, ground: PAPER, mark: null, scale: 0 }), 1024],
  // Splash: a quiet centred mark, light and dark schemes.
  ["splash.png", square({ canvas: 2732, ground: PAPER, mark: INK, scale: 12 }), 2732],
  ["splash-dark.png", square({ canvas: 2732, ground: SLATE, mark: CHALK, scale: 12 }), 2732],
];

// Google Play requires a 1024×500 feature graphic (landscape banner). Rendered from the same brand
// mark on the paper ground into the COMMITTED screenshots tree (the release workflow copies it into
// supply's images path; metadata/ itself is generated + gitignored).
const FEATURE_DIR = resolve(HERE, "..", "fastlane", "screenshots", "android-feature");
const featureSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500">
  <rect width="1024" height="500" fill="${PAPER}"/>
  <g transform="translate(462 122) scale(4)">${columnMarkup(INK)}</g>
</svg>
`;

await mkdir(OUT, { recursive: true });
for (const [name, svg, size] of TARGETS) {
  // 2x supersample then downscale for clean edges. Explicit width/height on the SVG keeps the
  // pre-resize raster at ~2x the target (well under sharp's input-pixel limit even for 2732²).
  await sharp(Buffer.from(svg), { density: 192 })
    .resize(size, size, { fit: "contain" })
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, name));
}
console.info(`✓ Generated ${TARGETS.length} native asset sources → ${OUT}`);

await mkdir(FEATURE_DIR, { recursive: true });
await sharp(Buffer.from(featureSvg), { density: 192 })
  .resize(1024, 500, { fit: "contain" })
  .png({ compressionLevel: 9 })
  .toFile(join(FEATURE_DIR, "feature.png"));
console.info(`✓ Generated Play feature graphic (1024×500) → ${FEATURE_DIR}`);
