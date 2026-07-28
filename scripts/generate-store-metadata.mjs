#!/usr/bin/env node
/**
 * @fileoverview Store-listing metadata generator (fastlane deliver/supply layouts).
 *
 * The App Store and Google Play listings are treated like every other legal surface: generated
 * from the single operator record (apps/web/src/lib/operator.json) so the s 321D electoral
 * authorisation line and the operating entity are never hand-copied into store consoles — the
 * same single-source rule scripts/check-operator-identity.mjs enforces inside the app. The
 * output trees are gitignored build artefacts consumed by fastlane in the release workflows:
 *
 *   apps/mobile/fastlane/metadata/ios/en-AU/…       (deliver)
 *   apps/mobile/fastlane/metadata/android/en-AU/…   (supply)
 *
 * Every field is validated against the stores' hard length limits and the repo's brand rule (no
 * registration symbols/claims — see check-brand-trademark.mjs), and the description must carry
 * the authorisation line. Pure logic is exported (buildMetadata / validateMetadata) for unit
 * tests; fs/CLI plumbing runs only when executed directly.
 *
 * Usage:
 *   node scripts/generate-store-metadata.mjs           # generate both trees
 *   node scripts/generate-store-metadata.mjs --check   # validate only (CI), writes nothing
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OPERATOR_REL = "apps/web/src/lib/operator.json";
// Shared product copy — the SAME file the web app reads, so store listings cannot drift from the
// site (a unit test asserts every claim string appears in the built descriptions).
const COPY_REL = "apps/web/src/lib/product-copy.json";
const OUT_REL = "apps/mobile/fastlane/metadata";
const LOCALE = "en-AU";

/** Store hard limits (characters). Apple: name/subtitle 30, promo 170, description 4000,
 * keywords 100. Play: title 30, short 80, full 4000. */
const LIMITS = {
  "ios/name.txt": 30,
  "ios/subtitle.txt": 30,
  "ios/promotional_text.txt": 170,
  "ios/description.txt": 4000,
  "ios/keywords.txt": 100,
  "ios/release_notes.txt": 4000,
  "android/title.txt": 30,
  "android/short_description.txt": 80,
  "android/full_description.txt": 4000,
  "android/changelogs/default.txt": 500,
};

// De-literalised mark symbols (same convention as check-brand-trademark.mjs) so this generator's
// own source never trips that guard: circled-R (U+00AE), circled-TM (U+2122), or the uppercase
// parenthesised tokens.
const FORBIDDEN_MARKS = new RegExp("\u00AE|\u2122|" + "\\(TM\\)|\\(R\\)");

// iOS metadata files fastlane deliver reads from the metadata ROOT (not the <locale>/ dir):
// copyright is a non-localised version value; review information is app-level.
const NON_LOCALISED = new Set(["ios/copyright.txt", "ios/review_information/notes.txt"]);

/** The s 321D authorisation line, composed EXACTLY as apps/web/src/lib/org.ts composes it. */
export function authorisationLine(operator) {
  const { legalName, authorisation } = operator;
  return `Authorised by ${legalName}, ${authorisation.locality}, ${authorisation.state}.`;
}

/**
 * Builds every metadata file for both stores as a flat map of `store-relative path → content`.
 * Locale directories are added by the writer. Content is deliberately identical across stores
 * wherever both accept it, so the listings can never drift apart.
 */
export function buildMetadata(operator, copy) {
  const authorisation = authorisationLine(operator);
  const c = copy.claims;
  // Composed ENTIRELY from the shared product-copy source, so the listing tracks the web app.
  const description = `${copy.pitch}

${copy.howItWorks}

${c.offline.heading}
${c.offline.body}

${c.record.heading}
${c.record.body}

${c.private.heading}
${c.private.body}

${c.neutral.heading}
${c.neutral.body} ${copy.repoUrl}

${authorisation}`;

  const releaseNotes = `Updated with the latest compiled parliamentary voting-record dataset and app improvements. Full changelog: ${copy.repoUrl}/releases`;

  const reviewNotes = `How2Vote is a non-partisan voter-information tool for Australian federal elections, operated by ${operator.tradingName} (${operator.legalName}).

Key points for review:
- All comparison content derives from public parliamentary voting records (Hansard, via theyvoteforyou.org.au). The compilation method is public and deterministic: ${copy.repoUrl}
- The app recommends no party and no preference order; results are shown in official ballot order and users author their own voting plan.
- The dataset ships in the binary and the app works offline. There is no account and no login. The only data that leaves the device is the optional, opt-in aggregate research contribution and whatever the user types into the contact/feedback form.
- The description carries the electoral authorisation statement required by Australian law (Commonwealth Electoral Act 1918 s 321D).
- Contact: ${operator.email}`;

  const title = "How2Vote";

  return {
    // deliver layout (fastlane/metadata/ios/<locale>/…)
    "ios/name.txt": title,
    "ios/subtitle.txt": copy.subtitle,
    "ios/promotional_text.txt": copy.promoText,
    "ios/description.txt": description,
    "ios/keywords.txt":
      "election,vote,australia,ballot,parliament,senate,how to vote,federal,civic",
    "ios/release_notes.txt": releaseNotes,
    "ios/support_url.txt": "https://how2vote.au/contact",
    "ios/marketing_url.txt": "https://how2vote.au",
    "ios/privacy_url.txt": "https://how2vote.au/privacy",
    // Copyright year is the build year, injected deterministically (BUILD_YEAR env from the release
    // workflow), NOT the wall clock — a re-run must reproduce the same listing byte-for-byte.
    "ios/copyright.txt": `${process.env.BUILD_YEAR ?? "2026"} ${operator.legalName}`,
    "ios/review_information/notes.txt": reviewNotes,
    // supply layout (fastlane/metadata/android/<locale>/…)
    "android/title.txt": title,
    "android/short_description.txt": copy.shortDescriptionAndroid,
    "android/full_description.txt": description,
    "android/changelogs/default.txt": releaseNotes,
  };
}

/** Validates limits, brand rules, the authorisation invariant, and no-drift from shared copy. */
export function validateMetadata(files, operator, copy) {
  const issues = [];
  for (const [path, content] of Object.entries(files)) {
    const limit = LIMITS[path];
    if (limit && content.length > limit) {
      issues.push(`${path}: ${content.length} chars exceeds the ${limit}-char store limit`);
    }
    if (FORBIDDEN_MARKS.test(content)) {
      issues.push(`${path}: contains a registration mark symbol/token (brand rule)`);
    }
    if (!content.trim()) issues.push(`${path}: empty`);
  }
  const auth = authorisationLine(operator);
  for (const path of ["ios/description.txt", "android/full_description.txt"]) {
    if (!files[path]?.includes(auth)) {
      issues.push(`${path}: missing the s 321D authorisation line`);
    }
  }
  // No-drift: every shared claim body must appear verbatim in both store descriptions, so a copy
  // edit moves the web app and both listings together.
  if (copy) {
    for (const [key, claim] of Object.entries(copy.claims)) {
      for (const path of ["ios/description.txt", "android/full_description.txt"]) {
        if (!files[path]?.includes(claim.body)) {
          issues.push(`${path}: missing shared product-copy claim "${key}"`);
        }
      }
    }
  }
  return issues;
}

function main() {
  const check = process.argv.includes("--check");
  const operator = JSON.parse(readFileSync(join(ROOT, OPERATOR_REL), "utf8"));
  const copy = JSON.parse(readFileSync(join(ROOT, COPY_REL), "utf8"));
  const files = buildMetadata(operator, copy);
  const issues = validateMetadata(files, operator, copy);
  if (issues.length > 0) {
    console.error("✗ store metadata invalid:");
    for (const issue of issues) console.error(`  - ${issue}`);
    process.exit(1);
  }
  if (check) {
    console.info(`✓ store metadata valid (${Object.keys(files).length} files, checked only)`);
    return;
  }
  for (const [path, content] of Object.entries(files)) {
    const [store, ...rest] = path.split("/");
    // fastlane deliver reads a handful of iOS fields from the metadata ROOT, not the locale dir
    // (copyright is a non-localised version value; review_information is app-level). Everything
    // else is per-locale. Writing these under en-AU/ would silently drop them at upload.
    const key = rest.join("/");
    const target = NON_LOCALISED.has(`${store}/${key}`)
      ? join(ROOT, OUT_REL, store, ...rest)
      : join(ROOT, OUT_REL, store, LOCALE, ...rest);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${content}\n`);
  }
  console.info(`✓ Generated ${Object.keys(files).length} store metadata files → ${OUT_REL}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
