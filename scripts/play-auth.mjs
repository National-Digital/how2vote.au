/**
 * @fileoverview Service-account authentication for the Play Developer API.
 *
 * Shared by every caller that talks to androidpublisher (the publish-permission probe and the
 * live-version resolver) so the credential handling and the JWT exchange have one implementation
 * rather than one per script.
 *
 * Deliberately dependency-free: these run before `pnpm install` in some jobs, and a release-path
 * credential is the last place to widen the dependency surface.
 */
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

export const PACKAGE = "au.how2vote.app";
export const API = "https://androidpublisher.googleapis.com/androidpublisher/v3";

/**
 * The service-account key, from the inline secret or a file path.
 * @returns {{client_email: string, private_key: string} | null} null when no credential is configured
 */
export function loadKey() {
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

/**
 * An OAuth access token for the androidpublisher scope, via the JWT-bearer grant.
 * @param {{client_email: string, private_key: string}} key
 * @returns {Promise<string>}
 */
export async function accessToken(key) {
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
