/**
 * Provider-neutral anti-abuse challenge interface.
 *
 * Poisoning / scripted-submission prevention has two live layers configured at the Cloudflare edge
 * today (a per-IP rate limit on the research routes + Bot Fight Mode; see the survey-abuse-controls
 * record). This interface adds a swappable, in-app challenge layer used at token-issue time so the
 * choice of provider (Cloudflare Turnstile today; hCaptcha / a Durable-Object proof-of-work later)
 * is a one-line change and never leaks into the ingestion logic.
 *
 * Privacy note: the challenge verifier never sends the visitor's IP to the provider (the optional
 * `remoteip` field is deliberately omitted), consistent with the no-IP-storage promise.
 */

import { isProductionDeployment, type DeploymentEnv } from "./environment";

/** Verifies an anti-abuse challenge solution. */
export interface ChallengeVerifier {
  /** Resolve true when the solution is valid (or when no challenge is configured). */
  verify(solution: string | null): Promise<boolean>;
  /** Whether a challenge is actually enforced (false = inert pass-through). */
  readonly enforced: boolean;
}

/** No challenge configured: pass through. The edge rate-limit + Bot Fight remain the live defence.
 *  Used in NON-PRODUCTION only — see DenyAllVerifier for the production fail-closed counterpart. */
export class AllowAllVerifier implements ChallengeVerifier {
  readonly enforced = false;
  async verify(): Promise<boolean> {
    return true;
  }
}

/** Production fail-closed stand-in when NO challenge provider is configured: reject everything rather
 *  than mint tokens without an anti-abuse challenge. Never falls back to a pass-through in production. */
export class DenyAllVerifier implements ChallengeVerifier {
  readonly enforced = true;
  async verify(): Promise<boolean> {
    return false;
  }
}

/** Cloudflare Turnstile server-side verification (siteverify). */
export class TurnstileVerifier implements ChallengeVerifier {
  readonly enforced = true;
  constructor(
    private readonly secret: string,
    private readonly endpoint = "https://challenges.cloudflare.com/turnstile/v0/siteverify",
  ) {}

  async verify(solution: string | null): Promise<boolean> {
    if (!solution) return false;
    try {
      const body = new URLSearchParams({ secret: this.secret, response: solution });
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) return false;
      const outcome = (await res.json()) as { success?: boolean };
      return outcome.success === true;
    } catch {
      // Fail closed: an unreachable verifier means we cannot prove the solution, so reject.
      return false;
    }
  }
}

/** Env fields the resolver reads (a slice of the Pages Function Env). Includes the deployment-signal
 *  fields so the resolver can fail closed in production without a separate argument. */
export interface ChallengeEnv extends DeploymentEnv {
  TURNSTILE_RESEARCH_SECRET?: string;
}

/**
 * Pick the challenge verifier from the environment: Turnstile when `TURNSTILE_RESEARCH_SECRET` is set. When it
 * is NOT set the fallback depends on the deployment: a NON-PRODUCTION build gets an inert pass-through
 * so preview/local works without provisioning a provider; a PRODUCTION deployment gets a DenyAll
 * verifier — it must not mint tokens without an anti-abuse challenge (fail closed).
 *
 * @param failClosedWhenUnset - override the production decision (defaults to isProductionDeployment).
 *   The token endpoint passes this explicitly so it stays in step with its own fail-closed posture.
 */
export function resolveChallengeVerifier(
  env: ChallengeEnv,
  failClosedWhenUnset: boolean = isProductionDeployment(env),
): ChallengeVerifier {
  if (env.TURNSTILE_RESEARCH_SECRET) return new TurnstileVerifier(env.TURNSTILE_RESEARCH_SECRET);
  return failClosedWhenUnset ? new DenyAllVerifier() : new AllowAllVerifier();
}
