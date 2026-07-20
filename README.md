<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/how2vote-wordmark-chalk.svg">
  <img src="docs/brand/how2vote-wordmark.svg" alt="how2vote" width="380">
</picture>

**Vote on their record.**

<!-- Workflows -->
[![CI](https://img.shields.io/github/actions/workflow/status/National-Digital/how2vote.au/ci.yml?branch=main&label=CI)](https://github.com/National-Digital/how2vote.au/actions/workflows/ci.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/National-Digital/how2vote.au/codeql.yml?branch=main&label=CodeQL)](https://github.com/National-Digital/how2vote.au/actions/workflows/codeql.yml)
[![Deploy](https://img.shields.io/github/actions/workflow/status/National-Digital/how2vote.au/deploy.yml?branch=main&label=deploy)](https://github.com/National-Digital/how2vote.au/actions/workflows/deploy.yml)

<!-- Guarantees enforced in CI. Each is the live status of the workflow that checks it, so a
     guarantee reads red whenever its parent workflow fails (whole-workflow granularity, not per-job). -->
[![neutrality](https://img.shields.io/github/actions/workflow/status/National-Digital/how2vote.au/ci.yml?branch=main&label=neutrality)](https://github.com/National-Digital/how2vote.au/actions/workflows/ci.yml)
[![privacy](https://img.shields.io/github/actions/workflow/status/National-Digital/how2vote.au/compliance.yml?branch=main&label=privacy)](https://github.com/National-Digital/how2vote.au/actions/workflows/compliance.yml)
[![accessibility](https://img.shields.io/github/actions/workflow/status/National-Digital/how2vote.au/compliance.yml?branch=main&label=accessibility)](https://github.com/National-Digital/how2vote.au/actions/workflows/compliance.yml)
[![legal](https://img.shields.io/github/actions/workflow/status/National-Digital/how2vote.au/compliance.yml?branch=main&label=legal)](https://github.com/National-Digital/how2vote.au/actions/workflows/compliance.yml)
[![provenance](https://img.shields.io/github/actions/workflow/status/National-Digital/how2vote.au/compliance.yml?branch=main&label=provenance)](https://github.com/National-Digital/how2vote.au/actions/workflows/compliance.yml)
[![supply-chain](https://img.shields.io/github/actions/workflow/status/National-Digital/how2vote.au/ci.yml?branch=main&label=supply-chain)](https://github.com/National-Digital/how2vote.au/actions/workflows/ci.yml)

<!-- Project meta -->
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](LICENSE)
[![DCO](https://img.shields.io/badge/DCO-sign--off%20required-blue.svg)](https://developercertificate.org/)
[![Last commit](https://img.shields.io/github/last-commit/National-Digital/how2vote.au)](https://github.com/National-Digital/how2vote.au/commits/main)
[![Open issues](https://img.shields.io/github/issues/National-Digital/how2vote.au)](https://github.com/National-Digital/how2vote.au/issues)
[![Node](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](package.json)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D11-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)

<!-- Product -->
[![Live: how2vote.au](https://img.shields.io/badge/live-how2vote.au-000000)](https://how2vote.au)
[![Data: They Vote For You](https://img.shields.io/badge/data-They%20Vote%20For%20You-6b21a8)](https://theyvoteforyou.org.au/)

An independent voting-record **comparison** tool for Australian federal elections.
You answer 50 propositions parliament has actually voted on; the tool shows how closely each
party's **recorded parliamentary votes** match your positions, against the candidates on your
ballot in official ballot order — then you build your own voting plan. Nothing is ranked by
score and no preference is recommended: you author your own preference order.

Built as a fully static, offline-capable PWA. No account, no server-side scoring, no tracking by
default — analytics is strictly opt-in.

</div>

---

## Why this exists

Comparisons are built from **revealed preference** — the votes members of parliament actually
cast, sourced from public Hansard data via [They Vote For You](https://theyvoteforyou.org.au/) — not
from campaign statements. The method is public, deterministic, and reproducible. Neutrality is enforced
by construction: the interface is strictly two-tone (ink on paper) with **no hue anywhere**, checked in
CI, so match quality can never be encoded as party colour.

Everything a user is shown is provable:

- Every proposition links to the parliamentary divisions behind it on They Vote For You.
- The scoring engine is a pure, dependency-free package with the specification's worked examples as
  immutable golden tests.
- The compiled vote dataset is deterministic, checksummed, published, and attributed.
- Your answers leave your device in exactly two ways, both identifier-free: the share link carries
  them in its URL **fragment** (never sent to any server — the recipient's device recomputes the
  card), and — only if you opt in — your device tallies its own result into the project's aggregate
  research counters (below). Your raw answers and weights never leave the device, and no per-person
  research record is created or stored.

## Monorepo layout

| Path | Package | Responsibility |
|------|---------|----------------|
| `packages/data-schema` | `@how2vote/data-schema` | Typed schemas + validators for the dataset; the build-time validation gate. |
| `packages/engine` | `@how2vote/engine` | Pure scoring engine, share-link codec, golden tests. |
| `packages/data-pipeline` | `@how2vote/data-pipeline` | TVFY → per-party positions compiler, AEC nominations fetcher, dataset build/validate CLI. |
| `apps/web` | `@how2vote/web` | SvelteKit (`adapter-static`) offline PWA — the six-screen flow. |
| `data/` | — | Curated source dataset and compiled, checksummed output shipped with the build. |

## Getting started

```sh
corepack enable          # provides the pinned pnpm
pnpm install
pnpm build               # build every package + the static site
pnpm test                # run all package tests (incl. golden methodology tests)
pnpm dev                 # start the web app
```

Node ≥ 24 and pnpm ≥ 11 (pinned via `packageManager`).

## Data pipeline

```sh
cp packages/data-pipeline/.env.example packages/data-pipeline/.env   # add your TVFY API key
pnpm data:fetch:tvfy     # fetch raw policies from They Vote For You
pnpm data:compile        # compile per-party positions (deterministic, checksummed)
pnpm data:fetch:aec      # fetch AEC candidate nominations (when an election is called)
pnpm data:validate       # schema + join-map resolution gate
```

Automation: the **Data refresh** workflow is dispatch-only — a manual run (`workflow_dispatch`) or a
`repository_dispatch` webhook refreshes the **TVFY** data during an election lead-up, commits the
checksummed output, and opens a PR. There is **no scheduled polling** of the TVFY API
([ADR-0005](docs/adr/0005-tvfy-snapshot-lock.md)). See `.github/workflows/data-refresh.yml`. **AEC
ballots are not refreshed automatically** — see [Manual steps](#manual-steps) below and
[ADR-0004](docs/adr/0004-aec-nominations-manual-ingestion.md).

> **What runs on `pnpm build`:** nothing fetches data. The build compiles the packages and the static
> site, which imports the committed, checksummed `data/dist/dataset.json`. Refreshing the underlying data
> is a separate step (the workflow above), decoupled from the build on purpose — the dataset is
> deterministic, checksummed, and committed for offline reproducibility and ODbL provenance.

## Manual steps

> **Adding a whole new election** (every ~3 years) is a distinct, larger operation than a data
> refresh — see the **[adding-an-election runbook](docs/adding-an-election.md)** for the authoritative
> end-to-end process. The steps below cover the recurring data refreshes within an existing election.

The pipeline is automated *except* for the following, which need a human:

1. **Configure secrets (one-time).** In the GitHub repo settings:
   - `TVFY_API_KEY` — required for the dispatched/webhook TVFY refresh; without it the refresh
     workflow runs but fetches nothing.
   - `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` — required for the deploy; without them the
     build still runs and the deploy step is skipped.
2. **Refresh AEC ballots at election time (every ~3 years).** The AEC only publishes candidate
   nominations — as CSV downloads with per-election URLs — once nominations are declared; there is no
   stable API or live feed to poll. When an election is called, run the **Data refresh** workflow
   manually and supply the two published CSV URLs:

   ```
   Actions → Data refresh → Run workflow
     aec_house_csv_url  = <AEC House nominations CSV URL>
     aec_senate_csv_url = <AEC Senate nominations CSV URL>
   ```

   The workflow fetches, rebuilds, validates, and opens a PR with the new ballots. This is a deliberate,
   reversible decision — see [ADR-0004](docs/adr/0004-aec-nominations-manual-ingestion.md).
3. **Review and merge the refresh PR.** Both TVFY and AEC refreshes land as PRs (never direct pushes),
   so a human always signs off on the checksum change before it ships.

## CI, integrity gates & deployment

Every pull request runs the following required checks (all must pass):

- **CI › quality** (`ci.yml`) — build, typecheck, unit tests, lint/format, the **dataset integrity
  gate** (`data:validate`), a **deterministic-rebuild** check (committed `data/dist` must match a fresh
  build from source), the **neutrality lint** (no non-monochrome colour in the built CSS), a gzipped-JS
  **performance budget**, and a dependency audit (fails on high/critical without a signed acceptance);
- **CI › snapshot-guard** — locked TVFY snapshots are immutable after lock (ADR 0005);
- **CI › secrets** — a gitleaks scan across the full history of every ref;
- **CI › e2e** — Playwright: the keyboard-only 50-question run, an offline shared-card open, and
  **axe-core** accessibility scans (zero WCAG 2 A/AA violations) on every screen;
- **Compliance** (`compliance.yml`) — the fail-closed control-register gate and the blocking
  *Accessibility and Product* group, in which **Lighthouse** now runs as a required check (its
  accessibility category is gated, not merely informational);
- **CodeQL** (`codeql.yml`) — static analysis; **DCO** (`dco.yml`) — sign-off check; **Dependency
  review** (`dependency-review.yml`) — PR dependency diff.

**Deployment** (`.github/workflows/deploy.yml`): every non-preview build (push to `main`, plus the
6-hourly schedule and manual dispatch) builds and publishes to **Cloudflare Pages**, behind the
fail-closed infra-config, aggregate-only-schema, migration-registry, release-manifest and dependency
gates; pull requests get an isolated `noindex` preview. Requires the `CLOUDFLARE_API_TOKEN` secret and
`CLOUDFLARE_ACCOUNT_ID` variable configured under [Manual steps](#manual-steps); without them the build
still runs and the deploy step is skipped.

**Data refresh** (`.github/workflows/data-refresh.yml`): dispatch-only — a manual run or a webhook
(there is no scheduled polling; ADR 0005). It fetches TVFY (needs the `TVFY_API_KEY` secret),
recompiles, validates, and opens a PR with the checksummed result. Trigger the webhook with:

```sh
gh api -X POST repos/National-Digital/how2vote.au/dispatches -f event_type=refresh-data
```

At election time, run the workflow manually (`workflow_dispatch`) with the published AEC nomination CSV
URLs to refresh the ballots.

## Self-hosting

The deploy is a plain `wrangler pages deploy` run from GitHub Actions against a fixed Cloudflare
account and project — there is **no** Cloudflare↔Git connection. So any fork can deploy to its own
Cloudflare account, database and previews purely by setting its own Actions secrets and variables;
nothing about the deployment is hard-wired to this repository.

**1. Create the Cloudflare resources** (once), then note the ids they print:

```sh
export CLOUDFLARE_ACCOUNT_ID=…                                   # your account id
export CLOUDFLARE_API_TOKEN=…                                    # a token that can create these

pnpm exec wrangler pages project create how2vote-au --production-branch main
pnpm exec wrangler d1 create how2vote-research                   # → CF_D1_DATABASE_ID
pnpm exec wrangler d1 create how2vote-research-preview           # → CF_D1_PREVIEW_DATABASE_ID
pnpm exec wrangler kv namespace create RESEARCH_NONCES           # → CF_KV_RESEARCH_NONCES_ID
pnpm exec wrangler kv namespace create RESEARCH_NONCES --preview # → CF_KV_RESEARCH_NONCES_PREVIEW_ID

# HMAC secret for single-use submission tokens — a Pages *project* secret, not a GitHub secret.
# The production deploy fails closed if it is absent.
pnpm exec wrangler pages secret put RESEARCH_TOKEN_SECRET --project-name how2vote-au
```

The Pages project name (`how2vote-au`) and D1 database name (`how2vote-research`) are set in
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) (`CF_PAGES_PROJECT`) and
[`apps/web/wrangler.toml`](apps/web/wrangler.toml) (`name`, `database_name`). Keep them or rename
them, but the names must match across both files. The real resource ids are never committed — they
are injected into `wrangler.toml` from the variables below at deploy time.

**2. Add the GitHub Actions secrets** (repo → *Settings → Secrets and variables → Actions → Secrets*):

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Deploy to Pages. Scope: *Cloudflare Pages → Edit*. |
| `CF_D1_API_TOKEN` | Apply migrations and read the live schema on deploy. Scope: *D1 → Edit*. May be the same token if it also carries D1 edit. |
| `TVFY_API_KEY` | They Vote For You API key for the data-refresh workflow. Optional — without it the refresh runs but fetches nothing. |

**3. Add the GitHub Actions variables** (same page, *Variables* tab):

| Variable | Purpose |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account id. |
| `CF_D1_DATABASE_ID` | Production research database id (from `wrangler d1 create`). |
| `CF_D1_PREVIEW_DATABASE_ID` | Preview research database id. |
| `CF_KV_RESEARCH_NONCES_ID` | Production nonce KV namespace id. |
| `CF_KV_RESEARCH_NONCES_PREVIEW_ID` | Preview nonce KV namespace id. |
| `PUBLIC_SITE_URL` | Canonical site URL; also the post-deploy smoke-test target. |
| `PUBLIC_CONTACT_FORM_ID` / `PUBLIC_FEEDBACK_FORM_ID` | Formspree form ids for the contact and feedback forms. |
| `PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key for the contact/feedback forms. |
| `PUBLIC_TURNSTILE_RESEARCH_SITE_KEY` | Cloudflare Turnstile site key for the survey (a separate widget from the forms one; its secret is the `TURNSTILE_RESEARCH_SECRET` Pages secret). |

With those set, a push to `main` (or a manual dispatch) deploys to production and pull requests get an
isolated `noindex` preview — the same pipeline this repo uses. If none of the Cloudflare values are
set the build still runs and the deploy step is skipped, so a fork can build and test with no
Cloudflare account at all.

**4. Configure the GitHub repository settings.** Because this is a public repo, anyone can open a PR —
which is welcome — but Actions usage must be gated so a PR can't run arbitrary code or churn
resources. At minimum set **Settings → Actions → General → "Fork pull request workflows from outside
collaborators" → "Require approval for all external contributors"**, keep the default workflow token
read-only, attach **no** self-hosted runners, and protect `main` with the required status checks. The
full settings walkthrough — the Actions security gate, fork-PR secret behaviour, branch protection,
SHA-pinned actions, and the security features that self-activate when the repo goes public — is in
[**docs/self-hosting.md**](docs/self-hosting.md).

> **Infrastructure is the mechanical part.** This app is built for a specific operator and
> jurisdiction — Australian federal elections, published as authorised electoral material. The
> fail-closed release profile ([`docs/legal/release-profiles.json`](docs/legal/release-profiles.json))
> blocks a public launch until operator-specific controls are satisfied: your own operator identity
> ([`apps/web/src/lib/operator.json`](apps/web/src/lib/operator.json)), electoral authorisation, privacy representations and
> legal review. Standing up the infrastructure is turnkey; running it as authorised electoral material
> in your name is not. A fork must also use its own name and branding — see
> [Brand and name](#brand-and-name).

## Research store & public insights

The research feature is **optional and opt-in** (18+), never automatic, and does not change your
result. If you opt in, your device derives its own result on-device and tallies it into the project's
**aggregate counters** — group counts only, with **no** per-person record, IP, cookie, device id, or
sub-day timestamp — via a same-origin Cloudflare Pages Function backed by D1
([ADR-0007](docs/adr/0007-same-origin-research-backend.md), [ADR-0008](docs/adr/0008-aggregate-counters.md)).
Your raw answers and weights never leave the device. Electorate is handled **separately**: it is sent
as its own separate request and kept only as a running tally with nothing attached, so no count ever
pairs electorate with a result or a survey answer. Optional demographic answers may be added; skipping
them simply leaves those dimensions blank.

The public [insights page](apps/web/src/routes/insights) shows aggregates only: `pnpm data:stats`
regenerates the per-election `static/stats/*.json` (plus an `index.json`) at deploy time with
**k-anonymity suppression** — a figure is published only once its group is large enough that no one in
it could be identified (≥ 10 responses — one threshold for every dimension), and the whole dashboard
stays hidden below a minimum response count.

## Licensing

This project carries **two** licences, because code and data are governed separately:

- **Source code — [AGPL-3.0-or-later](LICENSE).** Anyone who runs a modified version, including over a
  network, must make their source available under the same terms.
- **Compiled vote dataset — [ODbL v1.0](LICENSE-DATA.md).** The dataset is a Derivative Database of
  They Vote For You data (© OpenAustralia Foundation, ODbL to the extent the OpenAustralia
  Foundation has rights in it). Share-alike and attribution are
  obligations of that licence, not a choice. Attribution — *"Vote data © They Vote For You
  (OpenAustralia Foundation), ODbL"* — appears on every screen and print, and the compiled dataset is
  published with a data vintage and checksum.

Using the They Vote For You API for low-volume, non-commercial purposes is free and imposes **no**
obligation to publish application source code; publishing this code under AGPL is our own decision.

### Brand and name

We make **no registered trade-mark claim** over the **how2vote** name or marks. The name and
identity are protected through copyright in the original brand assets, the tort of passing off, and
the misleading-or-deceptive-conduct provisions of the Australian Consumer Law — not through any
registration.

The AGPL-3.0 licence applies to the software code. It does **not** grant permission to use the
**how2vote** or **National Digital** names, logos or brand marks (including the marks under
`docs/brand/` and `apps/web/static/`), or to imply endorsement by National Digital. If you fork or
redeploy this software, use your own name and branding, and make clear your version is not
how2vote and is not endorsed by or affiliated with National Digital.

Full brand rules — permitted logo use, colour/type/accessibility, fork attribution and who to
contact about brand confusion — are in [`BRAND.md`](BRAND.md).

## Provenance & integrity

The scoring engine is validated against a fixed set of worked examples as immutable golden tests, so
any change to scoring is a deliberate, versioned methodology bump surfaced in the app footer. Design
and data-pipeline decisions are recorded as ADRs in [`docs/adr/`](docs/adr/); the in-app
[methodology page](apps/web/src/routes/methodology) documents the scoring method for end users.
