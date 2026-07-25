/**
 * Self-hosted ALTCHA proof-of-work bridge — the client half of the anti-abuse challenge.
 *
 * Replaces the Cloudflare Turnstile bridge. There is NO third-party script, iframe or endpoint any
 * more: the challenge is fetched from OUR OWN `/api/challenge` Pages Function and solved on-device
 * with the bundled altcha-lib solver (MIT), then the base64 `{challenge, solution}` payload is sent
 * to the receiving endpoint (`/api/research/token` or `/api/forms`) as the `challenge` field for
 * in-process server verification. See src/lib/research/challenge.ts for the whole mechanism.
 *
 * The user experience is unchanged from Turnstile's invisible mode: no puzzle, no interaction, no
 * accessibility barrier — just a sub-second background computation on submit. The solver yields to
 * the event loop while it works, so the UI stays responsive.
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

/** What the solution will be spent on. Signed into the challenge by the server and enforced at
 *  verification, so a solution can never be spent on a different path. */
export type ChallengePurpose = "research" | "contact" | "feedback";

// Same-origin and relative, like the research endpoints: no env var needed, and the fetch stays
// within `connect-src 'self'`, inheriting the page's (HTTPS, in production) origin.
const CHALLENGE_ENDPOINT = "/api/challenge";

/** Give slow devices ample room while still bounding a pathological challenge. The expected solve
 *  is well under a second; the challenge itself expires server-side after 10 minutes. */
const SOLVE_TIMEOUT_MS = 30_000;

/**
 * Obtain a challenge solution for a purpose: fetch a signed challenge, solve it on-device, return
 * the base64 payload the server verifies. Returns undefined when not in the browser or when the
 * challenge layer is not provisioned (HTTP 204/4xx — the caller then posts without a solution and
 * the server's verifier decides); rejects only when the layer IS reachable but fetching or solving
 * failed, which callers treat as an ordinary submit error.
 */
export async function solveChallenge(purpose: ChallengePurpose): Promise<string | undefined> {
  if (!browser) return undefined;
  const res = await fetch(CHALLENGE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ purpose }),
    cache: "no-store",
    credentials: "omit",
  });
  // 204 = challenge layer not provisioned; 404 = Functions not deployed (static preview). Either
  // way there is nothing to solve — proceed without a solution rather than breaking the submit.
  if (res.status === 204 || !res.ok) return undefined;
  const body = (await res.json()) as { challenge?: unknown };
  const challenge = body.challenge;
  if (typeof challenge !== "object" || challenge === null) return undefined;

  // Lazy-load the solver only now, on first actual use (mirrors the old lazy api.js injection).
  const { solvePow } = await import("./pow-solver");
  const solution = await solvePow(challenge as Parameters<typeof solvePow>[0], SOLVE_TIMEOUT_MS);
  if (!solution) throw new Error("Anti-abuse challenge could not be solved in time");
  return btoa(JSON.stringify({ challenge, solution }));
}
