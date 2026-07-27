# 0003 — No self-submitted candidate positions

- Status: **Accepted** (reversible — see "Reintroduction path")
- Deciders: National Digital

## Context

The tool scores parties on their *recorded parliamentary votes* (revealed preference), so any party or
independent that has never sat in parliament has no record and is absent from a user's match — even
though the user might align with them.

One way to fill that gap is to let such candidates **self-submit** answers to the same propositions and
score those like a party's record. That introduces a second, unverifiable class of data (campaign
statements rather than the parliamentary record), a submission and moderation surface, and a server to
accept it — none of which the tool otherwise needs.

How2Vote is a fully static, offline PWA with **no server-side component** for the card and a strict
integrity/neutrality posture. A party or candidate with no parliamentary record on the issues a user
answered resolves to **"no data"** — it earns and risks no points and is shown as such on the ballot.

## Decision

**The tool does not accept self-submitted candidate positions.** There is no self-submission intake,
no candidate-supplied positions in the dataset, and no `/unelected-candidates` page. Candidates with
no parliamentary record display as "no data" on the card.

## Rationale

- **Integrity.** Self-reported answers are exactly the campaign-statement class of data the tool
  exists to *avoid* — they are unverifiable against the parliamentary record. On the old site they had
  to be visually quarantined with an annotation precisely because they were a weaker kind of evidence.
- **Architecture.** How2Vote is a static PWA with no backend to accept, validate, moderate, or store
  candidate submissions. Adding one reintroduces a server, an authentication/verification problem, and
  a moderation surface — none of which exist today.
- **Provenance.** The compiled dataset is published under ODbL with a checksum and a single, clean
  provenance chain (They Vote For You → compiler → dataset). Mixing in a second, self-reported data
  source complicates that story and the deterministic-rebuild CI gate.
- **Scope & uptake.** The feature was low-usage historically and is not required for a correct,
  trustworthy launch. Shipping without it keeps the launch surface small.

## Consequences

- Users receive **no signal** for genuinely new parties and independents who have never sat in
  parliament; those candidates appear on the ballot as "no data".
- There is no `/unelected-candidates` page or explanatory content; any future reintroduction ships
  with a freshly authored page and methodology addendum (see "Reintroduction path").
- We should be prepared to answer "why isn't party X here / why does it say no data?" — the
  methodology page already explains that no parliamentary record means no position.

## Reintroduction path

If we choose to bring this back, the shape that preserves the integrity posture is:

1. **A separate, clearly-labelled supplementary dataset** (still ODbL, still checksummed) that holds
   candidate-supplied positions, kept distinct from the parliamentary-derived positions so provenance
   stays unambiguous and the deterministic-rebuild gate still holds.
2. **A submission + review intake** that does not require standing server infrastructure — e.g. a
   structured form that opens a pull request, or a curated editorial process — so the static-site and
   no-backend properties survive.
3. **Card annotation** distinguishing candidate-supplied positions from parliamentary ones (as the old
   card did), so users always know which kind of evidence they are looking at.
4. **A rebuilt `/unelected-candidates` page** and a methodology addendum explaining the second data
   source and its limits.

Until then, "no data" is the honest and correct answer for candidates with no parliamentary record.
