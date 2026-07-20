/**
 * Runtime "is this a production deployment?" signal for the research Cloudflare Pages Functions.
 *
 * The research ingestion + token endpoints must FAIL CLOSED in production: if a mandatory integrity
 * control (token signing secret, anti-abuse challenge, an atomic single-use nonce store, the research
 * database) is missing, the endpoint must refuse rather than silently drop or accept unverified. The
 * inert/fail-open behaviour is kept ONLY for local/preview so `pnpm dev` and preview builds work
 * without provisioning secrets. This module is the single place that decides which mode we are in.
 *
 * Cloudflare Pages does not expose an automatic runtime environment name to a Function, so we derive
 * production from what the deployment actually carries, most explicit first:
 *
 *  1. An explicit `RESEARCH_ENVIRONMENT` var wins. "production"/"prod" ⇒ production; any recognised
 *     non-production name ("preview"/"development"/"dev"/"local"/"test") ⇒ NOT production, so a preview
 *     deployment (or a unit test) can opt into the inert behaviour deliberately.
 *  2. With no explicit marker we infer from the write binding: a bound `RESEARCH_DB` means this
 *     deployment can write to the research database, so it is a real deployment and must fail closed.
 *     This is the safe default — forgetting to set the marker in production still fails closed.
 *  3. Otherwise (no marker, no database — a local `pnpm dev` / vitest run) it is NOT production.
 *
 * The `RESEARCH_ENVIRONMENT = "production"` var is set in apps/web/wrangler.toml so deployed
 * environments are detected even without the RESEARCH_DB inference; a preview environment that wants
 * the inert behaviour overrides it to a non-production value.
 */

/** The subset of the Pages Function env this signal reads. Both fields are optional. */
export interface DeploymentEnv {
  /** Explicit environment marker; "production"/"prod" forces production, non-prod names force dev. */
  RESEARCH_ENVIRONMENT?: string;
  /** The research D1 binding. When present with no explicit marker, we infer a real deployment. */
  RESEARCH_DB?: unknown;
}

/** Recognised non-production environment names — an explicit opt-out of the fail-closed behaviour. */
const NON_PRODUCTION_NAMES = new Set(["preview", "development", "dev", "local", "test", "staging"]);

/**
 * Whether the endpoint is running in a production deployment (and must therefore fail closed on any
 * missing integrity control). See the module comment for the precedence rules.
 */
export function isProductionDeployment(env: DeploymentEnv): boolean {
  const marker =
    typeof env.RESEARCH_ENVIRONMENT === "string"
      ? env.RESEARCH_ENVIRONMENT.trim().toLowerCase()
      : "";
  if (marker === "production" || marker === "prod") return true;
  if (NON_PRODUCTION_NAMES.has(marker)) return false;
  // No explicit marker: a bound research database means a real, writable deployment → fail closed.
  return env.RESEARCH_DB !== null && env.RESEARCH_DB !== undefined;
}
