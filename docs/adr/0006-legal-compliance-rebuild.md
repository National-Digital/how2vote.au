# 0006 — Electoral & privacy compliance design (user-authored output + minimised research)

- Status: Accepted
- Deciders: National Digital

This ADR decides the product and compliance design. The research *storage model* is decided
separately in [0008](0008-aggregate-counters.md) (aggregate counters only, no per-person rows).

## Context

The service is designed around three electoral-compliance requirements: the output must be a
*user-authored voting plan* in official ballot order (the tool never ranks candidates by score or
suggests a first preference); research collection must be opt-in, minimised and separated; and
privacy and neutrality must be stated in verifiable, non-absolute terms. This ADR records the
engineering and product decisions that implement those requirements.

The relevant law: Commonwealth Electoral Act 1918 (Cth) ss 4AA, 321D (authorisation),
329 (misleading/deceptive), 351 (suggesting a first preference; s 351(5) deems a
notified authoriser to have published the matter); Privacy Act 1988 (Cth) and the
Australian Privacy Principles (APP 1, 3, 5, 8, 11); the ODbL over the They Vote For You
dataset; and WCAG 2.2 AA / the Disability Discrimination Act 1992 (Cth).

## Decisions of record

**D1 — Output model: full user-authored output.** Remove auto-ranking entirely. The
engine returns candidates in **official ballot order** with the alignment score as a
per-row **annotation only** (`packages/engine/src/ballot.ts`). The card is two separated
stages:

- **Compare** — alignment shown as evidence, ballot order, nothing crowned, no implied
  winner (no "top match", no badge, no stronger colour, no celebratory copy).
- **Build my voting plan** — a **blank** ballot the voter fills in themselves via numeric
  entry or labelled move-up/down (no drag), producing an order that is theirs alone. A
  mechanical check flags unnumbered boxes only — never "your vote is formal". Terminology
  shifts to "voting plan"/"comparison"; the "How2Vote" brand stays.

**D2 — Research data: opt-in, minimised, separated.** No
automatic upload; a genuine opt-in shown after the result (its current flow position),
with the collection notice, an unticked consent control, and an 18+ eligibility
confirmation (a research-programme rule the project adopts, not a claim the law bars
under-18s from using the tool). Skipping uploads nothing.

Electorate is kept but **held apart**, resolved at the record level: electorate only ever
increments an **aggregate** counter (`geography_count`), a running tally per (election,
electorate) with nothing else attached and no key linking it to any other record (migration
`0001`, `functions/api/research.ts`). A count — not a per-person row — is what breaks the
linkage a near-unique answer vector would otherwise enable. There is no deletion code /
per-record token: nothing at rest could locate an individual, which is why the Privacy Policy
is honest that a contribution cannot be individually deleted. Every research table is an aggregate
counter ([0008](0008-aggregate-counters.md)); there is no per-person table.

**Authorisation.** The footer carries the online-form electoral authorisation (CEA s 321D,
town + state, non-disclosure-entity form) for **the site and the comparison content
National Digital publishes**. National Digital is **not the authoriser of any user-selected
output** (voting plan / worksheet / shared order): no ND authoriser line is applied to
those, and the print worksheet hides the footer auth line. The printable-output street-address
requirement barely applies while ND authorises no user export; accepted town-only for now,
pending the electoral-law sign-off noted below.

**Sharing.** A shared link only ever recomputes the **comparison** (the codec encodes
answers, never a chosen order), so results/comparison sharing ships at launch. Sharing a
**user-selected order** is out of scope and deferred (see "Deferred — sharing a user-selected
order" below). No cryptographic ND signature on any output.

**Ballot-order gating.** The plan builder opens only once the official candidate list and
ballot order are final and verified. Implemented as `plansEnabled` on the card
(past elections are final; a future "upcoming" election stays comparison-only).

**Retention.** The store holds only aggregate group counts (not personal information), retained
indefinitely for longitudinal analysis, methodological validation, replication and historical
comparison, reviewed after each federal election with purpose-based (not age-based) deletion
([0008](0008-aggregate-counters.md)).

## Consequences

- The most legally exposed behaviours (auto-ranking, auto-upload, telemetry leak, false
  claims) are removed. Scoring itself is unchanged (`scoring.ts`, golden tests intact).
- Publishing controls stay at k ≥ 10 cell suppression (`packages/data-pipeline`
  `MIN_CELL = 10`), no electorate-level results, aggregate-only — see the Privacy Policy
  and the DISCLOSURE controls.
- Points flagged for the electoral-law and privacy sign-off: survey stays pre-plan; electorate
  kept as an aggregate; no per-record deletion code; town-only authorisation.
- **Still human-gated before public launch** (not in this change): electoral-law
  specialist review of the live flow; a completed Privacy Impact Assessment and
  re-identification assessment (`docs/privacy/pia.md`); electoral-expenditure /
  disclosure-entity assessment; the full-journey accessibility audit before the WCAG
  conformance claim; and the ODbL share-alike design (`docs/licensing-odbl.md`) before any
  derived dataset or API is published.

## Deferred — sharing a user-selected order

The tool ships **comparison sharing** only: a shared link encodes the user's *answers*, from which the
recipient's device recomputes the alignment comparison in official ballot order. It carries **no
preference order**, so National Digital neither publishes nor suggests a first preference and CEA 1918
s 351 does not bite.

Users will predictably want to share the **voting plan** they built (their chosen preference order).
That is materially different: a shared order is a "how-to-vote" style communication, and under
s 351(5) whoever is the notified authoriser of that matter is taken to have published it. National
Digital is **not** the authoriser of a user's chosen order, so a naive "share my plan" button that
stamped an ND authorisation — or none — would be wrong.

**Decision (deferred):** do **not** build user-selected-plan sharing in the current design. When it is
designed, it must go through legal review. The likely shape:

- the **individual sharer supplies their own authorisation particulars** (name + town), because they
  author and authorise their own order — National Digital does not;
- the shared artefact keeps the accuracy notice, jurisdiction, data/method versions and the explicit
  "this order was selected by the sharer" statement;
- integrity marking, if any, is a **non-cryptographic checksum** only — never an ND cryptographic
  signature that could imply ND endorsement;
- consider whether the feature should exist at all versus letting people share the neutral comparison
  and build their own plan.

Until this is designed and implemented, the product intentionally has no way to share a preference
order.

## Legal note

This ADR is an engineering and product implementation record, not legal advice; the
electoral-law, privacy and consumer-law positions require the sign-off of a qualified
Australian practitioner before an election.
