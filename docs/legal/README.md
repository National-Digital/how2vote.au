# Compliance sign-off — where to check

This directory is the machine-readable compliance backbone. Most controls are proven by CI guards
(code enforcers). Some also require a **human sign-off** — a named person attesting that a review,
verification or external artefact is genuinely complete. This page is the map: for every human
verification, **where its record lives**, **what to check before you sign**, and **how to record the
sign-off** so the fail-closed gates go green.

Governing rule (from `control-register.json`): a control only reaches `implemented` / `verified`
when **all its tests pass AND all its evidence is `current`** (or `not-required`). Evidence marked
`current` must carry a reviewer + approval date + a future expiry, so a sign-off can never be a bare
word — it is always attributable and time-boxed.

## Who may sign

Only the natural persons in [`signatories.json`](./signatories.json) (kebab `id`, active window,
sign-off scope). Today: `cameron-young` (CEO) and `tara-buckley` (COO), both scope `all`. Every
id-shaped reviewer reference across the records below must resolve to an **active** signatory whose
scope covers the sign-off — enforced by `scripts/check-signatories.mjs` (fail-closed). External
one-off reviewers may be recorded as free text (any value containing a space is treated as an
external descriptor, exempt from resolution).

Joint sign-off: records that support two reviewers use `reviewer` + `secondReviewer` (control
register) or `reviewers.primary` + `reviewers.second` (ballot verification). The two must be
distinct. A reviewer's title/role is **not** repeated in notes — read it from their signatory record.

## How to record a sign-off

1. Do the real review. Confirm the "what to check" column below.
2. Set the record's status (`current` / `released` / `approved` / `verified`) and fill in the
   reviewer id(s), approval/verification date (`YYYY-MM-DD`) and, for control-register evidence, a
   future `expiresAt` (default +3 years; use a shorter cadence where a review is conventionally
   annual, e.g. access reviews).
3. Run the guard in the "verify" column. It must exit 0.
4. If the sign-off completes a control, flip the control's `status` to `implemented` and re-run
   `pnpm compliance:check` — the ratchet will reject a premature flip.

## Where to check — human verifications

### Per-election data records (machine-checked sidecars)

| What | Record | What to check before signing | Verify |
| --- | --- | --- | --- |
| **Ballot order** (EV-BALLOT-VERIFICATION, control-11) | `data/source/<year>/ballot-verification.json` | Two people independently confirmed the compiled ballot order matches the published AEC result for every House electorate + Senate jurisdiction. Set `status: released`, `reviewers.primary` + `.second` (distinct) + their dates. | `pnpm ballot:check` |
| **Candidate↔party mapping** (EV-CANDIDATE-MAPPING, control-6; EV-CANDIDATE-DATA-OWNER, control-7) | `data/source/<year>/candidate-mapping.json` | The party mapping (aecName/alias→key + noRecord list) is correct against the AEC party register. `partiesSourceHash` binds to the exact `parties.json`; any change forces re-review. Set `status: approved`, `reviewer`, `reviewedAt`. | `pnpm candidate-mapping:check` |
| **AEC source provenance** (EV-AEC-SOURCE-RECORDS, control-10) | `data/source/<year>/aec-sources.json` | The raw AEC candidate/ballot/electorate files are **retained in `data/raw/aec/<year>/`**, each pinned by a real `sourceSha256`. For a **live** election (2025+) they are a contemporaneous AEC download that reproduces `ballots.json`. For **historical** elections (2019/2022, which predate live capture) they are byte-faithful, dated **snapshots of the committed `ballots.json`** — honestly labelled as captured-today, not contemporaneous downloads. Only then set a source `status: verified` with `rawRetained: true`, `reviewer`, `reviewedAt`. | `pnpm aec-provenance:check` |
| **Locked TVFY snapshot + proposition content-rights** (EV-TVFY-SNAPSHOT-LOCK, control-13) | `data/snapshots/tvfy/<year>/` + `data/rights/proposition-content-rights.json` | Each election's API v1 snapshot is locked (immutable), every proposition maps to a snapshot policy, the content-rights class is the ODbL OAF class, and the OAF content-permission position is recorded. | `node scripts/check-proposition-rights.mjs` |
| **AEC spatial licence** (EV-AEC-SPATIAL-LICENCE, control-15) | `data/aec-spatial/source-record.json` | The boundary GIS licence determination + retained archive hash. | `pnpm aec-spatial:check` |

### Control-register evidence (sign-off recorded in `control-register.json`)

Legal / design / operational sign-offs are recorded directly on the control's `evidence[]` row
(`status: current`, `reviewer`, `secondReviewer`, `approvedAt`, `expiresAt`). Grep the register by
evidence id. These include the print-authorisation prose (EV-LEGAL-AUTH-SCREENS), de-identification
assessment (EV-DEIDENTIFICATION-ASSESSMENT), provider DPAs (EV-PROVIDER-DPA), methodology/balance
review (EV-METHODOLOGY-BALANCE-REVIEW), rights-classes register (EV-RIGHTS-CLASSES), correction
workflow (EV-CORRECTION-WORKFLOW), Privacy Act determination (EV-PRIVACY-ACT-DETERMINATION), consent
bundle (EV-CONSENT-BUNDLE), IP assignments (EV-IP-ASSIGNMENT), and the four security attestations
(EV-ACCESS-REVIEW, EV-MFA-ENFORCEMENT, EV-SECRET-MANAGER, EV-IR-PLAYBOOK — mirrored in
`security-register.json`). Verify with `pnpm compliance:check` + `pnpm signatories:check`.

### Legally-sensitive changes (sign-off recorded in `legal-review.json`)

A PR that touches a legally-sensitive path — election data, rights metadata, research migrations and
ingestion, the consent model, survey options, schemas, scoring, answers, ballot or card code, or the
`docs/legal/` registers themselves (the `SENSITIVE_PREFIXES` list in
`scripts/check-legal-review.mjs`) — must **add a `changeLog` entry** to
[`legal-review.json`](./legal-review.json). Editing the file is not enough; the entry carries the
approval:

| Field | Requirement |
| --- | --- |
| `date` | `YYYY-MM-DD`, not in the future. |
| `change` | What changed and why it is (or is not) legally material. |
| `disposition` | `reviewed` — a legal review was performed; or `no-review-required` — a signatory determined none was needed. |
| `reviewer` | A signatory `id`, resolving to an **active** signatory. An external free-text descriptor is **not** accepted here (unlike elsewhere): this gate exists to put a named, currently-authorised person on the record. |
| `secondReviewer` | Optional joint sign-off; must be a different active signatory. |
| `affectedControls` | Array of control ids, empty if none. |

`disposition: "reviewed"` additionally requires `lastReviewDate` to be on or after the entry date —
a recorded review must move the record's own review date, or the freshness gate would never see it.

Reviewer ids resolve against `signatories.json` **as it stood at the PR base**, so a PR cannot add
a signatory and name them as its own approver; an approver must already be authorised.

Verify with `pnpm legal:check`. The gate needs the PR base commit (`LEGAL_REVIEW_BASE`), so it runs
on pull requests; freshness and effective-date run on every build and weekly on a schedule.

## Historical vs live AEC snapshots

The AEC provenance model treats past and future elections differently, by design:

- **Live elections (2025 onward).** The AEC nominations feed is captured contemporaneously at
  nomination time and retained as the true point-in-time download that reproduces `ballots.json`.
- **Historical elections (2019 & 2022).** These predate live capture — their ballots were seeded
  from the earlier committed dataset, so no contemporaneous AEC download exists to retrieve. Per the
  sign-off decision (2026-07-18), the raw files are **byte-faithful, SHA-256-pinned snapshots of the
  committed `ballots.json`, captured today**, retained under `data/raw/aec/<year>/`. Each
  `aec-sources.json` note states plainly that these are dated snapshots as we now hold the data —
  **not** the AEC record as it stood at the time. This is the honest, verifiable position for
  historical data we cannot re-retrieve.

## Electoral-expenditure determination

The authoritative expenditure record is [`electoral-expenditure.json`](./electoral-expenditure.json).
The signed human-readable determination is
[`electoral-expenditure-determination.md`](./electoral-expenditure-determination.md).

Before signing `EV-EXPENDITURE-CLASSIFICATION`:

1. confirm every dedicated cash cost for each reporting period is listed;
2. confirm unpaid founder/director labour created no additional salary, fee, bonus, invoice or liability;
3. confirm each period total matches its records and is tested against the applicable threshold;
4. confirm forecast costs are not counted until actually incurred; and
5. run `pnpm expenditure:check`.

The determination must be reviewed before 1 January 2027 and whenever material paid
election-specific expenditure is proposed.

## Outstanding

- **None.** Every control in the register (`control-1` .. `control-31`) is signed off and
  `implemented` as at the 2026-07-20 public-release baseline (`docs/legal/legal-review.json`).
