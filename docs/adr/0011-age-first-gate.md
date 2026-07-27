# 0011 — Age-first eligibility gate

**Status:** Accepted — **decision 3 amended by
[0012](0012-under-18-explore-mode.md)** (the under-18 outcome is now explore-only, not a hard block)
**Relates to:** [0006](0006-legal-compliance-rebuild.md) (compliance design),
[0008](0008-aggregate-counters.md) (aggregate-counters research storage),
[0009](0009-compliance-control-register.md) (control register),
[0010](0010-constrained-product-boundary.md) (user-authorised print)

## Context

How2Vote builds a voting comparison and a printable how-to-vote plan for a federal election. That is
adult-facing electoral activity, so a person should confirm they are old enough to vote before any of
it begins.

An age check bundled into the research-consent tick on the optional survey screen would be far too
late: by the time a visitor reaches the survey they have already selected a ballot
(`ballot/+page.svelte` calls `quiz.setBallot`, which persists), answered every question (persisted
per answer), and built a shareable card — a survey-stage tick gates only the *optional research
upload*, never the quiz, the card, sharing or printing. It also conflates two distinct decisions
(eligibility to use the tool vs. consent to research collection) in one control. Eligibility to use
the tool must be confirmed first, on its own.

## Decision

1. **An 18+ self-declaration is the FIRST interactive step of the flow**, on its own route
   (`/start`), reached before any quiz state, answer, research consent, integrity token or share
   capability can exist. It is a **self-declared eligibility check, not verified age**: we never ask
   for a date of birth, an age band or any age value — only a single yes/no bit.

2. **Enforcement is a single fail-closed guard in the root layout.** The set of gated routes —
   `/ballot`, `/quiz`, `/review`, `/survey`, `/card`, `/saved` (every surface that creates or exposes
   quiz / answer / research / share / print state) — is redirected to `/start` until eligibility is
   affirmed. The guard runs only after the acknowledgement has hydrated, so it never fights the
   prerendered HTML, and it remembers the intended destination so a confirmed adult continues where
   they were headed (e.g. a deep-linked shared card, hash preserved).

3. **The under-18 outcome fails closed.** Declaring under-18 records nothing persistent, clears any
   pre-existing local quiz **and** saved-card state left on the device (`quiz.reset()` +
   `saved.clear()`), and leaves every gated route blocked — the visitor is shown general information
   only (About / methodology / privacy / home). No age value is recorded and nothing is uploaded.

4. **The only thing persisted is a one-bit acknowledgement** (`how2vote:age-ok:v1 = "1"`), exactly
   like the terms-acknowledgement store. This lets a returning adult resume an in-progress quiz across
   a reload (WCAG 3.3.7 Redundant Entry) without re-declaring, and fails closed on a fresh device. An
   under-18 declaration is in-memory only and never persisted.

5. **The eligibility answer is never sent to research, never placed in a URL and never transmitted.**
   The age-gate module holds no `fetch`/beacon and no endpoint, and the research ingestion path
   (`survey/+page.svelte`, `survey.ts`, `functions/api/research*.ts`) never imports it. The
   demographic **"age group"** question in the optional survey is a **separate**, consented,
   aggregate-only field (ADR 0008) and is unrelated to this eligibility gate.

6. **This composes with the print authorisation of [0010](0010-constrained-product-boundary.md), it does not duplicate it.** The age gate
   sits in front of the whole flow, so the under-18 block on the print/share route (`/card`) is a
   consequence of the central guard — it does not touch, and cannot bypass, the in-memory
   owner-capability + s321D authorisation model that [0010](0010-constrained-product-boundary.md) enforces once inside `/card`.

## Consequences

- A blocking Playwright suite, `age-gate` (`apps/web/e2e/age-gate.spec.ts`), proves the invariants at
  the real surface: the gate precedes any quiz state, every gated route fails closed to it, the
  under-18 path clears state and keeps the save/share/print routes blocked, and passing the gate makes
  no network request. A static guard, `scripts/check-age-gate.mjs`
  (`scripts/check-age-gate.test.mjs`), backs it up: the research path never references the gate, the
  gate module stores an eligibility bit only (no date of birth / age value, no transmission), and the
  root layout keeps the guard wired.
- Other e2e specs pre-seed the one-bit acknowledgement (`flow-helpers.ts`), mirroring the existing
  terms-ack seeding, so they stay focused on their own concerns while the gate is proven here.
- Because the check is self-declared eligibility (not verified age) it needs no external
  verification vendor, so the evidence row `EV-AGE-GATE-DESIGN` is `not-required`.
