/**
 * Self-hosted ALTCHA proof-of-work bridge — the client half of the anti-abuse challenge.
 *
 * No third-party script, iframe or endpoint is involved: the challenge is fetched from OUR OWN
 * `/api/challenge` Pages Function and solved on-device
 * with the bundled altcha-lib solver (MIT), then the base64 `{challenge, solution}` payload is sent
 * to the receiving endpoint (`/api/research/token` or `/api/forms`) as the `challenge` field for
 * in-process server verification. See src/lib/research/challenge.ts for the whole mechanism.
 *
 * Invisible to the user: no puzzle, no interaction, no accessibility barrier — just a sub-second
 * background computation on submit. The solver yields to the event loop while it works, so the UI
 * stays responsive.
 *
 * Loaded LAZILY — the solver module is dynamic-imported only the first time a solution is requested
 * (i.e. when someone actually submits), so nothing competes with hydration on the LCP path and a
 * visitor who never submits never runs it. Nothing here runs on page load, issues a cookie, or
 * talks to any origin but our own.
 *
 * Offline PWA note: callers short-circuit to "offline" before a solution is requested, so a missing
 * connection never reaches this module; a failed challenge fetch while nominally online rejects and
 * is handled as an ordinary submit error.
 */
import { browser } from "$app/environment";
import { isNativeShell } from "./channel";
import { SITE_URL } from "./seo";

/** What the solution will be spent on. Signed into the challenge by the server and enforced at
 *  verification, so a solution can never be spent on a different path. */
export type ChallengePurpose = "research" | "contact" | "feedback";

// Web PWA: same-origin relative path (connect-src 'self'). Native shells serve from a local WebView
// origin, so the challenge is fetched from the canonical origin (allowed by the endpoint's strict
// CORS allowlist), mirroring the research transport (see survey.ts / cors.ts).
const CHALLENGE_ENDPOINT = `${isNativeShell ? SITE_URL : ""}/api/challenge`;

/** Give slow devices ample room while still bounding a pathological challenge. The expected solve
 *  is well under a second; the challenge itself expires server-side after 10 minutes. */
const SOLVE_TIMEOUT_MS = 30_000;
/** Bound the network round-trip so a captive portal or half-open connection (where navigator.onLine
 *  is still true) can't leave the submit button stuck on "Sending…" forever. */
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Obtain a challenge solution for a purpose: fetch a signed challenge, solve it on-device, return
 * the base64 payload the server verifies.
 *
 * Returns undefined ONLY when there is genuinely nothing to solve — not in the browser, or the
 * challenge layer is not provisioned (HTTP 204) / the Functions aren't deployed (404). In those
 * cases the caller posts without a solution and the server's verifier decides.
 *
 * REJECTS on any real failure — a 4xx/5xx that isn't 404 (e.g. 429 rate-limited, 5xx), a network
 * error/timeout, or a challenge that can't be solved in time — so the caller surfaces a genuine,
 * retryable error rather than silently proceeding tokenless (which in production is an automatic
 * refusal the user would see as an unexplained failure).
 */
export async function solveChallenge(purpose: ChallengePurpose): Promise<string | undefined> {
  if (!browser) return undefined;
  const res = await fetch(CHALLENGE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ purpose }),
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  // 204 = challenge layer not provisioned; 404 = Functions not deployed (static preview). Either
  // way there is nothing to solve — degrade to no solution. Any OTHER non-ok status (429/5xx) is a
  // real, transient failure: throw so the caller reports it rather than posting tokenless.
  if (res.status === 204 || res.status === 404) return undefined;
  if (!res.ok) throw new Error(`Challenge request failed (${res.status})`);
  const body = (await res.json()) as { challenge?: unknown };
  const challenge = body.challenge;
  if (typeof challenge !== "object" || challenge === null) return undefined;

  // Lazy-load the solver only now, on first actual use.
  const { solvePow } = await import("./pow-solver");
  const solution = await solvePow(challenge as Parameters<typeof solvePow>[0], SOLVE_TIMEOUT_MS);
  if (!solution) throw new Error("Anti-abuse challenge could not be solved in time");
  return btoa(JSON.stringify({ challenge, solution }));
}
