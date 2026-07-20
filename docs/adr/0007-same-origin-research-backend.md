# 0007 — A minimal same-origin research backend (Cloudflare Pages Functions + D1)

- Status: **Accepted** (reversible — the backend can be removed without affecting the card)
- Deciders: National Digital

This ADR decides the research *backend architecture* — same-origin Pages Functions + D1. The
*storage model* it uses (aggregate counters only, no per-person rows) is decided in
[ADR-0008](0008-aggregate-counters.md).

## Context

The site is a fully static, offline PWA scored entirely on the client, with a strict CSP that locks
`connect-src` to `'self'` and an explicit "no third-party origins" stance (`svelte.config.js`). The
card carries no server-side component; the only server surface the project needs is optional research.

The optional research survey collects opted-in demographic answers alongside the user's stance
summary and electorate, to study how views map to voting records in aggregate. Persisting those
opt-in contributions and building **public** aggregate dashboards from them both need somewhere to
store data; because the app is static, that has to happen over an API.

## Decision

**The one server-side component is Cloudflare Pages Functions backed by a Cloudflare D1 (SQLite)
database, served from the same origin as the site.** The survey POSTs to a relative `/api/research`
path; dashboards read from relative `/api/stats/*` paths (or from prebuilt static JSON derived from
D1). No third-party origin is introduced, so `connect-src 'self'` is unchanged.

The scope is deliberately narrow:

- The **card** is fully static, client-scored, and offline-capable. Nothing about the ballot,
  scoring, or share flow has a server dependency.
- The only server-side surface is **opt-in research ingestion and aggregate publishing**. If the
  backend is unavailable, the card is entirely unaffected (submission stays fire-and-forget).

The privacy policy describes this same-origin storage honestly and explains the k-anonymity
publishing rules. See the privacy page.

## Rationale

- **No third-party origin.** A same-origin Function keeps the published "no third-party origins" CSP
  promise intact with zero CSP/CORS changes — unlike a hosted Postgres/BaaS on a foreign hostname,
  which would either widen the CSP or require a proxy that reinvents this backend anyway.
- **No new vendor.** D1 + Pages Functions live in the existing Cloudflare account, repo, and
  `wrangler` deploy flow. $0 on the free tier; a $5/month ceiling in practice.
- **The join is already the survey's disclosed purpose.** Connecting demographics to results is not
  new scope — the payload already carries both and the privacy page already promises the analysis.
  What needed deciding was *where it is stored* and *how it is exposed*, not *whether* to join.
- **Integrity is preserved by keeping data separate and derived.** Research data lives in its own D1
  binding, distinct from the ODbL parliamentary dataset and its deterministic-rebuild gate. Raw
  submissions are never served; only suppressed aggregates are. This mirrors ADR-0003's instinct to
  quarantine weaker/private data behind a clean boundary.

## Consequences

- The project now operates a small amount of infrastructure (one D1 database, a handful of
  Functions, a scheduled aggregation job). Backups/retention become an operational concern.
- Political-preference data joined to demographics is sensitive personal information. Re-identification
  risk is real and is managed entirely on the **publish** side via k-anonymity and geographic
  coarsening, plus a strict "store no identifiers, no IP" rule on the **input** side.
- ADR-0003 declines self-reported candidate *scoring* data on integrity grounds; those objections are
  unrelated to this research store, which holds no scoring data and never feeds the card.
