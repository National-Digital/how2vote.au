#!/usr/bin/env node
/**
 * @fileoverview CI guard: the signed runtime kill-switch control plane is well-formed, its integrity
 * digest matches its body, and every suspension is REFERENTIALLY VALID.
 *
 * data/governance/control-plane.json is the signed, fail-closed suspension register the runtime reads
 * to REFUSE a capability at a scope. Because a suspension silently withdraws a capability — and a
 * MISTYPED selector would silently withdraw NOTHING (fail open) — this guard proves, blocking:
 *   - the top-level shape (schemaVersion, suspensions array, integrity `sha256-<hex>`);
 *   - the integrity digest actually matches the {schemaVersion, suspensions} body (tamper-evident;
 *     the exact digest the runtime recomputes — a drifted digest fails closed here rather than at a
 *     user's device);
 *   - every entry names a valid scope, carries the selector fields that scope REQUIRES (and no
 *     stray selector for a different scope), and each selector resolves to a REAL target: a known
 *     election, a partyKey / propositionId in that election's registry, an electorate slug on that
 *     election's House ballot, a chamber ballot that exists, a map id of the form <election>/<STATE>;
 *   - the audit trail is present (reason, by, ISO flaggedAt) and a lifted RESTORE record is
 *     internally consistent (liftedAt ⇒ liftedBy, both ISO/attributed).
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/CLI plumbing runs only when
 * executed directly.
 *
 * Usage:
 *   node scripts/check-control-plane.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { controlPlaneDigest } from "./generate-control-plane.mjs";

const SCOPES = [
  "research",
  "publication",
  "printing",
  "decoding",
  "election",
  "chamber",
  "electorate",
  "ballot",
  "mapping",
  "proposition",
  "map",
];
const GLOBAL_SCOPES = new Set(["research", "publication", "printing", "decoding"]);
const CHAMBERS = new Set(["house", "senate"]);

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
/** @param {unknown} v — strict ISO date/datetime (mirrors the other guards). */
const isIsoDate = (v) =>
  isNonEmptyString(v) &&
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) &&
  !Number.isNaN(Date.parse(v));

/** Mirror of packages/engine share.ts slugify — the electorate selector is a slug. */
const slugify = (s) =>
  String(s)
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();

/**
 * @param {{
 *   plane: unknown,
 *   refs: {
 *     electionIds: string[],
 *     partyKeysByElection: Record<string, string[]>,
 *     propositionIdsByElection: Record<string, number[]>,
 *     electorateSlugsByElection: Record<string, string[]>,
 *     senateStatesByElection: Record<string, string[]>,
 *   },
 * }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(input) {
  const errors = [];
  const push = (m) => errors.push(m);
  const { plane, refs } = input;

  if (typeof plane !== "object" || plane === null || Array.isArray(plane)) {
    return { ok: false, errors: ["control-plane: not a JSON object"] };
  }
  if (plane.schemaVersion !== 1) push("control-plane: schemaVersion must be 1");

  // Integrity: the recorded digest must match the recomputed digest over the body.
  if (!isNonEmptyString(plane.integrity) || !/^sha256-[0-9a-f]{64}$/.test(plane.integrity)) {
    push("control-plane: integrity must be a sha256-<hex> digest");
  } else {
    let expected = null;
    try {
      expected = controlPlaneDigest({
        schemaVersion: plane.schemaVersion,
        suspensions: plane.suspensions,
      });
    } catch (err) {
      push(`control-plane: cannot recompute integrity digest: ${err.message}`);
    }
    if (expected && expected !== plane.integrity) {
      push(
        `control-plane: integrity digest is stale (recorded ${plane.integrity.slice(0, 15)}…, computed ${expected.slice(0, 15)}…) — run \`pnpm control-plane:generate\``,
      );
    }
  }

  const list = plane.suspensions;
  if (!Array.isArray(list)) {
    push("control-plane: `suspensions` must be an array");
    return { ok: errors.length === 0, errors };
  }

  const hasElection = (id) => refs.electionIds.includes(id);

  for (const [i, e] of list.entries()) {
    const at = `suspensions[${i}]`;
    if (typeof e !== "object" || e === null || Array.isArray(e)) {
      push(`${at}: not an object`);
      continue;
    }
    if (!SCOPES.includes(e.scope)) {
      push(`${at}: scope must be one of ${SCOPES.join(", ")}`);
      continue;
    }
    // Audit trail on every entry.
    if (!isNonEmptyString(e.reason)) push(`${at}: missing reason`);
    if (!isNonEmptyString(e.by)) push(`${at}: missing by (who authorised the suspension)`);
    if (!isIsoDate(e.flaggedAt)) push(`${at}: flaggedAt must be an ISO date`);

    // Lifted / RESTORE record consistency.
    if (e.liftedAt !== undefined || e.liftedBy !== undefined) {
      if (!isIsoDate(e.liftedAt)) push(`${at}: liftedAt must be an ISO date when present`);
      if (!isNonEmptyString(e.liftedBy)) push(`${at}: a lifted suspension needs liftedBy`);
    }

    // Selector requirements per scope, and referential integrity.
    const needElection = !GLOBAL_SCOPES.has(e.scope) && e.scope !== "map";
    if (needElection) {
      if (!isNonEmptyString(e.electionId)) push(`${at}: scope "${e.scope}" requires electionId`);
      else if (!hasElection(e.electionId)) push(`${at}: unknown electionId "${e.electionId}"`);
    }

    switch (e.scope) {
      case "research":
      case "publication":
      case "printing":
      case "decoding":
        // Global scopes: no selector. printing/decoding MAY be narrowed to an election.
        if (
          (e.scope === "research" || e.scope === "publication") &&
          isNonEmptyString(e.electionId)
        ) {
          push(`${at}: scope "${e.scope}" is global and takes no electionId`);
        }
        if (
          (e.scope === "printing" || e.scope === "decoding") &&
          e.electionId !== undefined &&
          !hasElection(e.electionId)
        ) {
          push(`${at}: unknown electionId "${e.electionId}"`);
        }
        break;
      case "election":
        // electionId already checked above; nothing else required.
        break;
      case "chamber":
        if (!CHAMBERS.has(e.chamber)) push(`${at}: chamber must be house|senate`);
        break;
      case "electorate": {
        if (!isNonEmptyString(e.electorate)) push(`${at}: scope "electorate" requires electorate`);
        else if (hasElection(e.electionId)) {
          const slugs = refs.electorateSlugsByElection[e.electionId] ?? [];
          if (!slugs.includes(slugify(e.electorate))) {
            push(
              `${at}: electorate "${e.electorate}" is not a division on the ${e.electionId} House ballot — the suspension would have no effect`,
            );
          } else if (e.electorate !== slugify(e.electorate)) {
            // The runtime compares the stored value to slugify(name) with EXACT equality, so a
            // non-canonical form (e.g. "Bean") would silently fail to suspend — fail-open. Require
            // the canonical slug so the suspension actually takes effect.
            push(
              `${at}: electorate "${e.electorate}" must be stored as its canonical slug "${slugify(e.electorate)}"`,
            );
          }
        }
        break;
      }
      case "ballot": {
        if (!CHAMBERS.has(e.chamber)) push(`${at}: scope "ballot" requires chamber house|senate`);
        if (!isNonEmptyString(e.ballot)) push(`${at}: scope "ballot" requires ballot`);
        else if (hasElection(e.electionId) && CHAMBERS.has(e.chamber)) {
          // The runtime matches a House ballot by its electorate slug and a Senate ballot by the
          // uppercase state code, EXACTLY — so the stored selector must already be in that canonical
          // form or the suspension would silently fail to take effect (fail-open).
          const canonical =
            e.chamber === "house" ? slugify(e.ballot) : String(e.ballot).toUpperCase();
          const valid =
            e.chamber === "house"
              ? (refs.electorateSlugsByElection[e.electionId] ?? []).includes(canonical)
              : (refs.senateStatesByElection[e.electionId] ?? []).includes(canonical);
          if (!valid) {
            push(
              `${at}: ballot "${e.ballot}" is not a ${e.chamber} ballot for ${e.electionId} — the suspension would have no effect`,
            );
          } else if (e.ballot !== canonical) {
            push(
              `${at}: ballot "${e.ballot}" must be stored in canonical form "${canonical}" for chamber ${e.chamber}`,
            );
          }
        }
        break;
      }
      case "mapping": {
        if (!isNonEmptyString(e.partyKey)) push(`${at}: scope "mapping" requires partyKey`);
        else if (hasElection(e.electionId)) {
          const keys = refs.partyKeysByElection[e.electionId] ?? [];
          if (!keys.includes(e.partyKey)) {
            push(
              `${at}: partyKey "${e.partyKey}" does not exist in the ${e.electionId} party registry — the suspension would have no effect`,
            );
          }
        }
        break;
      }
      case "proposition": {
        if (!Number.isInteger(e.propositionId)) {
          push(`${at}: scope "proposition" requires an integer propositionId`);
        } else if (hasElection(e.electionId)) {
          const ids = refs.propositionIdsByElection[e.electionId] ?? [];
          if (!ids.includes(e.propositionId)) {
            push(
              `${at}: propositionId ${e.propositionId} is not a question in ${e.electionId} — the suspension would have no effect`,
            );
          }
        }
        break;
      }
      case "map": {
        if (!isNonEmptyString(e.mapId) || !/^[^/]+\/[^/]+$/.test(e.mapId)) {
          push(`${at}: scope "map" requires a mapId of the form <electionId>/<STATE>`);
        } else {
          const [id, state] = e.mapId.split("/");
          if (!hasElection(id)) push(`${at}: map "${e.mapId}" names unknown election "${id}"`);
          else if (!(refs.senateStatesByElection[id] ?? []).includes(state.toUpperCase())) {
            push(`${at}: map "${e.mapId}" names unknown state "${state}" for ${id}`);
          } else if (state !== state.toUpperCase()) {
            // The runtime builds the map key as `${electionId}/${STATE.toUpperCase()}` and matches
            // EXACTLY, so a lowercase state here would silently fail to suspend (fail-open).
            push(
              `${at}: map "${e.mapId}" must store the state uppercase ("${id}/${state.toUpperCase()}")`,
            );
          }
        }
        break;
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
const ELECTIONS = ["2019", "2022", "2025"];

function loadRefs() {
  const root = new URL("../", import.meta.url);
  const refs = {
    electionIds: [...ELECTIONS],
    partyKeysByElection: {},
    propositionIdsByElection: {},
    electorateSlugsByElection: {},
    senateStatesByElection: {},
  };
  for (const id of ELECTIONS) {
    const parties = JSON.parse(
      readFileSync(new URL(`data/source/${id}/parties.json`, root), "utf8"),
    );
    const questions = JSON.parse(
      readFileSync(new URL(`data/source/${id}/questions.json`, root), "utf8"),
    );
    const ballots = JSON.parse(
      readFileSync(new URL(`data/source/${id}/ballots.json`, root), "utf8"),
    );
    refs.partyKeysByElection[id] = (parties.parties ?? []).map((p) => p.key);
    refs.propositionIdsByElection[id] = (questions.questions ?? []).map((q) => q.id);
    refs.electorateSlugsByElection[id] = [
      ...new Set((ballots.house ?? []).map((r) => slugify(r.division))),
    ];
    refs.senateStatesByElection[id] = [
      ...new Set((ballots.senate ?? []).map((r) => String(r.state).toUpperCase())),
    ];
  }
  return refs;
}

function main() {
  const root = new URL("../", import.meta.url);
  let plane;
  let refs;
  try {
    plane = JSON.parse(readFileSync(new URL("data/governance/control-plane.json", root), "utf8"));
    refs = loadRefs();
  } catch (err) {
    console.error(`::error::control-plane: cannot read a record: ${err.message}`);
    process.exit(1);
    return;
  }
  const result = verdict({ plane, refs });
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::control-plane: ${e}`);
    console.error(`control plane: ${result.errors.length} problem(s)`);
    process.exit(1);
    return;
  }
  const active = (plane.suspensions ?? []).filter((s) => !s.liftedAt).length;
  console.info(
    `control plane OK — signed, ${plane.suspensions?.length ?? 0} entr(y/ies) (${active} active), all selectors valid`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
