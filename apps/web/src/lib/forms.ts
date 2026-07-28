/**
 * Self-hosted form submission helper, shared by the per-page Feedback widget and the Contact page.
 * Both post to OUR OWN `POST /api/forms` Pages Function (functions/api/forms.ts), which verifies
 * the anti-abuse challenge and relays the message to the project inbox by email — it stores
 * nothing. No third-party origin is involved anywhere on the form path, which is also what makes
 * the forms shippable in the FOSS/F-Droid build.
 *
 * The site is an offline-first PWA. When there is no connection a POST cannot reach the endpoint,
 * so we detect that up front (`navigator.onLine`) and return an "offline" result the UI explains,
 * rather than letting the request hang or surfacing a raw network error.
 *
 * Both forms are protected by the self-hosted ALTCHA proof-of-work challenge (see $lib/altcha):
 * before each POST we solve the invisible, non-interactive challenge — purpose-bound per form —
 * and send its solution as the `challenge` field for server-side verification. The solver loads
 * lazily on that first solution request, so it never runs for someone merely browsing. A failed
 * solve is treated like any other submit error.
 */
import { isNativeShell } from "./channel";
import { SITE_URL } from "./seo";
import { solveChallenge, type ChallengePurpose } from "./altcha";

export type SubmitResult = "ok" | "offline" | "error";

// Web PWA: same-origin relative path. Native shells post to the canonical origin (allowed by the
// endpoint's strict CORS allowlist), mirroring the challenge fetch and the research transport.
const FORMS_ENDPOINT = `${isNativeShell ? SITE_URL : ""}/api/forms`;

/** Drops empty/undefined fields so optional inputs aren't posted as blank strings. */
function compact(fields: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    const trimmed = v?.trim();
    if (trimmed) out[k] = trimmed;
  }
  return out;
}

async function post(
  kind: ChallengePurpose & ("contact" | "feedback"),
  fields: Record<string, string | undefined>,
): Promise<SubmitResult> {
  // Primary offline signal for a PWA: don't even attempt the request when the browser knows it's
  // offline (e.g. opening a shared card at a polling place with no signal).
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  try {
    // Solve the invisible proof-of-work challenge; undefined when the challenge layer is not
    // provisioned (posts without it — the server's verifier decides). A solve failure throws here
    // and is handled as a generic submit error below.
    const challenge = await solveChallenge(kind);
    const res = await fetch(FORMS_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, ...compact(fields), ...(challenge ? { challenge } : {}) }),
      cache: "no-store",
      credentials: "omit",
      // Bound the round-trip so a captive portal / half-open connection can't hang "Sending…".
      signal: AbortSignal.timeout(20_000),
    });
    return res.ok ? "ok" : "error";
  } catch {
    // Network failure while nominally online (dropped connection, DNS, blocked request), or a
    // challenge that could not be solved.
    return "error";
  }
}

export function submitFeedback(fields: {
  message: string;
  name?: string;
  email?: string;
  page?: string;
}): Promise<SubmitResult> {
  return post("feedback", fields);
}

export function submitContact(fields: {
  name: string;
  email: string;
  message: string;
}): Promise<SubmitResult> {
  return post("contact", fields);
}
