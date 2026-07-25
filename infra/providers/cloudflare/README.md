# Cloudflare infrastructure (non-secret)

Machine-readable, **non-secret** infrastructure-as-code register for the how2vote.au Cloudflare
Pages deployment.

Governing principle: **FAIL CLOSED**. A missing, placeholder, or stale production configuration must
_fail the deploy_ — never warn and continue.

## What lives here

| File                     | Purpose                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `config-policy.json`     | The required production ids (by **reference** only), secret references, preview-isolation rules, and the placeholder patterns the guard rejects. |
| `migration-registry.json`| Each D1 migration in `apps/web/migrations/` pinned by SHA-256. Generated; drift-gated in CI; the applied set is checked against it at deploy. |
| `README.md`              | This file.                                                                                 |

## No secrets, ever

Nothing in this directory (or in `apps/web/wrangler.toml`) contains a secret **value** or a live
production id. Both hold **references** — the names of the GitHub Actions variables/secrets and
Cloudflare secrets that carry the real values:

- Live resource ids (`CF_D1_DATABASE_ID`, `CF_KV_RESEARCH_NONCES_ID`, `CLOUDFLARE_ACCOUNT_ID`) are
  GitHub Actions **variables**, injected into the wrangler placeholders at deploy time.
- Credentials (`CLOUDFLARE_API_TOKEN`, `CF_D1_API_TOKEN`, `RESEARCH_TOKEN_SECRET`, `ALTCHA_HMAC_SECRET`,
  `EMAIL_API_TOKEN`, `EMAIL_ACCOUNT_ID`) are GitHub Actions **secrets** / Cloudflare **secrets**,
  never rendered into any committed file.

The account id is not sensitive (it appears in every dashboard URL) but is still never hardcoded.

`scripts/check-infra-config.mjs` (committed mode) fails CI if a live id or secret-shaped value ever
lands in the tracked config; the deploy mode fails the deploy if any required id is still a placeholder.

## One-time operator setup

Requires Cloudflare account access:

```sh
wrangler d1 create how2vote-research                 # copy the returned database_id
wrangler kv namespace create RESEARCH_NONCES         # + --preview for the preview namespace
wrangler pages secret put RESEARCH_TOKEN_SECRET      # HMAC signing secret (submission tokens)
wrangler pages secret put ALTCHA_HMAC_SECRET         # self-hosted challenge secret (openssl rand -hex 32)

# Optional — self-hosted forms relay (Cloudflare Email Sending):
wrangler email sending enable send.how2vote.au       # one-time onboarding of the DEDICATED sending
                                                      # subdomain — never the apex (how2vote.au is a
                                                      # hardened no-mail domain: null SPF/MX, DMARC
                                                      # p=reject/sp=reject; see wrangler.toml NOTE)
wrangler pages secret put EMAIL_API_TOKEN            # token scoped to Email Sending only
wrangler pages secret put EMAIL_ACCOUNT_ID           # account id (injected, not committed)
```

Then set the repo variables (`CF_D1_DATABASE_ID`, `CF_KV_RESEARCH_NONCES_ID`,
`CF_D1_PREVIEW_DATABASE_ID`, `CF_KV_RESEARCH_NONCES_PREVIEW_ID`, `CLOUDFLARE_ACCOUNT_ID`) and the
secrets (`CLOUDFLARE_API_TOKEN`, `CF_D1_API_TOKEN`). Preview and production **must** use separate D1
databases and KV namespaces — the deploy guard rejects equal production/preview ids.

## Migration checksum registry

Regenerate the registry after adding or editing a migration:

```sh
pnpm infra:migrations:generate   # scripts/check-migration-registry.mjs --write
```

CI runs the check mode (`pnpm infra:migrations:verify`) and fails on any drift between the committed
`.sql` files and the registry. At deploy, after `wrangler d1 migrations apply`, the **applied** set is
compared to the registry — a drift (an unpinned or un-applied migration) fails the deploy closed.

### Reconciling the applied set after a history consolidation (one-time)

The `d1_migrations` bookkeeping table on a **live** database records every migration name that has ever
been applied to it. If the repo's migration history is ever _consolidated_ — several historical
migrations collapsed into a single idempotent baseline — a long-lived database will still carry the old
names, and the deploy-time applied-set check will fail closed (the live names are no longer pinned).

This happened once, on **2026-07-18**: the research schema was consolidated from the original
`0001`–`0006` into a single idempotent `0001_research.sql` (the exact net result — all statements
`CREATE … IF NOT EXISTS`). The live production database still listed `0001`–`0006` as applied, so
`Verify applied migrations match the checksum registry` blocked the deploy on the unpinned
`0002`–`0006`.

Reconciling is **bookkeeping-only and safe**: the live schema already equals what the consolidated
`0001` produces (the `Verify production research schema is aggregate-only` gate confirms the live table
set on every deploy), and `0001` is fully idempotent, so trimming the stale names changes no schema and
touches no counter data. Verify first, then reduce the applied set to the pinned baseline (run in the
Cloudflare dashboard D1 console, or via `wrangler d1 execute … --remote`):

```sql
-- 1. Inspect: expect the stale, now-unpinned names alongside the baseline.
SELECT id, name, applied_at FROM d1_migrations ORDER BY id;
-- 2. Sanity-check the live schema is only the aggregate counter tables + v_public_* views.
SELECT type, name FROM sqlite_master WHERE type IN ('table','view') ORDER BY type, name;
-- 3. Reconcile: keep only the pinned baseline migration(s).
DELETE FROM d1_migrations WHERE name <> '0001_research.sql';
-- 4. Confirm: expect exactly the pinned baseline.
SELECT name FROM d1_migrations;
```

Then re-run the deploy — the applied set now matches the registry. This is a rare, deliberate operator
action, not part of a normal deploy; a routine new migration is added to `apps/web/migrations/`,
pinned with `pnpm infra:migrations:generate`, and applied automatically by `wrangler d1 migrations
apply` at deploy.
