#!/usr/bin/env node
/**
 * Neutrality lint. The voting tool is strictly two-tone — no hue anywhere — so that
 * match quality can never be read as party allegiance. This scans the BUILT CSS for any colour value
 * outside the approved monochrome palette and fails the build if it finds one. Run after `build`.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const BUILD_DIR = "build";

// The only colour values permitted anywhere in the product's CSS.
const ALLOWED_HEX = new Set([
  "f6f4ee",
  "fbfaf7",
  "181611",
  "151410",
  "1c1b16",
  "ebe8df",
  "fff",
  "ffffff",
  "000",
  "000000",
]);
// Approved rgb triples (any alpha): the ink and the chalk.
const ALLOWED_RGB = new Set(["24,22,17", "235,232,223", "255,255,255", "0,0,0"]);
const ALLOWED_KEYWORDS = new Set([
  "transparent",
  "currentcolor",
  "inherit",
  "initial",
  "unset",
  "none",
  "canvas",
  "canvastext",
  "graytext",
]);

async function* cssFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* cssFiles(path);
    else if (entry.name.endsWith(".css")) yield path;
  }
}

const violations = [];

function check(file, css) {
  // Hex colours. Strip any alpha channel first (#rgba → #rgb, #rrggbbaa → #rrggbb); as with
  // rgb(), alpha is permitted on the approved tones. Modern CSS minifiers emit alpha'd colours
  // in 8-digit hex form rather than rgba().
  for (const m of css.matchAll(/#([0-9a-fA-F]{3,8})\b/g)) {
    const hex = m[1].toLowerCase();
    const rgb = hex.length === 4 ? hex.slice(0, 3) : hex.length === 8 ? hex.slice(0, 6) : hex;
    if (!ALLOWED_HEX.has(rgb)) violations.push({ file, value: m[0] });
  }
  // rgb()/rgba().
  for (const m of css.matchAll(/rgba?\(([^)]+)\)/gi)) {
    const nums = m[1]
      .split(/[,/\s]+/)
      .filter(Boolean)
      .slice(0, 3)
      .join(",");
    if (!ALLOWED_RGB.has(nums)) violations.push({ file, value: m[0] });
  }
  // hsl()/hwb()/lab()/lch()/oklch()/color() — hue-bearing colour spaces are never allowed.
  for (const m of css.matchAll(/\b(hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi)) {
    violations.push({ file, value: `${m[1]}(…)` });
  }
  // Named colours (a small blocklist of common hue names likely to slip in).
  for (const m of css.matchAll(
    /\b(red|green|blue|gold|yellow|orange|purple|teal|navy|maroon|olive|lime|aqua|fuchsia|silver|gray|grey)\b(?!-)/gi,
  )) {
    if (!ALLOWED_KEYWORDS.has(m[1].toLowerCase())) violations.push({ file, value: m[1] });
  }
}

let count = 0;
try {
  for await (const file of cssFiles(BUILD_DIR)) {
    check(file, await readFile(file, "utf8"));
    count++;
  }
} catch {
  console.error(`Neutrality check: no build output at ./${BUILD_DIR} — run the build first.`);
  process.exit(1);
}

if (violations.length > 0) {
  console.error(`✗ Neutrality check failed — ${violations.length} non-monochrome colour value(s):`);
  for (const v of violations.slice(0, 40)) console.error(`    ${v.value}   (${v.file})`);
  process.exit(1);
}
console.info(`✓ Neutrality check passed — ${count} CSS file(s), palette is strictly two-tone.`);
