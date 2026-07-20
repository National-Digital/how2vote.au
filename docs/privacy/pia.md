# Privacy Impact Assessment — how2vote research collection

Status: **Engineering assessment complete; residual-risk determination and APP sign-off require a
qualified Australian privacy practitioner before public launch** (ADR
[0006](../adr/0006-legal-compliance-rebuild.md), ADR
[0008](../adr/0008-aggregate-counters.md) — the store is aggregate counters, no per-person rows).
This document assesses the **built** system. Where a step is a legal/risk
judgement rather than an engineering fact it is marked **[requires practitioner sign-off before
launch]** rather than claimed as done.

"Launch" here means **product launch** — the live service beginning to accept research contributions
— not **repository publication**; making the source code public is not itself a launch and does not
require the sign-off, which is a precondition only for the live service collecting contributions.

Companion documents: `docs/privacy/data-flow.md` (hop-by-hop flows + diagram),
`docs/privacy/threat-model.md` (assets/threats/controls), `docs/privacy/retention.md`,
`docs/research/codebook.md` (the instrument), and the Privacy Policy
(`apps/web/src/routes/privacy/+page.svelte`).

## 1. Purpose and legal basis

**Purpose.** To study how participants' stated views compare with historical parliamentary voting
records, examine aggregate patterns across sufficiently large groups, validate and improve the
methodology, detect data errors, and publish aggregate research/dashboards (Privacy Policy §5). The
survey is a large **opt-in, non-probability** sample designed to be post-stratified against ABS Census
and AEC benchmarks (codebook).

**What is collected.** Only after an explicit, unticked opt-in with an 18+ confirmation and the
collection notice (survey flow). The contribution contains **device-derived values
only** (ADR-0008): the top-party match and per-proposition stances computed on the contributor's
device — **the raw answer vector and importance weights never leave the browser** — plus the
state/territory (**not** electorate), the election + data + app versions, the AEC timetable
boundaries (public facts, for server-side cohort classification), the `consentVersion`, and any
optional demographic survey answers. Some demographics are **sensitive information** under the
Privacy Act 1988 (Cth) — political opinion/identification/vote, union membership, racial or ethnic
origin, religious beliefs, and sexual orientation. **Nothing is stored per person**: the server
tallies each contribution into aggregate counters (the closed estimand list in
`docs/research/analysis-plan.md`) and discards the request.

**Legal basis for sensitive information:** consent (APP 3.3), obtained via the unticked opt-in and
collection notice; every question is optional with a prefer-not-to-say option.

## 2. Data flows and storage (summary; full detail in data-flow.md)

- Client (on-device derivation) → same-origin `POST /api/research` (Cloudflare Pages Function) →
  Cloudflare D1 **counter tables** (`response_total`, `demographic_count`, `proposition_count`,
  `proposition_party_count`, `weighting_frame_count`, `consent_count`, `collection_period_count`,
  each keyed by the server-classified collection cohort). One atomic batch of `UPSERT … n = n + 1`;
  **no per-person row exists at rest**, and nothing records that a batch's increments came from one
  request — no delta log, no insertion-order key, no shared token (migration `0001`).
- Client → same-origin `POST /api/research/geography` → Cloudflare D1 (`geography_count`).
- **De-identify before upload (the core item-13 control, now two-fold):** (1) the raw answers are
  reduced to a match + stances **on the device** — the fingerprint never exists off-device; (2) the
  electorate is split off at the client onto the separate geography request, which shares no key
  with anything. **Key rule at rest** (analysis plan): no counter pairs an opinion value with a
  sensitive attribute below national scope — sensitive dimensions are stored national-only.
- **No identifiers, no fine time:** no IP (`CF-Connecting-IP` never read), no cookie, device id, or
  per-record token, and **no timestamp finer than a calendar quarter anywhere in the store**
  (`collection_period_count`); no per-request date is even parsed; values allowlist/shape-validated,
  free text never stored; uniform `204` response; **no logging or error reporting on the ingestion
  path** — the in-flight request is the only place a profile momentarily exists.
- **Publish side:** a build-time generator sums the counters and emits only k≥10-suppressed,
  per-cohort aggregates (`packages/data-pipeline`); a stats file is replaced only when ≥ k new
  responses have accrued (snapshot differencing gate); counters are never served.
- **Subprocessors:** Cloudflare (hosting, D1; may process outside Australia — APP 8). No third-party
  analytics on the research path.

## 3. Re-identification assessment

**The former core risk is retired.** The pre-ADR-0008 design stored a **~50-item answer vector**
plus ~20 demographics per person — a near-unique fingerprint. Under the counters model **no such
record exists anywhere at rest**: the vector never leaves the device, and the store holds only
group counts from a pre-registered, closed estimand list. The honest description is
**aggregate-only by construction** — deliberately not "anonymous".

**The successor risks (engineering facts + what needs determination):**

1. **Small cells at rest.** A counter can hold n = 1 mid-collection, or permanently in a rare
   bucket; a leaked row is attribute disclosure against a person *known to have contributed*.
   Mitigations: the **key rule** — no counter pairs an opinion value (party match / stance) with a
   sensitive attribute below national scope (enforced at ingestion, defence-in-depth in the
   generator, test-pinned) — caps the worst leaked row at "one person somewhere in Australia";
   coarse buckets only; access restriction to the raw counters `[ops]`.
2. **The in-flight request.** The one place a full derived profile exists is inside the single
   POST, for milliseconds. The endpoints emit no logging or error reports; ensuring the
   hosting/CDN layer captures no request bodies and attaches no tracing on `POST /api/research` is
   the decisive `[ops]` control (threat-model.md T6 — all telemetry, including the cookieless edge
   analytics, not one product alone; the app itself transmits no client-side errors at all).
3. **Snapshot differencing.** Published stats regenerate only when ≥ `MIN_CELL` new responses have
   accrued, so no pair of published snapshots differs by fewer than k contributors; with more than
   one cohort present no combined cell-view is published (cohorts are a strict partition —
   `all − Σ others` would reconstruct a suppressed cohort). Both are code-enforced.
4. **No per-request bundle at rest.** An earlier draft kept a `counter_delta` day-grained log for
   poisoning excision; it was removed because a rare cell on a low-traffic day regroups into a
   temporary person-level record (by insertion order or shared cohort/state/party key). Surgical
   excision and "no per-person record" are incompatible, so the store now carries no delta and no
   timestamp finer than a quarter (ADR-0008). Nothing to assess here — the risk is designed out.
5. **k-anonymity on publication (unchanged).** Cells at k ≥ 10 per cohort, board hidden below 50,
   shown = sum of surviving cells, one dimension per view, no electorate-level result, party keys
   outside the compiled dataset never published (`stats.ts`).

**Differencing / correlation checks (engineering position; confirmation is a sign-off item):**

- `geography_count` carries only a count — no attribute, cohort, or date — and no research counter
  carries an electorate, so there is no shared dimension along which to difference the two.
  **[requires practitioner sign-off before launch]** that this holds in the real data environment.
- The two endpoints share no key; no IP is read and no fine timestamp is stored. Real-time
  request-log correlation by an insider remains an operational risk addressed by the "no research
  bodies in operational logs / access audit" controls (threat-model.md T3/T6) — **[requires
  practitioner sign-off before launch]** on the operational side.

**Residual-risk determination in the real data environment [requires practitioner sign-off before
launch]:** whether the small-cell exposure of the counters — given the key rule, bucket coarseness,
and realistically available external knowledge of who contributed — is acceptable for the intended
access model, and whether any key coarsening (e.g. dropping state from further dimensions) is
warranted.

**D2 deviation sign-off [requires practitioner sign-off before launch]:** the decision to keep
electorate as an aggregate tally rather than dropping it entirely (a documented deviation from pack
§8.3, resolved at the record level in ADR-0006) is an accepted engineering position that still needs
practitioner endorsement.

## 4. Australian Privacy Principles checklist

| APP | Requirement | Position | Status |
|-----|-------------|----------|--------|
| **APP 1** | Open, transparent management; up-to-date policy | Privacy Policy published and versioned; this PIA, codebook, data-flow and threat-model documented. | Implemented; **policy adequacy [requires practitioner sign-off]** |
| **APP 3** | Collection (incl. sensitive info) only with consent / as needed | Collection minimised to the stated purpose; sensitive info collected **by consent** via unticked opt-in + collection notice; every field optional. | Implemented; **consent-mechanism adequacy [requires practitioner sign-off]** |
| **APP 5** | Notice at/near collection | Collection notice shown before any upload; `consent_version` recorded per record so the exact notice consented to is known. | Implemented |
| **APP 6** | Use/disclosure only for the collection purpose | Records used only for the §5 research purposes; **not** used to target advertising, build voter profiles, contact participants, or make decisions about individuals (Privacy Policy). No sale. | Implemented (policy commitment) |
| **APP 8** | Cross-border disclosure | Cloudflare (D1) may process outside Australia; reasonable-steps commitment in Privacy Policy §9. | Disclosed; **adequacy [requires practitioner sign-off]** |
| **APP 10** | Quality of data | Allowlist validation (off-list dropped), state normalisation, schema-version gating, server-classified collection context, cohorts not silently pooled. Non-probability sample caveats documented in the codebook. | Implemented |
| **APP 11** | Security **and** de-identification / destruction | **See §5 (reasonable steps).** Aggregate-only storage (derive-on-device, counters at rest), key rule, no identifiers, per-cohort k-anonymity + differencing gate all implemented; several security/retention steps are operational. Long-term holding is counts, not sensitive microdata — a materially stronger APP 11.2 posture. | Partly implemented; **operational steps outstanding** |
| **APP 12/13** | Access / correction | No individual record exists at all, so a particular contribution cannot be retrieved, corrected or deleted; participants control whether anything is contributed at all. Honestly disclosed (Privacy Policy §11). | Implemented (by design) |

**Data-breach response / OAIC notification:** commitment stated (Privacy Policy §10); the actual NDB
response runbook + notification path is an operational deliverable **[requires practitioner sign-off
before launch]**.

## 5. APP 11 reasonable steps — the security assessment

APP 11 requires reasonable steps to protect the information **and** to destroy/de-identify it when no
longer needed. Mapping the controls (see threat-model.md for the full matrix; `[code]` = in this repo
and tested, `[ops]` = deployment/config still to confirm):

**Implemented in code:** derive-on-device — the raw vector never transmitted `[code, e2e-pinned]`;
aggregate-only storage, one atomic batch, no per-person row possible `[code, test-pinned]`; the
sensitive-dimension national-only key rule `[code, test-pinned]`; de-identify before upload
(electorate split) `[code]`; no IP/cookie/device id/token stored, no logging on the ingestion path
`[code]`; time coarsened, allowlist validation, uniform `204` `[code]`; geography held as an
integer tally `[code]`; per-cohort k≥10 publication suppression with no-leak denominator, no
combined-cohort view, no electorate view, dataset-checked party keys `[code]`; snapshot
differencing gate `[code]`; no delta/per-request bundle and no time finer than a quarter at rest
`[code]`; input abuse guards (size/proposition caps, schema gate, mandatory consent version)
`[code]`.

**Poisoning defence is prevention, not excision** — Cloudflare rate limit + Bot Fight Mode on the
route (`[ops]`, live) and request-analytics detection; a per-cell-per-time delta store would be the
excision path but is deliberately not built (it would be a temporary person record — ADR-0008).

**Operational / deployment — outstanding, requires sign-off before launch:**

- Least-privilege D1 binding; **separate credentials** for prod ingestion vs. the analytics/stats read
  vs. any admin access; scope + rotate `CF_D1_API_TOKEN` `[ops]`.
- Ensure **no research request bodies/metadata are written to hosting/CDN logs**, and that such logs are
  separated from the research dataset `[ops]` (Privacy Policy §8).
- **Access audit/log** for the raw store; contractual no-re-identification terms on providers/authorised
  researchers `[ops]`.
- **Retention enforcement:** wire the scheduled sweep (`scripts/retention-sweep.sql`) and pair it with a
  **tested backup-destruction / PITR-horizon** step; operationalise the after-election review `[ops]`
  (see `retention.md`). This is the APP 11 destroy/de-identify limb — the rule is published but the
  automated deletion is **not yet deployed**.
- Rate limit + Bot Fight Mode on `POST /api/research` `[ops]` (already configured live).
- Data-breach response runbook + OAIC notification path `[ops]`.

## 6. Retention and destruction record

**Indefinite retention of aggregates.** The store holds only genuinely aggregated group counts,
which are not personal information, so the APP 11.2 destroy-when-no-longer-needed limb does not
bite and there is no fixed maximum period (Privacy Policy §5; ADR-0008 — supersedes the earlier
15-year cap). This is defensible precisely because the counters are aggregate: the practitioner's
§3 small-cell determination is what underwrites that classification, and it is handled by the key
rule + publication suppression, not by a retention clock (which never reduced small-cell risk).
Deletion is **purpose-based**: an after-election review or a PIA direction retires a wave, run via
the per-election template in `scripts/retention-sweep.sql` (`docs/privacy/retention.md`). **Testing
backup destruction and operationalising the review are outstanding operational steps.**

**De-identification of earlier per-person data — completed.** Earlier waves of
the research feature were collected under a per-person schema before the aggregate-only model
(ADR-0008) was adopted. That personal information has since been de-identified to aggregate counters
and the per-person records destroyed — permitted under APP 11.2 and strictly risk-reducing — and the
one-off tooling that read the per-person tables has been removed, so the committed schema is
aggregate-only. The full destruction record (scope, method, verification, dates and the pre-deletion
evidence manifest) is held in National Digital's restricted legal records and is referenced here by
evidence ID only:

| Field | Value |
|-------|-------|
| Destruction record | held in restricted legal records (pre-deletion evidence manifest captured) |
| Destruction certificate | **EV-DESTRUCTION-CERT** (signed; covers both the research database records and archived copies) |
| Accountable owner | National Digital |

**To keep the record closed:** the signed destruction certificate (EV-DESTRUCTION-CERT) is filed
against the captured evidence manifest; the backup-destruction / platform-recovery-window
verification `[ops]` is re-run whenever a purpose-based deletion occurs.

## 7. Residual risks (for the practitioner's determination)

1. **Small-cell attribute disclosure from the raw counters** by an insider or after a breach —
   capped by the key rule and bucket coarseness; disclosed in construction language. Acceptability
   is the §3 sign-off item. (Also assess whether a counters-only leak reaches the NDB "personal
   information" threshold at all — it plausibly does not.)
2. **In-flight capture** of the single POST by a logging/tracing layer — depends on the `[ops]`
   containment controls (§5) being in place; the decisive operational control under this model.
3. **Poisoning without surgical remedy** — the store keeps no delta log (it would be a temporary
   person record), so a confirmed attack can only be met by prevention and, at worst, discarding an
   election's counters; poison below the publication gate never surfaces. Accept this trade.
4. **Retention overrun / backup persistence** — until the sweep is scheduled and backup destruction
   is tested, counters could outlive their purpose or the dropped tables' Time Travel horizon could
   pass unrecorded (§6; retention.md §5).
5. **Cross-border processing (APP 8)** — Cloudflare may process outside Australia; relies on the
   reasonable-steps commitment.
6. **Consent adequacy for sensitive information (APP 3.3)** — the mechanism is built and the notice
   was re-versioned for the counters model (`consent_count` records which notice was live); its
   legal sufficiency is a sign-off item.

## 8. Tests that back the design

- `functions/api/research.test.ts` — aggregate-only writes (no per-person INSERT possible); the
  sensitive-dimension national-only key rule; every counter cohort-keyed; no delta/per-request
  bundle and no per-day date written; atomic batch; consent version mandatory; state normalised;
  demographics allowlist-validated; cohort classified server-side; stale/raw-vector payloads
  rejected.
- `functions/api/research/geography.test.ts` — the geography ping carries and stores nothing but
  election + electorate.
- `e2e/research.spec.ts` — skipping uploads nothing; consent alone uploads nothing; opting in posts
  exactly one v3 contribution with **no raw answers/weights on the wire** plus one unlinkable
  geography ping; failed uploads are not retried; navigation away sends nothing.
- `e2e/consent.spec.ts` — no electorate/state/fragment/answer reaches analytics or any tracking host
  (the site transmits no client-side errors at all — there is no error beacon).
- `packages/data-pipeline/src/stats.test.ts` — per-cohort k≥10 suppression, the "no leaked total"
  invariant, no combined view with multiple cohorts, no state roll-up for sensitive dimensions,
  unknown party keys never published.
