# how2vote research survey — codebook

Status: **v3** — the research-schema version (see Version history) · Election coverage: 2019 / 2022 / 2025 ·
Decisions: [ADR-0007](../adr/0007-same-origin-research-backend.md),
[ADR-0008](../adr/0008-aggregate-counters.md) ·
Estimand registry: [analysis-plan.md](analysis-plan.md)

This is the authoritative description of the optional survey answered after a person builds a
comparison. It exists so third parties can interpret and cite the published aggregates. The canonical
machine definition is `apps/web/src/lib/survey.ts` (`SURVEY`); this document must be kept in step with it.

## What this dataset is — and is not

- **Aggregate counters, not records (ADR-0008).** The store holds only running group counts — the
  closed set of tables in the [analysis plan](analysis-plan.md). No per-person record is created or
  stored at any point at rest: the contributor's device derives a top-party match and a stance per
  answered proposition (the raw answer vector and weights never leave the device), and the server
  increments counters. A particular contribution therefore cannot be located, linked, or followed
  up as a panel — there is nothing to locate. No direct identifier is processed — no name, contact
  detail, account, IP, cookie, device id, free text, or per-record code — and no timestamp finer
  than the collection quarter reaches a long-lived counter. **Deliberate language:** this is
  described as *aggregate-only by construction*, never "anonymous" — while counts are small, a rare
  category could still carry residual risk for a person known to have contributed.
- **A large opt-in (non-probability) sample.** Respondents are self-selected visitors, not a random
  draw of the electorate, so raw marginals are **not** representative on their own.
- **Designed to be weightable.** Every categorical answer is an exact union of an Australian Bureau of
  Statistics (ABS) category, and a dedicated **weighting frame** — joint age × gender × state counts
  per cohort, with no opinion variables (`weighting_frame_count`) — is collected so the series can be
  post-stratified against Census benchmarks and calibrated to AEC results. Political items follow the
  Australian Election Study (AES) so they can be benchmarked against that probability sample.
  Electorate is held only as an aggregate tally (see Structure), never near a result.
- **A repeated cross-section with fixed per-wave scoring.** Each election's counters are derived
  with that election's engine and dataset (`data_version`); historical waves are never re-scored. A
  method change dual-runs for one wave and publishes bridged estimates (series-break handling).
- **Answered independently of the comparison.** The survey is offered *after* the comparison is
  computed, so it cannot affect the comparison and the comparison cannot bias the answers to it.

## Structure

A contribution increments these counters (full key detail in the [analysis plan](analysis-plan.md)).
Every time-varying counter is keyed by the **collection cohort** (below), so cohorts are never
silently combined.

1. **Denominators** — `response_total` per (election, cohort, state): a contribution counts when the
   device derived a match (at least one scorable answer). `state_code` is one of NSW, VIC, QLD, SA,
   WA, TAS, NT, ACT, or the `''` unknown sentinel.
2. **Party × demographic** — `demographic_count` per (election, cohort, state, dimension, bucket,
   party): the device-derived top-party match crossed with ONE demographic at a time. Rows for the
   12 sensitive dimensions (all of Blocks 3–4 plus `union_member`) are stored **national-only**,
   never state-keyed — the analysis plan's key rule.
3. **Proposition stances** — `proposition_count` per (election, cohort, proposition, stance) and
   `proposition_party_count` per (election, cohort, proposition, stance, party), national. `stance`
   is derived on device from the 1–5 answer: 4/5 → agree, 3 → neutral, 1/2 → disagree; skips are
   never transmitted. Proposition ids and text are in the compiled dataset (`data_version`).
4. **Weighting frame, consent, period** — `weighting_frame_count` (cohort × state × age × gender),
   `consent_count` (which collection-notice version), `collection_period_count`
   (AEST quarter `YYYY-Qn` per cohort).

An unanswered survey question (explicit "prefer not to say", a skipped block, or a conditionally
hidden question) simply increments nothing for that dimension — treat the shortfall against the
denominators as item non-response, and note that refusal is itself informative (e.g. on income and
vote).

**Collection cohort.** `cohort` is one of `pre-declaration` / `live` / `post-election` /
`historical` / `unknown`, classified server-side from the arrival time against that election's AEC
timetable (declaration of nominations → last polls close → return of writs). **Cohorts must not be
silently combined**: a `historical` contribution is a view expressed today about a past election,
not a view held at the time of that election, and is analysed separately — the dashboards publish
per-cohort boards only, never a combined view when more than one cohort exists.

**Geography (aggregate only).** `geography_count` is a running tally of contributions per
`(election_id, electorate)` with nothing else attached — no results, no demographics, no state, no
date, no cohort, and no key to anything. It is written by a separate endpoint from a separate
request, so the electorate never travels or rests linked to a contribution.

## The questions

Asked in this order, in four blocks of rising sensitivity. `key` is the stored column name. The final
political block is framed by election phase: for a **historical** election, `past_vote` asks who you
voted for in that election, `vote_intention` asks who you would choose if that ballot were presented
today, and `vote_next` (asked only for historical elections) asks about the next federal election —
three distinct variables that must never be merged.

### Block 1 — About you

| # | key | Question | Options | Concordance |
|---|-----|----------|---------|-------------|
| 1 | `age` | Your age group | 18–24 · 25–34 · 35–44 · 45–54 · 55–64 · 65–74 · 75+ | ABS Age Standard; unions of AGE10P 10-year groups |
| 2 | `gender` | How do you describe your gender? | Man or male · Woman or female · Non-binary · I use a different term | ABS Standard for Sex, Gender, Variations of Sex Characteristics and Sexual Orientation Variables |
| 3 | `education` | Your highest level of education | Year 11 or below · Year 12 · Certificate (incl. trade) · Diploma or advanced diploma · Bachelor degree · Postgraduate degree | ABS HEAP broad levels; preserves the Year 12 / Cert III (YR12C3P) split |
| 4 | `work` | Which best describes your work situation? | Working full-time · Working part-time or casual · Unemployed, looking for work · Retired · Studying, not working · Home duties, caring or other | ABS labour force framework (employed / unemployed / not in labour force kept distinct) |
| 5 | `union_member` | Are you a member of a trade union? | Yes · No | AES |

### Block 2 — Your household

| # | key | Question | Options | Concordance |
|---|-----|----------|---------|-------------|
| 6 | `household_size` | Including you, how many people live in your household? | 1 · 2 · 3 · 4 · 5 or more | ABS NPRD; enables equivalisation (HIED) with income |
| 7 | `children` | Do you have children under 18 living with you? | Yes · No | Maps to Census family composition (dependent children) |
| 8 | `tenure` | Your home is… | Owned outright · Owned with a mortgage · Rented · Other arrangement | ABS TEND |
| 9 | `income` | Your household's total yearly income, before tax | Under $52,000 · $52,000–$104,000 · $104,000–$156,000 · $156,000–$208,000 · Over $208,000 | Gross annual household income; breakpoints are unions of Census HIND weekly bands ($1,000 / $2,000 / $3,000 / $4,000 per week) |
| 10 | `financial` | Compared with 12 months ago, is your household financially… | Better off · About the same · Worse off | AES retrospective economic evaluation |

### Block 3 — Culture and identity

| # | key | Question | Options | Concordance |
|---|-----|----------|---------|-------------|
| 11 | `birthplace` | Where were you born? | Australia · Overseas, mainly English-speaking country · Overseas, other country | ABS BPLP, collapsed to the standard main-English-speaking grouping (UK, Ireland, NZ, Canada, US, South Africa) |
| 12 | `language` | Do you speak a language other than English at home? | Yes · No | Census language-at-home (LANP), collapsed to binary |
| 13 | `indigenous` | Are you of Aboriginal or Torres Strait Islander origin? | No · Yes, Aboriginal · Yes, Torres Strait Islander · Yes, both | ABS Standard Indigenous Question |
| 14 | `religion` | Your religion | No religion · Christian · Muslim · Hindu · Buddhist · Sikh · Other religion | ASCRG broad groups, in Census size order |
| 15 | `attendance` | How often do you attend religious services? | Never · Rarely · A few times a year · Monthly or more · Weekly or more | AES religiosity. **Conditional:** not shown when Q14 = "No religion" (stored NULL) |
| 16 | `orientation` | How do you describe your sexual orientation? | Straight (heterosexual) · Gay or lesbian · Bisexual · I use a different term | ABS Standard (as Q2) |

### Block 4 — Politics

| # | key | Question | Options | Concordance |
|---|-----|----------|---------|-------------|
| 17 | `politics_scale` | In politics, where would you place yourself? (0 = left, 10 = right) | 0 … 10 (stored as the string "0"–"10") | AES 0–10 left–right self-placement |
| 18 | `party_id` | Do you usually think of yourself as… | Labor · Liberal/National Coalition · Greens · One Nation · Independent or other · Another party · No party | AES party identification |
| 19 | `past_vote` | **Current/live:** in the *{previous}* federal election, who did you vote for in the House? · **Historical:** which party, if any, did you vote for in the *{that}* federal election? | Labor · Liberal/National Coalition · Greens · One Nation · Independent or other · Didn't vote · Couldn't vote | AES recalled vote. Current: the election before the one scored (2025→2022, 2022→2019, 2019→2016). Historical: the election being compared. |
| 20 | `vote_intention` | **Current/live:** if the election were held today, who would you vote for? · **Historical:** if the *{that}* candidates and ballot were presented to you today, who would you currently be most likely to vote for? | Labor · Liberal/National Coalition · Greens · One Nation · Independent or other · Undecided | AES vote intention; captured **before** the comparison is revealed |
| 21 | `vote_next` | Which party would you currently be most likely to vote for at the next federal election? | Labor · Liberal/National Coalition · Greens · One Nation · Independent or other · Undecided | **Historical elections only** — a distinct "next election" variable, never merged with Q19/Q20 |

The three political-vote questions are three different variables and must never be merged. For a
current/live election only Q19 and Q20 are asked (Q20 already captures current intent); for a
historical election all three are asked with the phase-specific framings above.

## What is published vs held

Public dashboards (`/insights`) publish only suppressed aggregates, per election:

- **Top-party-match by demographic** — a crosstab against **one** dimension at a time, per cohort.
  **Every** demographic the survey collects is publishable, reported nationally — and by state only
  for the non-sensitive dimensions (the sensitive dimensions are collected national-only under the
  analysis plan's key rule, so no state figure exists to publish).
- **Proposition support** — the overall agree / neutral / disagree distribution for each proposition
  (national, per cohort). Demographic × proposition crosses are **not collected**, so they can never
  be published or analysed; the one pre-registered cross is proposition stance × party match
  (`proposition_party_count`, held for research, publishable only via a governed analysis-plan
  change).

Disclosure control (see `packages/data-pipeline/src/stats.ts`): **one** k-anonymity threshold applies
to every dimension — a cell is shown only when its group clears **k = 10** responses *within its own
cohort* (the counters are cohort-keyed at ingestion, so filtering can never surface a sub-k cell). A
cohort's board stays hidden below **50** responses; a bucket only ever reports the **sum of its shown
cells**, never the true total, so a suppressed cell cannot be recovered by subtraction; no combined
cell-view is published when more than one cohort exists (differencing protection); party keys not in
the compiled dataset are never published; and a published file is only replaced once at least k new
responses have accrued, so two published snapshots can never be differenced below k.

Responses exist per election (current plus historical elections), and the dashboard shows
an election selector across whichever elections have publishable data.

## Design decisions (what was deliberately excluded)

- **Occupation** — the classic class-voting variable, but ABS codes it from free text; self-placed
  occupation chips produce noise, not comparable data. Excluded.
- **Urban/regional** — historically derivable from electorate, but electorate is no longer held on the
  detailed record (only the aggregate tally), so this is neither asked nor derivable per record.
- **Marital status, parents' country of birth** — largely explained by age + children, and by language
  at home, respectively. Low marginal value.
- **Turnout likelihood** — meaningless under compulsory voting.
- **Sex at birth alongside gender** — the ABS two-step is for health/population statistics; unnecessary
  here.
- **Panel / follow-up** — impossible by design: no identifier is stored, and that trade-off is kept.
- **Raw microdata retention** — deliberately impossible: the answer vector never leaves the device,
  so there is nothing to retain, re-score, or crosstab after the fact. Analyses are limited to the
  pre-registered estimands; that is the design, not a gap (see the analysis plan).

## Version history

**v1 is the research-schema version** (payload `schemaVersion: 1` on the wire). The endpoints accept
only the v1 shape; older raw-vector bodies fail field validation. v1 comprises:

- **Instrument** — the 20/21-question ABS/AES-aligned survey.
- **Cohorts + consent provenance** — collection cohort classified server-side against the AEC
  timetable, consent-version recording, electorate split to a separate unlinkable request,
  phase-framed political questions incl. `vote_next`.
- **Aggregate-counters storage (ADR-0008)** — device-derived match + stances tallied into the
  analysis plan's counter tables (migration `0001`); no per-person table is ever created. The
  description is *aggregate-only by construction* (never "anonymous").
