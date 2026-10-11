#!/usr/bin/env node
/**
 * @fileoverview Clears the way for an App Store review submission, or explains why it must wait.
 *
 * App Store Connect holds one review submission per platform at a time, and one version in flight.
 * `deliver` refuses to submit while another submission is open ("A review submission is already in
 * progress"), so with a release per merge an earlier version is often still queued when the next
 * one is ready. This decides, from the app's open review submissions, its App Store versions and
 * its processed builds, what the submit job does with the build it was given:
 *
 *   submit  nothing is in the way: run `deliver`.
 *   cancel  an older version is waiting for review: cancel that submission, which makes its version
 *           Developer Rejected, then submit. `deliver` reuses the editable version: it renames it
 *           to this release and attaches this build.
 *   clear   an unsent draft submission holds items: remove them, and `deliver` reuses the draft.
 *   wait    a cancellation is still settling: poll, then decide again.
 *   defer   an older version is in review, or approved and not yet on sale. It is never
 *           cancelled; the build stays in TestFlight and ios-submission-catch-up.yml submits it
 *           once the way is clear.
 *   skip    this build is already submitted, or App Store Connect already holds a newer version or
 *           a processed build of one (whose own release submits it).
 *   fail    a submission has unresolved issues (a rejection), or a state needs a person.
 *
 * Modes:
 *   prepare  (submit job, App Manager key) acts on `cancel`, `clear` and `wait` until another
 *            outcome, then writes `outcome`, `reason` and `build` to $GITHUB_OUTPUT. Exits 1 on
 *            `fail`, which includes a missing build and any API error that will recur (see
 *            isPermanent); other errors exit 1 with no outcome. With BUILD_NUMBER empty it takes
 *            the newest processed build of APP_VERSION.
 *   check    (catch-up, read-only) takes CANDIDATES ("tag=commit=year …", newest first), picks the
 *            newest with a processed build, and writes its `tag`, `commit`, `version`,
 *            `build-year` and `build` with the `outcome` and `reason` for it. `outcome=none` when
 *            no candidate has a build or the catch-up owes it nothing (see `owed`: REQUESTED,
 *            IN_FLIGHT and its `app-store/<tag>` status, read with GH_TOKEN). A refused read of
 *            the review state writes `outcome=unreadable` for the release already chosen, so the
 *            caller can leave the decision to `prepare` behind the reviewer gate.
 * Both modes take RELEASES, the versions of the trusted release tags: only a processed build of
 * one of them stands a submission down.
 *
 * Usage:
 *   APP_VERSION=1.5.0 BUILD_NUMBER=105000123 ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_API_KEY_P8=<base64 .p8> \
 *     node scripts/app-store-submission.mjs prepare
 *   CANDIDATES="v1.5.1=<sha>=2026 v1.5.0=<sha>=2026" ASC_KEY_ID=… … node scripts/app-store-submission.mjs check
 *
 * Dependency-free: it runs from the workflow's own commit before anything is installed.
 */
import { appendFileSync } from "node:fs";
import { createPrivateKey, sign } from "node:crypto";
import { fileURLToPath } from "node:url";

export const BUNDLE_ID = "au.how2vote.app";
export const API = "https://api.appstoreconnect.apple.com";
const PLATFORM = "IOS";
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Review submission states that hold the platform's one open submission. */
export const OPEN_SUBMISSION_STATES = [
  "READY_FOR_REVIEW",
  "WAITING_FOR_REVIEW",
  "IN_REVIEW",
  "UNRESOLVED_ISSUES",
  "CANCELING",
];

/** Version states in which a build has been handed to App Review or past it. */
const SUBMITTED = new Set([
  "WAITING_FOR_REVIEW",
  "IN_REVIEW",
  "ACCEPTED",
  "PENDING_DEVELOPER_RELEASE",
  "PENDING_APPLE_RELEASE",
  "PROCESSING_FOR_DISTRIBUTION",
  "READY_FOR_DISTRIBUTION",
]);
/** Approved, not yet on sale. App Store Connect allows no new version until it is released. */
const AWAITING_RELEASE = new Set([
  "ACCEPTED",
  "PENDING_DEVELOPER_RELEASE",
  "PENDING_APPLE_RELEASE",
  "PROCESSING_FOR_DISTRIBUTION",
]);
/** States that leave the version editable or finished: nothing to wait for. */
const SETTLED = new Set([
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
  "READY_FOR_DISTRIBUTION",
  "REPLACED_WITH_NEW_VERSION",
  "REMOVED_FROM_SALE",
  "DEVELOPER_REMOVED_FROM_SALE",
]);
/** The deprecated `appStoreState` names that differ from `appVersionState`. */
const LEGACY_STATES = {
  READY_FOR_SALE: "READY_FOR_DISTRIBUTION",
  PREORDER_READY_FOR_SALE: "READY_FOR_DISTRIBUTION",
  PROCESSING_FOR_APP_STORE: "PROCESSING_FOR_DISTRIBUTION",
};

/**
 * The version's state, from `appVersionState`, else the deprecated `appStoreState`. Null if
 * neither is present.
 * @param {{ appVersionState?: string, appStoreState?: string }} attributes
 */
export function versionState(attributes) {
  if (attributes?.appVersionState) return attributes.appVersionState;
  const legacy = attributes?.appStoreState;
  return legacy ? (LEGACY_STATES[legacy] ?? legacy) : null;
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number} negative, zero or positive as a is older, equal or newer than b
 */
export function compareVersions(a, b) {
  const [x, y] = [a, b].map((v) => String(v).split(".").map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/**
 * @typedef {{ id: string, version: string, state: string, build: string | null }} Version
 * @typedef {{ id: string, state: string, versionId: string | null, itemIds: string[] }} Submission
 * @typedef {{ version: string, build: string }} Build
 * @typedef {{ action: "submit" | "cancel" | "clear" | "wait" | "defer" | "skip" | "fail",
 *   reason: string, submissionId?: string, itemIds?: string[], warnings?: string[] }} Decision
 */

/**
 * What to do with `target`, given the app's App Store versions, open review submissions and
 * processed builds. A processed build of a newer version stands this one down only when that
 * version is a release (`releases`, the versions of the trusted release tags); any other newer
 * build is reported in `warnings` and ignored, so a stray TestFlight upload cannot block
 * submissions.
 * @param {{ target: { version: string, build: string }, versions: Version[],
 *   submissions: Submission[], builds?: Build[], releases?: Set<string> }} state
 * @returns {Decision}
 */
export function decide(state) {
  const decision = decideOnly(state);
  const warnings = (state.builds ?? [])
    .filter(
      (b) =>
        compareVersions(b.version, state.target.version) > 0 && !state.releases?.has(b.version),
    )
    .map((b) => `build ${b.build} of ${b.version} is processed but ${b.version} is not a release`);
  return warnings.length ? { ...decision, warnings: [...new Set(warnings)] } : decision;
}

/** @param {Parameters<typeof decide>[0]} state @returns {Decision} */
function decideOnly({ target, versions, submissions, builds = [], releases = new Set() }) {
  const label = (v) => `${v.version}${v.build ? ` (${v.build})` : ""}`;
  const versionOf = (s) => versions.find((v) => v.id === s.versionId);
  const about = (s) => {
    const v = versionOf(s);
    return v ? label(v) : "an unidentified version";
  };
  const newest = (list) => [...list].sort((a, b) => compareVersions(b.version, a.version))[0];

  const same = versions.find(
    (v) => v.version === target.version && v.build === target.build && SUBMITTED.has(v.state),
  );
  if (same) {
    return { action: "skip", reason: `${label(same)} is already submitted (${same.state})` };
  }
  const newer = newest(versions.filter((v) => compareVersions(v.version, target.version) > 0));
  if (newer) {
    return {
      action: "skip",
      reason: `a newer version is in App Store Connect: ${label(newer)} (${newer.state})`,
    };
  }
  const newerBuild = newest(
    builds.filter((b) => compareVersions(b.version, target.version) > 0 && releases.has(b.version)),
  );
  if (newerBuild) {
    return {
      action: "skip",
      reason: `a newer build is processed in App Store Connect: ${label(newerBuild)}; its own release submits it`,
    };
  }
  const laterBuild = builds
    .filter((b) => b.version === target.version && Number(b.build) > Number(target.build))
    .sort((a, b) => Number(b.build) - Number(a.build))[0];
  if (laterBuild) {
    return {
      action: "skip",
      reason: `a later build of ${target.version} is processed: ${label(laterBuild)}; its own run submits it`,
    };
  }
  const approved = versions.find(
    (v) =>
      v.version === target.version &&
      (AWAITING_RELEASE.has(v.state) || v.state === "READY_FOR_DISTRIBUTION"),
  );
  if (approved) {
    return {
      action: "skip",
      reason: `${target.version} is already approved as ${label(approved)} (${approved.state}); a new build needs a new version`,
    };
  }

  const rejected = submissions.find((s) => s.state === "UNRESOLVED_ISSUES");
  if (rejected) {
    return {
      action: "fail",
      reason: `the review submission for ${about(rejected)} has unresolved issues (rejected)`,
    };
  }
  const unknown = versions.find(
    (v) =>
      !SETTLED.has(v.state) &&
      !SUBMITTED.has(v.state) &&
      v.state !== "READY_FOR_REVIEW" &&
      v.state !== "WAITING_FOR_REVIEW",
  );
  if (unknown) {
    return { action: "fail", reason: `${label(unknown)} is in state ${unknown.state}` };
  }

  const reviewing =
    submissions.find((s) => s.state === "IN_REVIEW") ??
    versions.find((v) => v.state === "IN_REVIEW");
  if (reviewing) {
    const what = "versionId" in reviewing ? about(reviewing) : label(reviewing);
    return { action: "defer", reason: `${what} is in review` };
  }
  const pending = versions.find((v) => AWAITING_RELEASE.has(v.state));
  if (pending) {
    // Versions are submitted for automatic release, so only a manually released one waits here.
    const hint =
      pending.state === "PENDING_DEVELOPER_RELEASE" ? "; release it in App Store Connect" : "";
    return {
      action: "defer",
      reason: `${label(pending)} is approved and not yet released (${pending.state})${hint}`,
    };
  }

  const canceling = submissions.find((s) => s.state === "CANCELING");
  if (canceling) {
    return { action: "wait", reason: `the submission for ${about(canceling)} is being cancelled` };
  }
  const queued = submissions.find((s) => s.state === "WAITING_FOR_REVIEW");
  if (queued) {
    return {
      action: "cancel",
      submissionId: queued.id,
      reason: `${about(queued)} is waiting for review; replacing it with ${label(target)}`,
    };
  }
  const draft = submissions.find((s) => s.state === "READY_FOR_REVIEW" && s.itemIds.length > 0);
  if (draft) {
    return {
      action: "clear",
      submissionId: draft.id,
      itemIds: draft.itemIds,
      reason: `an unsent draft submission holds ${about(draft)}; removing its items`,
    };
  }
  const stranded = versions.find(
    (v) => v.state === "WAITING_FOR_REVIEW" || v.state === "READY_FOR_REVIEW",
  );
  if (stranded) {
    return {
      action: "wait",
      reason: `${label(stranded)} is ${stranded.state} with no open submission yet`,
    };
  }
  return { action: "submit", reason: `nothing is in review; submitting ${label(target)}` };
}

/**
 * An App Store Connect API token (ES256, 20 minutes at most).
 * @param {{ keyId: string, issuerId: string, privateKey: string, now?: number }} key
 */
export function ascToken({ keyId, issuerId, privateKey, now = Date.now() }) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const iat = Math.floor(now / 1000);
  const input = `${b64({ alg: "ES256", kid: keyId, typ: "JWT" })}.${b64({
    iss: issuerId,
    iat,
    exp: iat + 15 * 60,
    aud: "appstoreconnect-v1",
  })}`;
  const signature = sign("sha256", Buffer.from(input), {
    key: createPrivateKey(privateKey),
    dsaEncoding: "ieee-p1363",
  });
  return `${input}.${signature.toString("base64url")}`;
}

export class ApiError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Whether an error will recur on retry: any 4xx but 409 and 429 (a revoked or expired key, a
 * refused request). 5xx, 409, 429 and network errors may pass later.
 * @param {unknown} error
 */
export function isPermanent(error) {
  return (
    error instanceof ApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 409 &&
    error.status !== 429
  );
}

/** Attempts per request; 429, 5xx and network errors are retried with backoff. */
export const ATTEMPTS = 4;

/**
 * A minimal JSON:API client. `get` follows `links.next` and merges `data` and `included`.
 * @param {{ fetchImpl: typeof fetch, token: () => string,
 *   sleep?: (ms: number) => Promise<void> }} deps
 */
export function createClient({
  fetchImpl,
  token,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  const once = async (method, url, body) => {
    const res = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token()}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }
    if (!res.ok) {
      const detail =
        (Array.isArray(json?.errors) && json.errors.map((e) => e?.detail ?? e?.title).join("; ")) ||
        text.slice(0, 200);
      throw new ApiError(
        res.status,
        `${method} ${new URL(url).pathname}: HTTP ${res.status} ${detail}`,
      );
    }
    return json ?? {};
  };
  const request = async (method, url, body) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await once(method, url, body);
      } catch (error) {
        const transient =
          !(error instanceof ApiError) || error.status === 429 || error.status >= 500;
        if (!transient || attempt >= ATTEMPTS) throw error;
        await sleep(2000 * 2 ** (attempt - 1));
      }
    }
  };
  const href = (path, params = {}) => {
    const url = new URL(path, API);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url.href;
  };
  return {
    async get(path, params = {}) {
      const data = [];
      const included = [];
      let next = href(path, params);
      for (let page = 0; next && page < 20; page++) {
        const json = await request("GET", next);
        data.push(...(Array.isArray(json.data) ? json.data : json.data ? [json.data] : []));
        included.push(...(Array.isArray(json.included) ? json.included : []));
        next = json.links?.next;
      }
      return { data, included };
    },
    patch: (path, body) => request("PATCH", href(path), body),
    del: (path) => request("DELETE", href(path)),
  };
}

/** @param {ReturnType<typeof createClient>} api */
export async function findAppId(api) {
  const { data } = await api.get("/v1/apps", { "filter[bundleId]": BUNDLE_ID, limit: "2" });
  const app = data.find((a) => a?.attributes?.bundleId === BUNDLE_ID);
  if (!app) throw new Error(`no App Store Connect app with bundle id ${BUNDLE_ID}`);
  return app.id;
}

/**
 * The app's processed, unexpired builds, optionally of one version.
 * @param {ReturnType<typeof createClient>} api
 * @param {string} appId
 * @param {string} [version]
 * @returns {Promise<Build[]>}
 */
export async function processedBuilds(api, appId, version) {
  const { data, included } = await api.get("/v1/builds", {
    "filter[app]": appId,
    ...(version ? { "filter[preReleaseVersion.version]": version } : {}),
    "filter[preReleaseVersion.platform]": PLATFORM,
    "filter[processingState]": "VALID",
    "filter[expired]": "false",
    include: "preReleaseVersion",
    "fields[preReleaseVersions]": "version",
    sort: "-uploadedDate",
    limit: "200",
  });
  const versions = new Map(
    included
      .filter((r) => r?.type === "preReleaseVersions")
      .map((r) => [r.id, String(r.attributes?.version ?? "")]),
  );
  return data
    .map((b) => ({
      version: version ?? versions.get(b?.relationships?.preReleaseVersion?.data?.id) ?? "",
      build: String(b?.attributes?.version ?? ""),
    }))
    .filter((b) => SEMVER.test(b.version) && /^\d+$/.test(b.build));
}

/**
 * The newest processed, unexpired build number of `version`, or null.
 * @param {ReturnType<typeof createClient>} api
 * @param {string} appId
 * @param {string} version
 */
export async function latestBuild(api, appId, version) {
  const builds = await processedBuilds(api, appId, version);
  return builds.map((b) => b.build).sort((a, b) => Number(b) - Number(a))[0] ?? null;
}

/**
 * The app's App Store versions, open review submissions and processed builds, normalised for
 * `decide`. A version carrying no state at all is left out.
 * @param {ReturnType<typeof createClient>} api
 * @param {string} appId
 * @returns {Promise<{ versions: Version[], submissions: Submission[], builds: Build[] }>}
 */
export async function readState(api, appId) {
  const [v, s, builds] = await Promise.all([
    api.get(`/v1/apps/${appId}/appStoreVersions`, {
      "filter[platform]": PLATFORM,
      include: "build",
      "fields[builds]": "version",
      limit: "200",
    }),
    api.get(`/v1/apps/${appId}/reviewSubmissions`, {
      "filter[platform]": PLATFORM,
      "filter[state]": OPEN_SUBMISSION_STATES.join(","),
      include: "items,appStoreVersionForReview",
      limit: "50",
    }),
    processedBuilds(api, appId),
  ]);
  const buildNumbers = new Map(
    v.included
      .filter((r) => r?.type === "builds")
      .map((b) => [b.id, String(b.attributes?.version)]),
  );
  const versions = v.data
    .filter((r) => SEMVER.test(r?.attributes?.versionString ?? "") && versionState(r.attributes))
    .map((r) => ({
      id: r.id,
      version: r.attributes.versionString,
      state: versionState(r.attributes),
      build: buildNumbers.get(r.relationships?.build?.data?.id) ?? null,
    }));
  const submissions = s.data.map((r) => ({
    id: r.id,
    state: r.attributes?.state,
    versionId: r.relationships?.appStoreVersionForReview?.data?.id ?? null,
    itemIds: (r.relationships?.items?.data ?? []).map((i) => i.id),
  }));
  return { versions, submissions, builds };
}

/** Relationships a review submission item can point at; only `appStoreVersion` is handled. */
const ITEM_KINDS = [
  "appStoreVersion",
  "appCustomProductPageVersion",
  "appStoreVersionExperiment",
  "appEvent",
  "appStoreVersionExperimentV2",
  "backgroundAssetVersion",
];

/**
 * What each review submission item holds, from its relationships ("unknown" when none is set).
 * @param {{ relationships?: Record<string, { data?: unknown }> }[]} items
 * @returns {string[]}
 */
export function itemKinds(items) {
  return items.map((item) => ITEM_KINDS.find((k) => item?.relationships?.[k]?.data) ?? "unknown");
}

/**
 * A review submission's items with the resources they point at. Items of a kind outside the
 * requested includes come back without relationship data and read as "unknown".
 * @param {ReturnType<typeof createClient>} api
 * @param {string} submissionId
 */
export async function submissionItems(api, submissionId) {
  const path = `/v1/reviewSubmissions/${submissionId}/items`;
  try {
    return (await api.get(path, { include: ITEM_KINDS.slice(0, 4).join(","), limit: "50" })).data;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 400) throw error;
    return (await api.get(path, { include: "appStoreVersion", limit: "50" })).data;
  }
}

/** Re-reads (about five minutes at the default poll) allowed after acting on a submission. */
export const SETTLE_READS = 20;

/**
 * Decide, acting on `cancel`, `clear` and `wait` until the outcome is final. A submission is
 * cancelled or emptied only when every item in it is an App Store version, and at most once: after
 * acting this waits `pollMs` and re-reads up to SETTLE_READS times. A submission that still needs
 * the same action after that, or a cancellation that does not settle within `maxPolls`, is a
 * `defer`, so the catch-up tries again later.
 * @param {{ api: ReturnType<typeof createClient>, appId: string,
 *   target: { version: string, build: string }, releases?: Set<string>,
 *   sleep: (ms: number) => Promise<void>, log?: (line: string) => void, pollMs?: number,
 *   maxPolls?: number }} deps
 * @returns {Promise<Decision>}
 */
export async function prepare({
  api,
  appId,
  target,
  releases,
  sleep,
  log = () => {},
  pollMs = 15000,
  maxPolls = 60,
}) {
  /** @type {Map<string, number>} action:submission → re-reads since acting */
  const acted = new Map();
  for (let poll = 0; poll <= maxPolls; poll++) {
    const decision = decide({ target, releases, ...(await readState(api, appId)) });
    log(decision.reason);
    for (const warning of decision.warnings ?? []) log(`warning: ${warning}`);
    const { action, submissionId } = decision;
    if (action !== "cancel" && action !== "clear") {
      if (action !== "wait") return decision;
      await sleep(pollMs);
      continue;
    }
    const key = `${action}:${submissionId}`;
    if (acted.has(key)) {
      const reads = acted.get(key) + 1;
      if (reads < SETTLE_READS) {
        acted.set(key, reads);
        await sleep(pollMs);
        continue;
      }
      return {
        action: "defer",
        reason:
          action === "cancel"
            ? `review submission ${submissionId} is still listed as waiting for review after this job cancelled it; the catch-up tries again`
            : `draft submission ${submissionId} still lists items after this job removed them; the catch-up tries again`,
      };
    }
    const items = await submissionItems(api, submissionId);
    const kinds = itemKinds(items);
    const foreign = kinds.filter((k) => k !== "appStoreVersion");
    if (foreign.length > 0) {
      return {
        action: "fail",
        reason: `review submission ${submissionId} holds items other than an App Store version (${[...new Set(foreign)].join(", ")}); resolve it in App Store Connect`,
      };
    }
    if (action === "cancel") {
      const { data } = await api.get(`/v1/reviewSubmissions/${submissionId}`);
      const current = data[0]?.attributes?.state;
      if (current !== "WAITING_FOR_REVIEW") {
        log(`review submission ${submissionId} is now ${current}; reading the state again`);
        await sleep(pollMs);
        continue;
      }
      acted.set(key, 0);
      try {
        await api.patch(`/v1/reviewSubmissions/${submissionId}`, {
          data: { type: "reviewSubmissions", id: submissionId, attributes: { canceled: true } },
        });
        log(`requested cancellation of review submission ${submissionId}`);
      } catch (error) {
        // The submission may have been picked up for review since it was read.
        if (!(error instanceof ApiError) || error.status !== 409) throw error;
        acted.delete(key);
        log(`cancellation refused (${error.message}); reading the state again`);
      }
      await sleep(pollMs);
      continue;
    }
    acted.set(key, 0);
    try {
      for (const id of decision.itemIds ?? []) {
        try {
          await api.del(`/v1/reviewSubmissionItems/${id}`);
        } catch (error) {
          // Already gone: a retried DELETE whose first attempt succeeded.
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
        }
      }
      log(`removed ${decision.itemIds?.length} item(s) from draft submission ${submissionId}`);
    } catch (error) {
      return {
        action: "fail",
        reason: `could not remove the items of draft submission ${submissionId} (${error.message}); remove them in App Store Connect`,
      };
    }
    await sleep(pollMs);
  }
  return {
    action: "defer",
    reason: `the previous submission did not clear within ${Math.round((maxPolls * pollMs) / 60000)} minutes; the catch-up tries again`,
  };
}

/**
 * CANDIDATES ("tag=commit=year …", newest first) parsed; malformed entries are dropped.
 * @param {string} text
 * @returns {{ tag: string, commit: string, year: string }[]}
 */
export function parseCandidates(text) {
  return String(text ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((entry) => {
      const [tag = "", commit = "", year = ""] = entry.split("=");
      return { tag, commit, year };
    })
    .filter(
      (c) =>
        c.tag.startsWith("v") &&
        SEMVER.test(c.tag.slice(1)) &&
        /^[0-9a-f]{40}$/.test(c.commit) &&
        /^\d{4}$/.test(c.year),
    );
}

/**
 * The newest candidate that has a processed build, with its version and build number.
 * @param {{ tag: string, commit: string, year: string }[]} candidates newest first
 * @param {(version: string) => Promise<string | null>} buildOf
 */
export async function pickCandidate(candidates, buildOf) {
  for (const c of candidates) {
    const version = c.tag.slice(1);
    const build = await buildOf(version);
    if (build) return { ...c, version, build };
  }
  return null;
}

/**
 * Whether the catch-up owes `tag` a submission. A dispatch naming the release always does. Otherwise
 * not while an ios-release run for it, or for a newer release, is in flight (that run submits);
 * and only while its `app-store/<tag>` record is pending (deferred, or uploaded and not yet
 * submitted) or absent (a build whose submit never recorded anything).
 * @param {{ tag: string, requested: string, state: string | null, inFlight: string[] }} input
 * @returns {{ owed: boolean, reason: string }}
 */
export function owed({ tag, requested, state, inFlight }) {
  if (requested) return { owed: true, reason: `${tag} was requested` };
  const running = inFlight.find((t) => compareVersions(t.replace(/^v/, ""), tag.slice(1)) >= 0);
  if (running) return { owed: false, reason: `an ios-release run for ${running} is in flight` };
  if (state === "pending" || state === null) {
    return { owed: true, reason: `app-store/${tag} is ${state ?? "absent"}` };
  }
  return { owed: false, reason: `${tag} owes no submission (app-store/${tag}: ${state})` };
}

/**
 * RELEASES (space-separated versions) as a set; null when unset.
 * @param {string | undefined} text
 */
export function parseReleases(text) {
  if (text === undefined) return null;
  return new Set(
    String(text)
      .split(/\s+/)
      .map((v) => v.replace(/^v/, ""))
      .filter((v) => SEMVER.test(v)),
  );
}

/**
 * The catch-up's read-only check: the newest candidate with a processed build, whether it is owed
 * a submission, and what App Store Connect allows for it. A 401/403 after a release with a
 * processed build was chosen reports `unreadable` for it; before that, `none`.
 * @param {{ api: ReturnType<typeof createClient>, candidates: ReturnType<typeof parseCandidates>,
 *   releases: Set<string>, requested: string, inFlight: string[],
 *   stateOf: (tag: string, commit: string) => Promise<string | null> }} deps
 * @returns {Promise<{ values: Record<string, string>, warnings: string[] }>}
 */
export async function checkCatchUp({ api, candidates, releases, requested, inFlight, stateOf }) {
  let target = null;
  const report = async (outcome, reason, chosen, warnings = []) => {
    const due = owed({
      tag: chosen.tag,
      requested,
      state: await stateOf(chosen.tag, chosen.commit),
      inFlight,
    });
    return {
      warnings,
      values: {
        ...(due.owed ? { outcome, reason } : { outcome: "none", reason: due.reason }),
        tag: chosen.tag,
        commit: chosen.commit,
        version: chosen.tag.slice(1),
        "build-year": chosen.year,
        build: chosen.build ?? "",
      },
    };
  };
  try {
    const appId = await findAppId(api);
    target = await pickCandidate(candidates, (v) => latestBuild(api, appId, v));
    if (!target) {
      return {
        warnings: [],
        values: { outcome: "none", reason: "no shipped release has a processed build" },
      };
    }
    const decision = decide({ target, releases, ...(await readState(api, appId)) });
    const outcome =
      decision.action === "cancel" || decision.action === "clear" ? "submit" : decision.action;
    return report(outcome, decision.reason, target, decision.warnings);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      const warning = `This key cannot read the review state (${error.message}).`;
      if (!target) {
        return {
          warnings: [warning],
          values: {
            outcome: "none",
            reason: "this key cannot read which release has a processed build",
          },
        };
      }
      return report(
        "unreadable",
        `this key cannot read the review state (${error.message}); the gated submit job decides`,
        target,
        [`${warning} The gated submit job decides instead.`],
      );
    }
    throw error;
  }
}

/* c8 ignore start -- network/CLI plumbing, exercised in CI not unit tests */
function output(values) {
  const out = process.env["GITHUB_OUTPUT"];
  if (out)
    appendFileSync(
      out,
      Object.entries(values)
        .map(([k, v]) => `${k}=${String(v).replace(/[\r\n]+/g, " ")}\n`)
        .join(""),
    );
}

function summary(line) {
  const file = process.env["GITHUB_STEP_SUMMARY"];
  if (file) appendFileSync(file, `${line}\n`);
}

function client() {
  const env = (name) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set`);
    return value;
  };
  const key = {
    keyId: env("ASC_KEY_ID"),
    issuerId: env("ASC_ISSUER_ID"),
    privateKey: Buffer.from(env("ASC_API_KEY_P8"), "base64").toString("utf8"),
  };
  return createClient({ fetchImpl: fetch, token: () => ascToken(key) });
}

const HEADLINE = {
  submit: "Submitting for review",
  skip: "Not submitted",
  defer: "Submission deferred",
  fail: "Submission blocked",
  wait: "Previous submission still clearing",
};

async function appStoreState(tag, commit) {
  const res = await fetch(
    `https://api.github.com/repos/${process.env["GITHUB_REPOSITORY"]}/commits/${commit}/status?per_page=100`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${process.env["GH_TOKEN"]}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!res.ok) throw new Error(`status of ${commit}: HTTP ${res.status}`);
  const combined = await res.json();
  return combined.statuses?.find((st) => st?.context === `app-store/${tag}`)?.state ?? null;
}

async function main() {
  const mode = process.argv[2];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const releases = parseReleases(process.env["RELEASES"]) ?? new Set();
  if (mode === "prepare") {
    const version = process.env["APP_VERSION"] ?? "";
    let build = process.env["BUILD_NUMBER"] ?? "";
    if (!SEMVER.test(version) || !/^\d*$/.test(build)) {
      throw new Error("APP_VERSION must be a version and BUILD_NUMBER a number or empty");
    }
    const api = client();
    let decision;
    try {
      const appId = await findAppId(api);
      build ||= (await latestBuild(api, appId, version)) ?? "";
      decision = build
        ? await prepare({
            api,
            appId,
            target: { version, build },
            releases,
            sleep,
            log: console.info,
          })
        : { action: "fail", reason: `no processed build of ${version} in App Store Connect` };
    } catch (error) {
      // Transient errors leave no outcome, which the submit job records as pending.
      if (!isPermanent(error)) throw error;
      decision = { action: "fail", reason: error.message };
    }
    const target = { version, build };
    for (const warning of decision.warnings ?? []) console.warn(`::warning::${warning}`);
    output({ outcome: decision.action, reason: decision.reason, build });
    summary(`### App Store review\n- ${HEADLINE[decision.action]}: ${decision.reason}`);
    if (decision.action === "fail") {
      console.error(
        `::error::${decision.reason}. A person must resolve it in App Store Connect (docs/store-distribution.md, "Submission deferred or blocked").`,
      );
      process.exit(1);
    }
    if (decision.action === "defer") {
      console.info(
        `::notice::App Store submission of ${target.version} deferred: ${decision.reason}. ios-submission-catch-up.yml submits it once the way is clear.`,
      );
    }
    return;
  }
  if (mode === "check") {
    const candidates = parseCandidates(process.env["CANDIDATES"]);
    if (candidates.length === 0) throw new Error("CANDIDATES holds no release");
    const result = await checkCatchUp({
      api: client(),
      candidates,
      releases,
      requested: process.env["REQUESTED"] ?? "",
      inFlight: (process.env["IN_FLIGHT"] ?? "").split(/\s+/).filter(Boolean),
      stateOf: appStoreState,
    });
    for (const warning of result.warnings) console.warn(`::warning::${warning}`);
    output(result.values);
    console.info(`${result.values.tag ?? ""} ${result.values.outcome}: ${result.values.reason}`);
    return;
  }
  throw new Error("usage: app-store-submission.mjs prepare|check");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
/* c8 ignore stop */
