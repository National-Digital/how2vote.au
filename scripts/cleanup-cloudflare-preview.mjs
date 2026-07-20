#!/usr/bin/env node
/**
 * @fileoverview Tear down the Cloudflare Pages preview for a closed/merged PR.
 *
 * The counterpart to scripts/deploy-cloudflare-pages.mjs: that script publishes
 * a `pr-<number>` preview on every PR push; this one removes every deployment
 * on that branch once the PR closes, so stale previews don't accumulate on the
 * project.
 *
 * Uses the Cloudflare REST API directly (Node's global fetch, no deps) rather
 * than wrangler, which has no "delete every deployment on a branch" command.
 *
 * Environment:
 *   CLOUDFLARE_ACCOUNT_ID  (required)
 *   CLOUDFLARE_API_TOKEN   (required — scoped token with "Cloudflare Pages: Edit")
 *   CF_PAGES_PROJECT       (default: how2vote-au)
 *   CF_PAGES_BRANCH        (required) — the preview branch to purge, e.g. pr-123.
 *                          Refuses to run against the production branch (main).
 *
 * Idempotent: deleting an already-gone deployment, or a branch with no
 * deployments, is a no-op success, so the workflow stays green on re-runs.
 *
 * Usage:
 *   CF_PAGES_BRANCH=pr-123 node scripts/cleanup-cloudflare-preview.mjs
 */

import { fileURLToPath } from "node:url";

const API_BASE = "https://api.cloudflare.com/client/v4";
const PRODUCTION_BRANCH = "main";

const project = process.env.CF_PAGES_PROJECT || "how2vote-au";
const branch = process.env.CF_PAGES_BRANCH;

/**
 * Build the Cloudflare auth header from the environment (scoped API token).
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {Record<string, string>}
 */
export function authHeaders(env) {
  if (env.CLOUDFLARE_API_TOKEN) {
    return { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` };
  }
  throw new Error("No Cloudflare credentials: set CLOUDFLARE_API_TOKEN.");
}

/**
 * Given a page of deployment records, return the ids to delete: every
 * deployment whose trigger branch matches the target preview branch. The
 * branch lives at `deployment_trigger.metadata.branch` in the API response.
 *
 * Exported (and pure) so the filtering contract can be unit-tested without a
 * live Cloudflare account.
 *
 * @param {Array<{id: string, deployment_trigger?: {metadata?: {branch?: string}}}>} deployments
 * @param {string} targetBranch
 * @returns {string[]}
 */
export function selectDeploymentsToDelete(deployments, targetBranch) {
  return deployments
    .filter((d) => d?.deployment_trigger?.metadata?.branch === targetBranch)
    .map((d) => d.id);
}

/**
 * Fetch every preview deployment for the project, following pagination.
 *
 * @param {string} accountId
 * @param {Record<string, string>} headers
 * @returns {Promise<Array<object>>}
 */
async function listPreviewDeployments(accountId, headers) {
  const perPage = 25;
  const all = [];
  for (let page = 1; ; page += 1) {
    const url = `${API_BASE}/accounts/${accountId}/pages/projects/${project}/deployments?env=preview&per_page=${perPage}&page=${page}`;
    const res = await fetch(url, { headers });
    const body = await res.json();
    if (!res.ok || body.success === false) {
      throw new Error(
        `Cloudflare API error listing deployments (page ${page}): ${res.status} ${JSON.stringify(body.errors ?? body)}`,
      );
    }
    const batch = body.result ?? [];
    all.push(...batch);
    if (batch.length < perPage) return all;
  }
}

/**
 * Delete a single deployment. `force=true` is required to remove the deployment
 * currently serving the branch alias.
 *
 * @param {string} accountId
 * @param {Record<string, string>} headers
 * @param {string} deploymentId
 */
async function deleteDeployment(accountId, headers, deploymentId) {
  const url = `${API_BASE}/accounts/${accountId}/pages/projects/${project}/deployments/${deploymentId}?force=true`;
  const res = await fetch(url, { method: "DELETE", headers });
  // A 404 means it is already gone — treat as success (idempotent).
  if (res.ok || res.status === 404) return;
  const body = await res.json().catch(() => ({}));
  throw new Error(
    `Cloudflare API error deleting deployment ${deploymentId}: ${res.status} ${JSON.stringify(body.errors ?? body)}`,
  );
}

async function main() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) {
    console.error("❌ CLOUDFLARE_ACCOUNT_ID is not set.");
    process.exit(1);
  }
  if (!branch) {
    console.error("❌ CF_PAGES_BRANCH is not set (expected e.g. pr-123).");
    process.exit(1);
  }
  if (branch === PRODUCTION_BRANCH) {
    console.error(
      `❌ Refusing to delete deployments on the production branch (${PRODUCTION_BRANCH}).`,
    );
    process.exit(1);
  }

  const headers = authHeaders(process.env);

  console.info(`→ finding preview deployments for branch "${branch}" (project: ${project})`);
  const deployments = await listPreviewDeployments(accountId, headers);
  const ids = selectDeploymentsToDelete(deployments, branch);

  if (ids.length === 0) {
    console.info("✔ nothing to tear down — no deployments on that branch.");
    return;
  }

  console.info(`→ deleting ${ids.length} deployment(s) on "${branch}"`);
  for (const id of ids) {
    await deleteDeployment(accountId, headers, id);
    console.info(`  ✔ deleted ${id}`);
  }
  console.info(`✔ preview for "${branch}" torn down.`);
}

// Only run when invoked directly; importing (e.g. tests) just gets the helpers.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  });
}
