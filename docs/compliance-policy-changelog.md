# Compliance policy change log

A dated, versioned record of changes to how2vote's **compliance policy** — the product rules that
shape what a user sees, shares and prints: the print-authorisation (s321D) requirements, shared-link
restrictions, attribution and licence handling, election-period publishing, corrections/suspension
behaviour, and data retention. This is distinct from the
[methodology change log](methodology-changelog.md), which records changes to the *scoring method*,
and from the [correction log](corrections.md), which records fixes to *data*.

The version below is the single source of truth defined in
`packages/data-schema/src/compliance-policy.ts` (`COMPLIANCE_POLICY_VERSION`). It is stamped into
every `data/dist/<id>/manifest.json` alongside `methodologyVersion`, so a displayed result carries
which compliance policy governed the release:

> dataset version + questionnaire version + matching-algorithm version
> \+ compliance-policy version + user responses = displayed result

Bump it, and add an entry here, on any material change to the product rules tracked by the
[control register](legal/control-register.json) and the [legal review](legal/legal-review.json). A
pure data refresh or a scoring-method change does **not** bump it.

## 2026.2 — 2026-07-18

Under-18 explore-only mode (ADR [0012](adr/0012-under-18-explore-mode.md), amending ADR
[0011](adr/0011-age-first-gate.md)). The age-first gate changes from block-everything to a two-tier
capability so a person under 18 can learn from the tool without being handed voting material:

- **Comparison is open; the how-to-vote card is not.** An under-18 who self-declares may take the
  quiz and see their comparison (an educational result), but the plan builder, printing, sharing and
  on-device saving of a how-to-vote plan stay 18+ only. A how-to-vote card is material for casting a
  vote, so it is never produced for someone who has told us they are too young to vote.
- **Research stays 18+.** The optional research survey remains gated to adults (ADR
  [0008](adr/0008-aggregate-counters.md)); an under-18 explorer is routed straight from review to the
  comparison and never reaches the survey.
- **No new data captured.** The gate still stores only the single 18+ acknowledgement bit; an
  under-18 (explore-only) declaration is in-memory for the session and never persisted or uploaded,
  so nothing survives a reload — no age, band or date is recorded anywhere.
- **Constructive alternative.** In place of a plan, an under-18 result points to official,
  non-partisan ways to take part — early enrolment with the AEC, contacting the member for their
  electorate, and the parliamentary voting record on They Vote For You.

## 2026.1 — 2026-07-17

First recorded compliance policy, corresponding to the approved compliance programme (the 33-control
register, ADR [0006](adr/0006-legal-compliance-rebuild.md) and
[0009](adr/0009-compliance-control-register.md)):

- **Print authorisation** — a how-to-vote card is printable only in an owner session after the
  authoriser's required s321D particulars are supplied; the authorisation statement is stamped on the
  printed output (ADR [0010](adr/0010-constrained-product-boundary.md)).
- **Shared links** — a card reconstructed from a shared link is read-only and can never generate
  printable material or disclose the original author's authorisation details (ADR
  [0006](adr/0006-legal-compliance-rebuild.md)).
- **Attribution & licence** — AEC and They Vote For You data carry their required attribution; the
  AEC spatial derivative-product notice is displayed wherever boundary geometry is shown.
- **Election-period publishing** — the insights surface closes on election day per the published
  window (ADR [0014](adr/0014-election-day-notice.md)).
- **Corrections & retention** — disputed figures are suspended rather than left standing; research
  storage is aggregate-only with a k-anonymity threshold and indefinite aggregate retention (ADRs
  [0008](adr/0008-aggregate-counters.md), [0011](adr/0011-age-first-gate.md)).
