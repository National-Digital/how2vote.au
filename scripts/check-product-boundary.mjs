#!/usr/bin/env node
/**
 * @fileoverview CI guard: the machine-readable PRODUCT BOUNDARY (data/legal/product-boundary.json) is
 * well-formed, current, internally consistent, and — critically — AGREES with the signed runtime
 * control plane.
 *
 * The boundary is the externally-determined legal state recommended by electoral-law review: which
 * capabilities this build is permitted to expose, and which legal determinations are still pending. It is declarative; the runtime enforcement lives in the control plane
 * (data/governance/control-plane.json) and in the code. This guard is the tripwire that keeps the two
 * from drifting: if the boundary claims `printMode: "disabled"` while the control plane does NOT carry
 * an active global `printing` suspension, the build FAILS — a declared boundary that is not actually
 * enforced would be worse than none.
 *
 * FAIL CLOSED: an expired/undated boundary, an unknown enum, a determination asserting a non-pending
 * status without a reviewer + date, or a boundary/control-plane disagreement all fail the build.
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/CLI plumbing runs only when
 * executed directly.
 *
 * Usage:
 *   node scripts/check-product-boundary.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PRINT_MODES = ["disabled", "nd-authoriser", "user-authoriser"];
const SCORE_PLACEMENTS = ["party-panel-only", "candidate-row"];
const DETERMINATION_STATUSES = ["pending", "determined", "not-applicable"];

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
/** @param {unknown} v — strict ISO date/datetime (mirrors the other guards). */
const isIsoDate = (v) =>
  isNonEmptyString(v) &&
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) &&
  !Number.isNaN(Date.parse(v));

/** Active (not-lifted) global suspension of a given scope in a control plane. */
const hasActiveGlobalSuspension = (plane, scope) =>
  Array.isArray(plane?.suspensions) &&
  plane.suspensions.some((s) => s && s.scope === scope && !s.liftedAt && !s.electionId);

/**
 * Pure decision logic.
 * @param {{ boundary: unknown, controlPlane: unknown, now?: number }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(input) {
  const errors = [];
  const push = (m) => errors.push(m);
  const { boundary: b, controlPlane: plane } = input;
  const now = input.now ?? Date.parse("1970-01-01"); // callers pass a real clock; tests pin it

  if (typeof b !== "object" || b === null || Array.isArray(b)) {
    return { ok: false, errors: ["product-boundary: not a JSON object"] };
  }
  if (b.schemaVersion !== 1) push("product-boundary: schemaVersion must be 1");

  // Freshness — an undated or expired boundary fails closed (a lapsed legal state must not ship).
  if (!isIsoDate(b.effectiveFrom)) push("product-boundary: effectiveFrom must be an ISO date");
  if (!isIsoDate(b.expiresAt)) {
    push("product-boundary: expiresAt must be an ISO date");
  } else if (Date.parse(b.expiresAt) < now) {
    push(
      `product-boundary: boundary expired on ${b.expiresAt} — refresh the legal determination before deploy`,
    );
  }
  for (const k of ["lawVersion", "opinionRef", "approvedBy"]) {
    if (!isNonEmptyString(b[k])) push(`product-boundary: missing ${k}`);
  }

  // Boundary flags.
  const bd = b.boundary;
  if (typeof bd !== "object" || bd === null || Array.isArray(bd)) {
    push("product-boundary: `boundary` must be an object");
  } else {
    if (!PRINT_MODES.includes(bd.printMode)) {
      push(`product-boundary: boundary.printMode must be one of ${PRINT_MODES.join(", ")}`);
    }
    if (!SCORE_PLACEMENTS.includes(bd.candidateScorePlacement)) {
      push(
        `product-boundary: boundary.candidateScorePlacement must be one of ${SCORE_PLACEMENTS.join(", ")}`,
      );
    }
    for (const k of [
      "printExportEnabled",
      "preferencePlanOnScreenEnabled",
      "researchEnabled",
      "liveElectionEnabled",
      "archivePrintEnabled",
    ]) {
      if (typeof bd[k] !== "boolean") push(`product-boundary: boundary.${k} must be a boolean`);
    }

    // Consistency with the runtime control plane — the declared boundary must actually be enforced.
    if (typeof plane === "object" && plane !== null) {
      const printSuspended = hasActiveGlobalSuspension(plane, "printing");
      const researchSuspended = hasActiveGlobalSuspension(plane, "research");
      if (bd.printMode === "disabled" && !printSuspended) {
        push(
          'product-boundary: printMode is "disabled" but the control plane has no active global `printing` suspension — the boundary is not enforced',
        );
      }
      if (bd.printExportEnabled === false && !printSuspended) {
        push(
          "product-boundary: printExportEnabled is false but printing is not suspended in the control plane",
        );
      }
      if (bd.researchEnabled === false && !researchSuspended) {
        push(
          "product-boundary: researchEnabled is false but the control plane has no active global `research` suspension — the boundary is not enforced",
        );
      }
    } else {
      push(
        "product-boundary: control plane is unreadable — cannot verify the boundary is enforced",
      );
    }

    // The only currently-approved score placement is the party panel (the deep review requires party-
    // derived scores not sit against individual candidates). Flag any relaxation for explicit review.
    if (bd.candidateScorePlacement !== "party-panel-only") {
      push(
        'product-boundary: candidateScorePlacement must be "party-panel-only" until a revised party-level visual design and correction process is signed off',
      );
    }
  }

  // Determinations.
  const dets = b.determinations;
  if (typeof dets !== "object" || dets === null || Array.isArray(dets)) {
    push("product-boundary: `determinations` must be an object");
  } else {
    for (const [key, d] of Object.entries(dets)) {
      const at = `determinations.${key}`;
      if (typeof d !== "object" || d === null) {
        push(`product-boundary: ${at} must be an object`);
        continue;
      }
      if (!DETERMINATION_STATUSES.includes(d.status)) {
        push(`product-boundary: ${at}.status must be one of ${DETERMINATION_STATUSES.join(", ")}`);
      }
      if (!isNonEmptyString(d.evidenceRef)) push(`product-boundary: ${at} missing evidenceRef`);
      if (!isNonEmptyString(d.basis)) push(`product-boundary: ${at} missing basis`);
      // A non-pending determination must carry a TWO-PERSON sign-off and a date (fail closed: a
      // claimed determination with no two named reviewers / no date / no text is treated as not made).
      if (d.status === "determined") {
        if (!isNonEmptyString(d.reviewer))
          push(`product-boundary: ${at} determined but missing reviewer`);
        if (!isNonEmptyString(d.secondReviewer)) {
          push(
            `product-boundary: ${at} determined but missing secondReviewer (two-person sign-off)`,
          );
        } else if (d.reviewer === d.secondReviewer) {
          push(`product-boundary: ${at} reviewer and secondReviewer must be two distinct people`);
        }
        if (!isIsoDate(d.determinationDate)) {
          push(`product-boundary: ${at} determined but determinationDate is not an ISO date`);
        }
        if (!isNonEmptyString(d.determination)) {
          push(`product-boundary: ${at} determined but has no determination text`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
function main() {
  const root = new URL("../", import.meta.url);
  let boundary;
  let controlPlane;
  try {
    boundary = JSON.parse(readFileSync(new URL("data/legal/product-boundary.json", root), "utf8"));
    controlPlane = JSON.parse(
      readFileSync(new URL("data/governance/control-plane.json", root), "utf8"),
    );
  } catch (err) {
    console.error(`::error::product-boundary: cannot read a record: ${err.message}`);
    process.exit(1);
    return;
  }
  const result = verdict({ boundary, controlPlane, now: Date.now() });
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::product-boundary: ${e}`);
    console.error(`product boundary: ${result.errors.length} problem(s)`);
    process.exit(1);
    return;
  }
  const pending = Object.values(boundary.determinations ?? {}).filter(
    (d) => d && d.status === "pending",
  ).length;
  console.info(
    `product boundary OK — printMode=${boundary.boundary.printMode}, research=${boundary.boundary.researchEnabled}, scores=${boundary.boundary.candidateScorePlacement}, ${pending} determination(s) pending`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
