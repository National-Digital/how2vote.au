# Research data threat model

Status: **In-code controls implemented; several controls are operational/deployment tasks still to
confirm (marked below).** Concerns the security of research data. Companion to
`docs/privacy/data-flow.md`, `docs/privacy/pia.md`, and `docs/privacy/retention.md`. Updated for
ADR-0008 (aggregate counters): the store holds **no per-person rows**, which retires the former
headline asset (the answer-vector fingerprint) and reshapes several threats below.

This is a lightweight threat model for the opt-in research dataset only. Scope is the research
store and its two ingestion endpoints. The card, scoring and share flow are out of scope: they are
client-side and send no personal data (the share fragment is never received by the server or
analytics — Privacy Policy §4).

Legend for control status:

- **[code]** — implemented in this repository and covered by tests.
- **[ops]** — a deployment/configuration control that must be set up and signed off before launch; not
  enforced by code in this repo.

## Assets

| Asset | Sensitivity | Why it matters |
|-------|-------------|----------------|
| Research counters (`demographic_count` etc.) | **Medium** — group counts over sensitive categories | No per-person row exists. Residual value to an attacker is a **small cell**: a count of 1–k in a rare bucket is attribute disclosure against someone *known to have contributed*. Key rule caps the worst row at national scope for sensitive dimensions. |
| The in-flight `POST /api/research` request | **High, transient** | The one place a full derived profile (match + stances + demographics + state) exists, for milliseconds. Not an at-rest asset — unless a log captures it (T6). |
| `geography_count` tally | Low | Aggregate integer counts per electorate; no link to anything. |
| Published `stats/*.json` | Low (intended public) | Already k≥10-suppressed per cohort; risk is a disclosure-control failure, not a store breach. |
| D1 credentials / API token | Medium (capability) | `CF_D1_API_TOKEN` etc. grant read of the counters — a much smaller prize than the former row-level store. |

## Actors and threats

### T1 — Insider with database access
An operator or contractor with D1 access (or the build token) reads the raw counters.
- **Residual risk: small cells.** A mid-collection count of 1 in a rare bucket says something about
  a person known to have participated. No vector, no record, nothing to re-identify beyond that.
- Mitigations: aggregate-only storage **[code]**; key rule — no opinion × sensitive attribute ×
  sub-national geography in one counter **[code, test-pinned]**; least-privilege, named access and
  an access audit/log **[ops]**; contractual no-re-identification terms (Privacy Policy) **[ops]**.

### T2 — Breach / exfiltration of the store
External compromise of D1 or leak of the API token dumps the counters.
- Mitigations: the dump is group counts — no identifiers, no vectors, no per-person rows, no
  per-request bundle, and no timestamp finer than a quarter exist to take **[code]**; token scoped
  to the research database only and rotated **[ops]**; separate credentials for prod ingestion vs.
  the stats read vs. any admin access **[ops]**; encryption in transit (HTTPS/D1) **[ops]**.
- Assess in the PIA/breach plan whether a counters-only leak reaches the NDB "personal
  information" threshold at all.

### T3 — Correlating the two endpoints (re-joining electorate to a contribution)
An attacker who can see both endpoints' writes tries to re-link electorate to a contribution via
**insertion order, timing, or IP**.
- Mitigations: there is no per-person row on either side to link **to** — both sides are
  incrementing integers **[code]**; the electorate travels on a separate request that shares no key
  **[code]**; no IP is read on either endpoint and no fine timestamp is stored **[code]**; uniform
  `204` on both **[code]**. Residual: an insider watching request-level logs *in real time* could
  correlate the two requests in flight — hence "no research bodies/metadata in logs" is an **[ops]**
  control (T6).

### T4 — Re-identification via a distinctive combination
No breach needed: a person recognises themselves or another from a distinctive combination in an
under-suppressed publication — or from a small cell in the raw counters (T1).
- Mitigations (publish side): k ≥ 10 cell suppression **per cohort** (counters are cohort-keyed at
  ingestion, so cohort filtering can never surface a sub-k cell), board hidden < 50 responses,
  `shown` = sum of surviving cells (no subtraction attack), one dimension per view, no
  electorate-level publication, party keys outside the compiled dataset never published **[code]**;
  **snapshot differencing gate** — a stats file is only replaced when ≥ k new responses have
  accrued, so successive published snapshots can never be differenced below k **[code]**; higher
  thresholds / category collapsing reserved for higher-risk cells **[ops/policy]**.
- Mitigations (input side): coarse buckets only; sensitive dimensions national-only **[code]**.
- Residual: acknowledged and disclosed in construction language ("aggregate-only by construction",
  never "anonymous" — codebook; Privacy Policy). A formal assessment on the real data environment
  is a **practitioner sign-off** item (see `pia.md` §3).

### T5 — Differencing the geography tally against the research counters
Attacker differences `geography_count` totals against the research counters to relocate electorate
onto attributes.
- Mitigations: the tally carries **only a count** — no attribute, no cohort, no date — and no
  research counter carries an electorate, so there is no shared dimension to difference on
  **[code]**. Confirming this holds in the real environment is a **practitioner sign-off** item.

### T6 — The in-flight profile leaking into operational logs / analytics
The one moment a full derived profile exists is inside the POST request; a capturing layer
(hosting logs, error tracer, analytics) would silently recreate a per-person record.
- Mitigations: research is a **same-origin** path with no third-party origin **[code]**; the
  endpoints emit no logging or exception reports and swallow errors behind a uniform `204`
  **[code]**; usage analytics is cookieless and measured at the Cloudflare edge (no client tag), and
  the site transmits **no** client-side error data at all (there is no error beacon or client-error
  endpoint), so no client sink receives quiz answers, weights, electorate, results, match, preference
  order, the share fragment, or survey answers, pinned by `e2e/consent.spec.ts` **[code]**. Ensuring
  the *hosting/CDN* layer captures no request bodies on `POST /api/research`, attaches no tracing, and
  keeps routine technical logs separated from the research dataset is **[ops]** — under counters this
  is the single most important operational control (all telemetry — edge analytics, any CDN tracing —
  not one product alone).

### T7 — Backup exposure / retention overrun
Deleted or old data survives in D1 point-in-time-recovery snapshots or exported backups; counters
outlive their windows.
- Mitigations: the counter retention rule + per-election sweep are documented and scripted
  (`retention.md`, `scripts/retention-sweep.sql`) **[code/doc]**; there is no delta/day-grained
  store to age out — the coarsest time anywhere is the collection quarter; any earlier per-person
  data was de-identified to counters and destroyed (ADR-0008) — the PIA §6 destruction record tracks
  confirming that any point-in-time / exported copies have aged out or been destroyed **[ops]**; **wiring the schedule** and
  a **tested backup-destruction / PITR-horizon** step are **[ops]** and explicitly outstanding.

### T8 — Malicious / bulk write (poisoning, injection)
Attacker floods the endpoint, fabricates party slugs, or tries to inject via field values.
- Mitigations: body-size caps, proposition-count cap, schema-version gate, allowlist/shape
  validation (no free text stored), static SQL with bound values only **[code]**; fabricated party
  slugs are never published (dataset filter in the generator) **[code, test-pinned]**; live
  Cloudflare rate limit + Bot Fight Mode on `POST /api/research` **[ops]** (already configured —
  see project memory), with spike detection via Cloudflare request analytics **[ops]**. **No
  surgical excision:** a per-cell-per-time delta store would be the remediation path, but it would
  also be a temporary person-level record (a rare cell on a quiet day regroups by insertion order
  or shared cohort/state/party key), so it is deliberately **not** built (ADR-0008). A confirmed
  attack is met by prevention and, at worst, discarding the affected election's counters — poison
  below the publication gate (k ≥ 10 per cohort, 50-response board) never surfaces anyway.

## Controls summary

| Control | Status |
|---------|--------|
| Aggregate-only storage — no per-person row exists at rest | [code, test-pinned] |
| Raw answer vector/weights never transmitted (derived on device, payload v3) | [code, e2e-pinned] |
| Key rule: sensitive dimensions national-only; opinion never beside sensitive × sub-national | [code, test-pinned] |
| No IP / cookie / device id / token stored; `CF-Connecting-IP` never read | [code] |
| Electorate on a separate, keyless request; geography an incrementing integer | [code] |
| No timestamp finer than a quarter anywhere; no delta/per-request bundle; allowlist validation; uniform 204 | [code] |
| Per-cohort k ≥ 10 suppression, board < 50 hidden, no-leak denominator, no electorate view, dataset-checked party keys | [code] |
| Snapshot differencing gate on stats regeneration (≥ k new responses) | [code] |
| Poisoning: prevention (rate limit + Bot Fight) + infra detection; no in-DB delta store | [ops] |
| Analytics excludes all research/quiz/geo fields (test-pinned) | [code] |
| Retention sweep SQL + procedure (counters per election wave) | [code/doc] |
| Least-privilege D1 binding; separate prod/stats/admin credentials; token rotation | [ops] |
| Access audit/log for the counters; no request bodies/tracing on the research path | [ops] |
| Tested backup destruction / PITR horizon (incl. the transition drop expiry); scheduled sweep | [ops] |
| Formal residual-risk assessment on the real data environment | practitioner sign-off (`pia.md` §3) |
| Data-breach response + OAIC notification path (incl. counters-only threshold assessment) | [ops] (Privacy Policy §10) |
