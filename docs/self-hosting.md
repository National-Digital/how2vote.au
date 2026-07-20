# Self-hosting & forking how2vote

This guide is for **anyone running their own copy** of this codebase — a fork you develop against, or
a full redeploy to your own infrastructure. It covers the parts that live outside the code: the
**GitHub repository settings** that keep a public repo safe, and pointers to the Cloudflare
credentials the deploy needs.

The source is [AGPL-3.0-or-later](../LICENSE) and you are welcome to fork it. Two things a fork does
**not** get, and must supply for itself:

- **Brand & name.** The AGPL covers the code, not the *how2vote* / *National Digital* names, logos, or
  marks. Use your own — see [`BRAND.md`](../BRAND.md).
- **Operator identity & legal posture.** The app publishes as *authorised electoral material* for a
  specific operator and jurisdiction. The fail-closed release profile
  ([`docs/legal/release-profiles.json`](legal/release-profiles.json)) blocks a public launch until
  operator-specific controls (your own operator identity, electoral authorisation, privacy
  representations, legal review) are satisfied. Standing up the infrastructure is turnkey; running it
  as authorised electoral material in *your* name is not.

For local development (install, test, dev server) start with the [README](../README.md#getting-started).
For the Cloudflare deploy credentials, see [Deploy credentials](#deploy-credentials-cloudflare) below.

---

## GitHub repository settings

None of these can be set from code — they are repository settings a maintainer configures once in the
GitHub UI. They are the difference between "anyone can open a PR" (which we want) and "anyone can make
our CI run arbitrary code or drain resources" (which we don't). Set them **before** making the repo
public.

### Cost reality first

On **public** repositories, GitHub-hosted **standard** runners (`ubuntu-latest`, etc.) are **free with
no minute cap**. There are no billed minutes for an attacker to "drain". The real exposure on a public
repo is:

1. **Untrusted code execution** — a PR from a fork runs *its* workflow code. Contain what that code
   can reach (token scope, secrets, self-hosted runners).
2. **Larger / self-hosted runners** — these *are* billed and/or run on your own machines. A fork PR
   must never reach them.
3. **Noise & queue abuse** — spam PRs churning the Actions tab. Annoying, not billed; the approval
   gate below stops it.

### 1. Require approval for workflows on external PRs — the key gate

**Settings → Actions → General → "Fork pull request workflows from outside collaborators"** → select
**"Require approval for all external contributors."**

- Anyone can still **open** a PR. But **no workflow runs** on it until a maintainer clicks
  **"Approve and run"** on that run — and re-approves after each new push.
- The public-repo *default* is "Require approval for first-time contributors", which is weaker: a
  first PR gets one free run, and a returning contributor runs automatically thereafter. Prefer
  "all external contributors" for an election-integrity project.

This is the control that satisfies "anyone can open a PR, but Actions usage is gated." It is a real
security boundary. (Gating on **draft** status — e.g. `if: github.event.pull_request.draft == false`
— is *not*: the PR author controls the draft flag and can flip it instantly. Use draft-gating only to
reduce CI noise on your own WIP branches, never as protection.)

### 2. Default the workflow token to read-only

**Settings → Actions → General → "Workflow permissions"** → **"Read repository contents and packages
permissions"**, and **untick** "Allow GitHub Actions to create and approve pull requests."

Every workflow here already declares `permissions:` explicitly (`contents: read` at the top level,
elevated per-job only where a job genuinely writes). This setting is the safety net if a future
workflow forgets to.

### 3. Never attach a self-hosted runner to a public repo

**Settings → Actions → Runners** — there should be **none**. A fork PR's code would execute on a
self-hosted runner, i.e. on your own machine, with whatever that machine can reach. All workflows here
use GitHub-hosted runners; keep it that way on a public repo. For the same reason, don't move to
larger runners without keeping the external-PR approval gate from section 1 on.

### 4. Know how secrets behave on fork PRs (why previews are maintainer-gated)

All workflows trigger on `pull_request` (never `pull_request_target`), so a PR from a fork:

- runs with a **read-only** `GITHUB_TOKEN`, and
- **receives none of your Actions secrets** — `secrets.*` is empty for fork PRs.

That is by design and is why the **Cloudflare preview deploy is skipped for external PRs**: the deploy
job's own guard treats missing `CLOUDFLARE_API_TOKEN` as "not configured" and skips green, so a fork PR
can never use your deploy credentials. Previews therefore appear only on branches a maintainer pushes
to the repo directly. If you want external contributors to get previews, a maintainer can push their
branch to the repo (not merge it) to trigger one — never switch these workflows to
`pull_request_target`, which *would* expose secrets to untrusted PR code.

### 5. Protect `main` and require the CI checks

**Settings → Branches → Add branch ruleset (or classic rule) for `main`:**

- **Require a pull request before merging**, with **Require review from Code Owners**
  ([`.github/CODEOWNERS`](../.github/CODEOWNERS)).
- **Require status checks to pass before merging**, and mark the CI jobs as required. The
  compliance-workflow required checks are enumerated authoritatively in
  [`docs/legal/required-checks.json`](legal/required-checks.json) — copy every name in `requiredChecks`
  into the "required checks" box. Also require the core [`ci.yml`](../.github/workflows/ci.yml) jobs:
  *Lint · typecheck · test · build · integrity*, *E2E · keyboard, offline & axe*, *Secret scan
  (gitleaks)*, and *Locked snapshots are immutable*.
- **Require branches to be up to date before merging**, **Require linear history** (optional), and
  **Do not allow force pushes / deletions** on `main`.

`scripts/check-close-out.mjs` fails CI if the compliance workflow's jobs drift from
`required-checks.json`, so the manual setting can't silently fall behind the workflow — but marking the
checks *required* on the branch is still a one-time manual step.

### 6. Third-party actions are pinned to commit SHAs — enforced in CI

Every `uses:` in [`.github/workflows/`](../.github/workflows) is pinned to a full 40-character commit
SHA (with a `# vX` comment for readability), never a mutable tag or branch. A moved tag is a
supply-chain hole: it would run new, unreviewed code with this repo's token. **CI enforces this** — the
*Action-pinning gate* step in `ci.yml` runs [`scripts/check-action-pinning.mjs`](../scripts/check-action-pinning.mjs)
and fails the build on any unpinned reference, so it can't regress. Dependabot still proposes SHA
bumps, so updates keep flowing — they just go through review.

Optional extra hardening: **Settings → Actions → General → "Actions permissions"** can be narrowed to
*"Allow \<owner\>, and select non-\<owner\>, actions and reusable workflows"* with an explicit
allowlist, if you want to constrain which actions may be introduced at all.

### 7. Security features that self-activate when public

[`codeql.yml`](../.github/workflows/codeql.yml) (code scanning) and
[`dependency-review.yml`](../.github/workflows/dependency-review.yml) require a public repo (or GitHub
Advanced Security). Both are guarded on repository visibility: they **skip green while private and
switch themselves on when the repo goes public** — no edit needed. Also turn on **Settings → Code
security**: Dependency graph, Dependabot alerts, and secret scanning + push protection.

---

## Deploy credentials (Cloudflare)

The deploy is a plain `wrangler pages deploy` from GitHub Actions against your own Cloudflare account —
there is **no** Cloudflare↔Git connection, so a fork deploys to its own account purely by setting its
own Actions secrets and variables. The full step-by-step — creating the D1 database, KV namespace, and
Pages project, and the exact list of **secrets** and **variables** to add — is in the README:

➡️ **[README → Self-hosting](../README.md#self-hosting)**

The machine-readable, non-secret source of truth for which ids and secrets are required (names and
references only, never values) is
[`infra/providers/cloudflare/config-policy.json`](../infra/providers/cloudflare/config-policy.json),
enforced by `scripts/check-infra-config.mjs`:

- **Secrets** (repo → Settings → Secrets and variables → Actions → *Secrets*): `CLOUDFLARE_API_TOKEN`,
  `CF_D1_API_TOKEN`, and `TVFY_API_KEY` (optional — the data-refresh workflow runs without it but
  fetches nothing).
- **Variables** (same page, *Variables* tab): `CLOUDFLARE_ACCOUNT_ID`, `CF_D1_DATABASE_ID`,
  `CF_D1_PREVIEW_DATABASE_ID`, `CF_KV_RESEARCH_NONCES_ID`, `CF_KV_RESEARCH_NONCES_PREVIEW_ID`,
  `PUBLIC_SITE_URL`, `PUBLIC_CONTACT_FORM_ID`, `PUBLIC_FEEDBACK_FORM_ID`, `PUBLIC_TURNSTILE_SITE_KEY`,
  and `PUBLIC_TURNSTILE_RESEARCH_SITE_KEY`.
- **Cloudflare Pages project secrets** (not GitHub — set with `wrangler pages secret put`):
  `RESEARCH_TOKEN_SECRET` and `TURNSTILE_RESEARCH_SECRET`.

If none of the Cloudflare values are set, the build still runs and the deploy step skips, so a fork can
build and test with no Cloudflare account at all.

---

## Summary checklist

| Setting | Where | Value |
| --- | --- | --- |
| Approve workflows on external PRs | Actions → General | **All external contributors** |
| Default token permissions | Actions → General | Read-only; no PR create/approve |
| Self-hosted runners | Actions → Runners | **None** on a public repo |
| Branch protection on `main` | Branches | PR + Code Owners + required checks + no force-push |
| Required status checks | Branches | `required-checks.json` + core `ci.yml` jobs |
| Action SHA-pinning | *(enforced in CI)* | `scripts/check-action-pinning.mjs` |
| Code scanning / dependency review | *(auto on public)* | plus Dependabot + secret-scanning |
| Cloudflare secrets & variables | Actions → Secrets and variables | see [README](../README.md#self-hosting) |
