# 0012 — Under-18 explore-only mode

**Status:** Accepted
**Amends:** [0011](0011-age-first-gate.md) (age-first eligibility gate)
**Relates to:** [0006](0006-legal-compliance-rebuild.md) (compliance design),
[0008](0008-aggregate-counters.md) (aggregate-counters research storage),
[0010](0010-constrained-product-boundary.md) (user-authorised print)

## Context

[ADR 0011](0011-age-first-gate.md) put a single 18+ self-declaration in front of the whole flow and
made the under-18 outcome a hard dead-end: declaring under-18 cleared local state and left **every**
gated route blocked, offering general information only.

That is stricter than it needs to be, and it turns away exactly the people who benefit most from a
neutral civics tool. The load-bearing legal concern is narrow: a **how-to-vote card** is material for
casting a vote, so producing, printing, sharing or saving one for a person who has told us they are
too young to vote is inappropriate. **Seeing how your own views line up with the parties' recorded
votes is not that** — it is an educational comparison, not electoral instruction, and nothing about it
is unlawful to show a 16- or 17-year-old.

So the decision is to split the gate's single yes/no outcome into two capability levels, letting an
under-18 learn from the comparison while never being handed a how-to-vote card.

## Decision

1. **Two capabilities replace the single block.** The gate (`$lib/age.svelte`) now exposes:
   - **`canExplore`** — take the quiz and see the comparison (an educational result). True for a
     confirmed adult **or** an under-18 who chose to explore.
   - **`canVote`** — build, print, share or save a how-to-vote plan, **and** join the optional
     research survey. **18+ only.** An under-18 explorer is deliberately false here.

   The line is: an under-18 gets a **result**, never a **card**.

2. **Enforcement stays a single fail-closed layout guard, now in two tiers.** `/ballot`, `/quiz`,
   `/review` and `/card` are *explore* routes (open to `canExplore`); `/survey` and `/saved` are
   *adult-only* routes (open to `canVote`). `/card` is an explore route because it hosts the
   comparison, but the build stage, printing, sharing and on-device saving inside it are each gated
   again on `canVote` — defence-in-depth behind the route guard. An undeclared visitor still fails
   closed to `/start` for every one of these.

3. **The under-18 path no longer dead-ends.** Declaring under-18 still clears any pre-existing local
   quiz and saved-card state (so nothing built by a prior adult session on the device survives), then
   continues in explore-only mode: `/start` shows what they can and can't do and sends them into the
   quiz. After review they are routed straight to the comparison, skipping the 18+ research survey.

4. **No new data is captured, and the privacy posture of 0010 is unchanged.** The gate still stores
   only the single 18+ acknowledgement bit (`how2vote:age-ok:v1 = "1"`). An under-18 (explore-only)
   declaration is **in-memory only** — never persisted — so a reload fails closed to the fresh gate,
   and the under-18's quiz answers are session-only (the quiz-persist gate still requires the adult
   bit). No age, band or date of birth is ever recorded, and the eligibility answer is still never
   placed in a URL, sent to research, or transmitted at all. The static guard
   (`scripts/check-age-gate.mjs`) and its invariants are unchanged.

5. **In place of a card, the result offers a constructive, neutral alternative.** An under-18
   comparison points to official, non-partisan ways to take part now — early enrolment with the AEC
   (16- and 17-year-olds can provisionally enrol), contacting the member for their electorate, and
   the parliamentary voting record on They Vote For You. These are single-sourced in `$lib/org.ts`
   (`CIVIC_LINKS`) and endorse no party, candidate or position (neutrality — ADR 0006).

## Consequences

- The `age-gate` Playwright suite (`apps/web/e2e/age-gate.spec.ts`) is updated: an undeclared visitor
  still fails closed everywhere; an under-18 who declares can now reach `/ballot`, `/quiz` and the
  `/card` comparison, but `/survey` and `/saved` stay blocked, the build/print/share/save controls are
  absent, and the advocacy note is shown. The "never persisted, never transmitted" invariants still
  hold and are still asserted.
- This is a material change to the product rules that govern what a user sees, shares and prints, so
  the compliance-policy version is bumped to **2026.2** with an entry in
  `docs/compliance-policy-changelog.md`.
- ADR 0011 remains the record of the gate's *mechanism and privacy posture*; this ADR amends only its
  under-18 *outcome* (decisions 3 of 0010). The print-authorisation model of ADR 0010 is untouched —
  it already sits inside `/card` and now has an additional `canVote` precondition in front of it.
- The exact under-18 wording (the `/start` explainer and the on-result advocacy note) is
  engineering-drafted and folds into the same Privacy / Product review that ADR 0011 left pending
  (control-9).
