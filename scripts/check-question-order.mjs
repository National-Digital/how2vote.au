#!/usr/bin/env node
/**
 * @fileoverview Append-only question-order gate.
 *
 * Every share link is POSITIONAL: the fragment payload encodes answers by their INDEX in the
 * dataset's question order (packages/engine/src/share.ts + orderedQuestionIds). Reordering
 * questions.json therefore silently decodes every previously-shared link against the WRONG questions —
 * and it passes the schema, neutrality and deterministic-rebuild gates, because those only check the
 * rebuild is consistent with source, not that the order is stable across releases.
 *
 * This gate pins the canonical question-id order per election in data/question-order.json and fails
 * closed on any change that is NOT a pure append: existing ids must keep their exact positions
 * (withdrawn questions stay in place — they are inert but positionally load-bearing), and only new ids
 * may be added at the end. Same `--write` / check drift pattern as check-migration-registry.mjs.
 *
 * Usage:
 *   node scripts/check-question-order.mjs           # verify built order vs the committed lock (CI)
 *   node scripts/check-question-order.mjs --write    # regenerate the lock from data/dist (append only)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("..", import.meta.url);
const LOCK = new URL("data/question-order.json", root);
const LOCK_VERSION = 1;

/** Read the per-election question-id order from the built datasets in data/dist. */
export function builtOrders(readJson = defaultReadJson) {
  const elections = readJson("data/dist/elections.json");
  const orders = {};
  for (const e of elections) {
    const ds = readJson(`data/dist/${e.id}/dataset.json`);
    orders[e.id] = (ds.questions?.questions ?? []).map((q) => q.id);
  }
  return orders;
}

/**
 * Compare a committed lock against the built orders. Fail on any non-append change.
 * @param {{schemaVersion:number, orders:Record<string, number[]>}} lock
 * @param {Record<string, number[]>} built
 * @returns {{ok:boolean, errors:string[]}}
 */
export function verify(lock, built) {
  const errors = [];
  if (!lock || lock.schemaVersion !== LOCK_VERSION || typeof lock.orders !== "object") {
    return { ok: false, errors: ["question-order lock: missing or wrong schemaVersion"] };
  }
  for (const [id, lockedOrder] of Object.entries(lock.orders)) {
    const builtOrder = built[id];
    if (!builtOrder) {
      errors.push(`question-order: election "${id}" is locked but absent from the built datasets`);
      continue;
    }
    if (builtOrder.length < lockedOrder.length) {
      errors.push(
        `question-order: election "${id}" dropped questions (built ${builtOrder.length} < locked ${lockedOrder.length}) — order must be append-only`,
      );
      continue;
    }
    for (let i = 0; i < lockedOrder.length; i++) {
      if (builtOrder[i] !== lockedOrder[i]) {
        errors.push(
          `question-order: election "${id}" position ${i} changed (locked id ${lockedOrder[i]}, built id ${builtOrder[i]}) — reordering breaks every existing share link`,
        );
        break;
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/fs plumbing */
function defaultReadJson(rel) {
  return JSON.parse(readFileSync(new URL(rel, root), "utf8"));
}

function main() {
  const built = builtOrders();
  if (process.argv.includes("--write")) {
    const lock = {
      schemaVersion: LOCK_VERSION,
      note: "Append-only canonical question-id order per election; pins the positional share-link codec. Regenerate with --write, which only ever appends. Verified by scripts/check-question-order.mjs.",
      orders: built,
    };
    writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`);
    console.info(
      `question-order lock written → data/question-order.json (${Object.keys(built).length} election(s))`,
    );
    return;
  }
  let lock;
  try {
    lock = JSON.parse(readFileSync(LOCK, "utf8"));
  } catch (err) {
    console.error(`::error::question-order: cannot read lock: ${err.message} (run --write once)`);
    process.exit(1);
    return;
  }
  const result = verify(lock, built);
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::${e}`);
    console.error(`question-order gate: ${result.errors.length} problem(s)`);
    process.exit(1);
    return;
  }
  console.info(
    "question-order gate OK — every election's question order is append-only (share links stable)",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
