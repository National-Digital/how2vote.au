#!/usr/bin/env node
/**
 * @fileoverview Fail-fast check that the Play service account can actually PUBLISH.
 *
 * Google enforces publish rights at the END of an edit, not on the individual calls: a service
 * account without publish rights can create an edit, upload a bundle, rewrite the listing and set
 * a track, and is refused only when the edit is finally applied — minutes into a release run,
 * after the bundle is already built.
 *
 * This probe front-runs that. It stages a REAL listing change in a throwaway edit and calls
 * `:validate`, which applies nothing but is refused with the same 403 when publish rights are
 * missing. The edit is deleted either way, so the live listing, the tracks and the release history
 * are never touched.
 *
 * Usage:
 *   PLAY_SERVICE_ACCOUNT_JSON='{...}' node scripts/check-play-permission.mjs
 *   PLAY_SERVICE_ACCOUNT_FILE=key.json node scripts/check-play-permission.mjs
 *
 * Exit codes: 0 permitted · 1 refused, the probe could not run, or no credential is configured.
 * There is deliberately no green "skipped" outcome: this probe's whole job is to notice that the
 * account can no longer publish, and a vanished credential is one of the ways that happens.
 */
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

const PACKAGE = "au.how2vote.app";
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3";
/** Marker text staged during the probe. Never committed — the edit is always discarded. */
const PROBE_TEXT = "permission probe — never committed";

function loadKey() {
  const inline = process.env["PLAY_SERVICE_ACCOUNT_JSON"];
  const file = process.env["PLAY_SERVICE_ACCOUNT_FILE"];
  const raw = inline?.trim() ? inline : file ? readFileSync(file, "utf8") : "";
  if (!raw.trim()) return null;
  const key = JSON.parse(raw);
  if (!key.client_email || !key.private_key)
    throw new Error("key JSON lacks client_email/private_key");
  return key;
}

const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");

async function accessToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 600,
  })}`;
  const assertion = `${input}.${createSign("RSA-SHA256").update(input).sign(key.private_key, "base64url")}`;
  // Form body built by hand: URLSearchParams is not in the scripts ESLint globals allowlist.
  const form =
    `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}` +
    `&assertion=${encodeURIComponent(assertion)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const body = await res.json();
  if (!body.access_token)
    throw new Error(`token exchange failed: ${body.error_description ?? res.status}`);
  return body.access_token;
}

const key = loadKey();
if (!key) {
  // FAIL CLOSED. A missing credential is not "nothing to check" — it is the drift this probe
  // exists to catch. Both callers (the daily probe and the android-release preflight) are only
  // meaningful when a credential exists, and a green tick for "I could not look" is exactly the
  // misleading signal this probe exists to prevent.
  console.error(
    "Play permission check FAILED — no service-account credential configured.\n" +
      "Set the PLAY_SERVICE_ACCOUNT_JSON secret (Settings → Secrets and variables → Actions),\n" +
      "or pass PLAY_SERVICE_ACCOUNT_FILE=key.json when running this locally.",
  );
  process.exit(1);
}

const token = await accessToken(key);
const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const app = `${API}/applications/${PACKAGE}`;

const insert = await fetch(`${app}/edits`, { method: "POST", headers: H });
const edit = await insert.json();
if (!edit.id) {
  console.error(
    `::error::Play API refused to open an edit: ${edit.error?.message ?? insert.status}`,
  );
  process.exit(1);
}

let verdict;
try {
  // Stage a genuine listing diff. An edit with no changes validates and commits successfully even
  // WITHOUT publish rights, so a no-op probe would report a false pass.
  const current = await (
    await fetch(`${app}/edits/${edit.id}/listings/en-AU`, { headers: H })
  ).json();
  await fetch(`${app}/edits/${edit.id}/listings/en-AU`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({
      language: "en-AU",
      title: current.title ?? "How2Vote",
      shortDescription: PROBE_TEXT,
      fullDescription: current.fullDescription ?? PROBE_TEXT,
      video: current.video ?? "",
    }),
  });
  const res = await fetch(`${app}/edits/${edit.id}:validate`, { method: "POST", headers: H });
  verdict = {
    ok: res.ok,
    status: res.status,
    message: res.ok ? "" : (await res.json()).error?.message,
  };
} finally {
  // Always discard, including on an unexpected throw — an abandoned edit would block later ones.
  await fetch(`${app}/edits/${edit.id}`, { method: "DELETE", headers: H }).catch(() => undefined);
}

if (verdict.ok) {
  console.info(`Play publish permission OK — the service account can apply edits to ${PACKAGE}.`);
  process.exit(0);
}

console.error(`::error::Play publish permission MISSING (${verdict.status}: ${verdict.message}).`);
console.error(`
The service account can prepare changes but not apply them, so a release will build, upload and
then fail at the final commit. Google enforces this at the end of the edit, which is why the whole
job has to run before the error appears — this check exists to surface it in seconds instead.

Fix in Play Console → Users and permissions → the configured service account
  → App permissions → How2Vote → grant BOTH:
       • Release to testing tracks   (publishing a build to internal/closed/open)
       • Manage store presence       (listing text, icon, screenshots, feature graphic)
  → Apply, then Save changes on the user page (an unsaved grant looks set but does nothing).

Verify locally with:  PLAY_SERVICE_ACCOUNT_FILE=key.json node scripts/check-play-permission.mjs
`);
process.exit(1);
