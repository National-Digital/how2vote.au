import { readFile, readdir } from "node:fs/promises";
import {
  snapshotMetaSchema,
  snapshotVersionsSchema,
  writWindow,
  type ElectionMeta,
  type Question,
  type QuestionSet,
  type SnapshotBasis,
  type SnapshotMeta,
  type SnapshotVersions,
} from "@how2vote/data-schema";
import {
  compilePolicy,
  TVFY_API_BASE,
  type CompiledPolicy,
  type TvfyPolicyDetail,
} from "./tvfy.js";
import { electionPaths, readJson, snapshotVersionPaths, writeJson, checksum } from "./paths.js";

/** The TVFY API schema version and data licence the snapshots record as provenance. */
export const TVFY_API_SCHEMA_VERSION = "v1";
export const TVFY_LICENCE_VERSION = "ODbL-1.0";

/**
 * Shared logic for the snapshot lifecycle commands (ADR 0005). The guards and merge functions are
 * pure; the load/sync helpers do the IO around them.
 */

// — guards —

export type GuardVerdict = { ok: true; warnings: string[] } | { ok: false; refusal: string };

const refuse = (refusal: string): GuardVerdict => ({ ok: false, refusal });

/**
 * Whether a snapshot FETCH may run now. Fetching from the live TVFY API is permitted only inside
 * the writ window (issue of writs → declaration of nominations) — an API-hygiene rule that keeps
 * fetches within the campaign period. `--force` overrides the window (a deliberate one-off is not
 * polling) but NEVER a lock: the only way past a locked version is a new version via
 * `--new-version --reason … --verified-by …`.
 */
export function guardFetch(
  meta: ElectionMeta,
  activeMeta: SnapshotMeta | null,
  now: Date,
  opts: { force: boolean; newVersion: boolean },
): GuardVerdict {
  const window = writWindow(meta);
  if (!window) {
    return refuse(
      `Election "${meta.id}" has no AEC timetable. Add it to ELECTIONS in packages/data-schema/src/elections.ts (transcribed from the AEC timetable page) before any snapshot command can run.`,
    );
  }
  if (activeMeta?.locked && !opts.newVersion) {
    return refuse(
      `Snapshot v${activeMeta.version} for "${meta.id}" is LOCKED (${activeMeta.lockedAt}). A verified factual correction must be a new version: rerun with --new-version --reason "…" --verified-by "…" (--force cannot override a lock).`,
    );
  }
  if (activeMeta && !activeMeta.locked && opts.newVersion) {
    return refuse(
      `The active snapshot v${activeMeta.version} for "${meta.id}" is not locked — refresh it instead of starting a new version.`,
    );
  }
  const n = now.getTime();
  if (n < window.start || n >= window.end) {
    if (!opts.force) {
      return refuse(
        `Now is outside the writ window for "${meta.id}" (${new Date(window.start).toISOString()} → ${new Date(window.end).toISOString()}). The TVFY API is only fetched during the election lead-up; pass --force for a deliberate one-off run.`,
      );
    }
    return { ok: true, warnings: ["--force: fetching outside the writ window."] };
  }
  return { ok: true, warnings: [] };
}

/**
 * Whether a snapshot LOCK may run now: at/after the declaration of nominations (the release
 * baseline), warning when the election is already past polls close. `--force` permits a rehearsal
 * lock before the declaration; nothing overrides an existing lock.
 */
export function guardLock(
  meta: ElectionMeta,
  activeMeta: SnapshotMeta | null,
  now: Date,
  opts: { force: boolean },
): GuardVerdict {
  const t = meta.timetable;
  if (!t) {
    return refuse(
      `Election "${meta.id}" has no AEC timetable. Add it to ELECTIONS in packages/data-schema/src/elections.ts before any snapshot command can run.`,
    );
  }
  if (activeMeta?.locked) {
    return refuse(
      `Snapshot v${activeMeta.version} for "${meta.id}" is already LOCKED (${activeMeta.lockedAt}). Corrections are new versions (snapshot-fetch --new-version).`,
    );
  }
  const n = now.getTime();
  const warnings: string[] = [];
  if (n < Date.parse(t.declarationOfNominations)) {
    if (!opts.force) {
      return refuse(
        `The declaration of nominations for "${meta.id}" is ${t.declarationOfNominations}; the lock is the release baseline and may not run before it (pass --force only for a rehearsal on a scratch election).`,
      );
    }
    warnings.push("--force: rehearsal lock BEFORE the declaration of nominations.");
  }
  if (n > Date.parse(t.pollsCloseAt)) {
    warnings.push(
      `Polls closed ${t.pollsCloseAt} — locking after the election. A contemporaneous snapshot must be captured during the writ window; a post-election capture is a primary-source-reconstruction (provenance only, positions stay vintage).`,
    );
  }
  return { ok: true, warnings };
}

// — questions.json sync —

/**
 * Merges a snapshot compilation into the curated question set (pure): question order and
 * hand-curated `text` (and any `withdrawn` flag) are preserved; `positions` and the division
 * fields are replaced wholesale from the compilation; `dataVersion` becomes the latest compiled
 * division date. Unknown party keys surface later via the registry gate (`unknown-position-key`),
 * which is the intended fail-closed behaviour.
 */
export function mergeQuestions(
  questions: QuestionSet,
  compiled: ReadonlyMap<number, CompiledPolicy>,
): QuestionSet {
  const merged: Question[] = questions.questions.map((q) => {
    const c = compiled.get(q.id);
    if (!c) throw new Error(`no snapshot policy for question ${q.id}`);
    return {
      id: q.id,
      text: q.text,
      ...(c.divisionFirst !== null ? { divisionFirst: c.divisionFirst } : {}),
      ...(c.divisionLast !== null ? { divisionLast: c.divisionLast } : {}),
      divisionCount: c.divisionCount,
      positions: c.positions,
      ...(q.withdrawn !== undefined ? { withdrawn: q.withdrawn } : {}),
    };
  });
  const dataVersion =
    merged
      .map((q) => q.divisionLast)
      .filter((d): d is string => d !== undefined)
      .sort()
      .at(-1) ?? questions.dataVersion;
  return { ...questions, dataVersion, questions: merged };
}

/**
 * Restricts a policy's divisions to those on/before a vintage date (pure) — used by the one-off
 * `data:snapshot:divisions` reconstruction so past elections carry division fields with the vintage
 * their positions were compiled at, not today's curation.
 */
export function filterDivisionsToVintage(
  detail: TvfyPolicyDetail,
  vintage: string,
): TvfyPolicyDetail {
  return {
    ...detail,
    policy_divisions: detail.policy_divisions.filter((d) => d.division.date <= vintage),
  };
}

// — IO helpers —

export async function loadVersions(electionId: string): Promise<SnapshotVersions | null> {
  try {
    return snapshotVersionsSchema.parse(
      await readJson(electionPaths(electionId).snapshot.versions),
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function loadActiveMeta(electionId: string): Promise<SnapshotMeta | null> {
  const versions = await loadVersions(electionId);
  if (!versions) return null;
  return snapshotMetaSchema.parse(
    await readJson(snapshotVersionPaths(electionId, versions.active).meta),
  );
}

/** Reads and compiles every policy file in a snapshot version. */
export async function compileSnapshot(
  electionId: string,
  version: number,
): Promise<Map<number, CompiledPolicy>> {
  const { policiesDir } = snapshotVersionPaths(electionId, version);
  const compiled = new Map<number, CompiledPolicy>();
  let files: string[];
  try {
    files = (await readdir(policiesDir)).filter((f) => f.endsWith(".json"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return compiled;
    throw err;
  }
  for (const file of files.sort()) {
    const detail = await readJson<TvfyPolicyDetail>(`${policiesDir}/${file}`);
    const policy = compilePolicy(detail);
    compiled.set(policy.id, policy);
  }
  return compiled;
}

/** Recomputes the `meta.files` hash map from the files on disk (parsed-JSON canonical hashes). */
export async function hashSnapshotFiles(
  electionId: string,
  version: number,
  relPaths: string[],
): Promise<Record<string, string>> {
  const { dir } = snapshotVersionPaths(electionId, version);
  const hashes: Record<string, string> = {};
  for (const rel of relPaths) {
    try {
      hashes[rel] = checksum(JSON.parse(await readFile(`${dir}/${rel}`, "utf8")));
    } catch {
      // absent/unreadable — leave the key out so the consistency gate reports the drift
    }
  }
  return hashes;
}

/**
 * Rewrites `data/source/<id>/questions.json` from the active snapshot version's compilation.
 * Returns the merged set for further use.
 */
export async function syncQuestionsFromSnapshot(electionId: string): Promise<QuestionSet> {
  const versions = await loadVersions(electionId);
  if (!versions) throw new Error(`no snapshot for election ${electionId}`);
  const active = await loadActiveMeta(electionId);
  if (active?.basis === "primary-source-reconstruction") {
    throw new Error(
      `refusing to sync questions.json for "${electionId}": its snapshot is a primary-source-reconstruction (provenance only). Syncing would overwrite the period-accurate vintage positions with today's aggregate.`,
    );
  }
  const source = electionPaths(electionId).source;
  const questions = await readJson<QuestionSet>(source.questions);
  const compiled = await compileSnapshot(electionId, versions.active);
  const merged = mergeQuestions(questions, compiled);
  await writeJson(source.questions, merged);
  return merged;
}

/** The policy ids the election's curated questions use, in question order. */
export async function usedPolicyIds(electionId: string): Promise<number[]> {
  const questions = await readJson<QuestionSet>(electionPaths(electionId).source.questions);
  return questions.questions.map((q) => q.id);
}

/** Appends/updates a version entry in versions.json (creates the file for v1). */
export async function upsertVersionEntry(
  electionId: string,
  entry: {
    version: number;
    createdAt: string;
    lockedAt: string | null;
    reason?: string;
    verifiedBy?: string;
  },
): Promise<void> {
  const path = electionPaths(electionId).snapshot.versions;
  const existing = await loadVersions(electionId);
  const history = existing ? [...existing.history] : [];
  const i = history.findIndex((h) => h.version === entry.version);
  const record = {
    ...entry,
    ...(entry.version > 1 ? { supersedes: entry.version - 1 } : {}),
  };
  if (i >= 0) history[i] = { ...history[i], ...record };
  else history.push(record);
  await writeJson(
    path,
    snapshotVersionsSchema.parse({
      schemaVersion: 1,
      electionId,
      active: entry.version,
      history,
    }),
  );
}

/**
 * Fetches the live TVFY data for an election's used policies into a snapshot version dir
 * (policies-list.json + policies/<id>.json) and writes an UNLOCKED meta.json with fresh file
 * hashes. The caller is responsible for guards and versions.json.
 */
export async function fetchSnapshotVersion(opts: {
  electionId: string;
  version: number;
  /** Evidentiary basis: contemporaneous capture vs a past-election provenance recapture. */
  basis: SnapshotBasis;
  /**
   * For a `primary-source-reconstruction` snapshot, the compilation period (date) the retained
   * vintage positions reflect — the honest "as at" for the shown scores. Null for contemporaneous.
   */
  effectiveAsAt: string | null;
  listPolicies: () => Promise<unknown>;
  getPolicy: (id: number) => Promise<TvfyPolicyDetail>;
  nowIso: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<SnapshotMeta> {
  const { electionId, version, basis, effectiveAsAt, nowIso } = opts;
  const vp = snapshotVersionPaths(electionId, version);
  const policyIds = await usedPolicyIds(electionId);

  const list = await opts.listPolicies();
  await writeJson(vp.policiesList, list);

  const policies: Record<number, TvfyPolicyDetail> = {};
  let done = 0;
  for (const id of policyIds) {
    const detail = await opts.getPolicy(id);
    await writeJson(vp.policy(id), detail);
    policies[id] = detail;
    done++;
    opts.onProgress?.(done, policyIds.length);
  }

  // Provenance anchor: a deterministic sha-256 over the canonical JSON of the concatenated API
  // responses (list + each policy, in question order). Canonical-JSON (not raw bytes) so an independent
  // re-fetch of unchanged data reproduces it regardless of insignificant server whitespace.
  const responseSha256 = checksum({ list, policies: policyIds.map((id) => policies[id]) });

  const relPaths = ["policies-list.json", ...policyIds.map((id) => `policies/${id}.json`)];
  const files = await hashSnapshotFiles(electionId, version, relPaths);
  const meta = snapshotMetaSchema.parse({
    schemaVersion: 2,
    electionId,
    version,
    source: "tvfy-api",
    basis,
    endpoint: TVFY_API_BASE,
    retrievedAt: nowIso,
    responseSha256,
    apiSchemaVersion: TVFY_API_SCHEMA_VERSION,
    licenceVersion: TVFY_LICENCE_VERSION,
    effectiveAsAt,
    locked: false,
    lockedAt: null,
    policyIds,
    files,
  });
  await writeJson(vp.meta, meta);
  return meta;
}

/**
 * Finalises a fetched version as the locked release: copies the election's ballots.json into the
 * version dir (the ballot order is declared final at the same instant — part of the release),
 * re-hashes, and rewrites meta.json with `locked: true`. Re-reads meta just before writing and
 * refuses if a lock appeared meanwhile (operator race).
 */
export async function lockSnapshotVersion(
  electionId: string,
  version: number,
  lockedAtIso: string,
): Promise<SnapshotMeta> {
  const vp = snapshotVersionPaths(electionId, version);
  const current = snapshotMetaSchema.parse(await readJson(vp.meta));
  if (current.locked) {
    throw new Error(`snapshot v${version} for ${electionId} was locked concurrently — aborting`);
  }
  const ballots = await readJson<unknown>(electionPaths(electionId).source.ballots);
  await writeJson(vp.ballots, ballots);
  const relPaths = [...Object.keys(current.files), "ballots.json"];
  const files = await hashSnapshotFiles(electionId, version, relPaths);
  const meta = snapshotMetaSchema.parse({
    ...current,
    locked: true,
    lockedAt: lockedAtIso,
    files,
  });
  await writeJson(vp.meta, meta);
  return meta;
}
