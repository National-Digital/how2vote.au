/**
 * What each election's compiled dataset holds as a ballot, read from data/dist/<id>/dataset.json:
 *
 * - `none`        — no electorates (a `pending` ballot, ADR 0013).
 * - `provisional` — candidates listed in a neutral order before the AEC draw (ADR 0013 D2).
 * - `drawn`       — the official ballot order (an omitted `ballotStatus` is `drawn`).
 *
 * The web build bakes this map in (`__BALLOTS__`, apps/web/vite.config.ts) so a page can word an
 * election's stage without loading its dataset; the store-metadata generator reads it the same way.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** @param {{ballotStatus?: string, electorates: unknown[]}} ballots */
export function ballotOf(ballots) {
  if (ballots.electorates.length === 0) return "none";
  return (ballots.ballotStatus ?? "drawn") === "provisional" ? "provisional" : "drawn";
}

/**
 * @param {string} distDir - the data/dist directory
 * @returns {Record<string, "none" | "provisional" | "drawn">}
 */
export function ballotStates(distDir) {
  /** @type {Record<string, "none" | "provisional" | "drawn">} */
  const out = {};
  for (const id of readdirSync(distDir)) {
    const file = join(distDir, id, "dataset.json");
    if (existsSync(file)) out[id] = ballotOf(JSON.parse(readFileSync(file, "utf8")).ballots);
  }
  return out;
}
