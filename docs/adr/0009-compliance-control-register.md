# 0009 — Fail-closed compliance control register and release manifest

**Status:** Accepted
**Relates to:** [0006](0006-legal-compliance-rebuild.md) (compliance design),
[0008](0008-aggregate-counters.md), [0005](0005-tvfy-snapshot-lock.md)

## Context

The compliance requirements are an implementation specification: 33 issues, each with
mandatory controls, **blocking CI acceptance criteria**, and external-evidence requirements. Release
is approved only once the release manifest shows every required CI group passing. The
governing principle is **fail closed** — where required evidence, source metadata, attestations,
consent versions or review dates are absent or stale, the build/deploy must fail rather than silently
omit the control.

The programme spans ~30 follow-up PRs. Without a single spine, requirements drift: a control gets
"done" in prose while its test never lands, or evidence quietly expires. The review therefore requires
"one machine-readable control registry [that] maps every legal requirement to one or more test IDs and
evidence IDs", with "no orphan legal requirement" and "no test without an owner".

## Decision

1. **One control register** — `docs/legal/control-register.json` — is the machine-readable map from every
   one of the 33 issues to its CI test IDs, external-evidence IDs, CI group(s), owning role, status, and
   related ADRs. Evidence records hold only non-sensitive IDs/hashes/dates/reviewers/expiries — never
   confidential contracts or personal data (those stay in the restricted corporate legal file).

2. **A blocking validator** — `scripts/check-control-register.mjs` (pure `verdict()` + CLI, tested by
   `scripts/check-control-register.test.mjs`) — enforces: all 33 issues present exactly once (no orphan);
   every control maps to ≥1 of the six canonical CI groups; every test has an owner; evidence is
   well-formed; and the **ratchet** — once a control is `implemented`/`verified`, all its tests must be
   `passing` and all its evidence `current` (unexpired) or `not-required`. Controls under construction sit
   at `planned`/`in-progress`/`partial` with planned tests and pending evidence; that is allowed and keeps
   the gate green until a control claims completion, at which point the evidence must actually exist.

3. **Six CI groups** — `Legal`, `Data`, `Privacy and Research`, `Code and Supply Chain`,
   `Accessibility and Product`, `Infrastructure and Operations` — realised as jobs in
   `.github/workflows/compliance.yml`. They start thin (each asserts the register is sound for its scope)
   and accrete their real jobs as later PRs land. Every group is intended to be a required branch-protection
   status check.

4. **A fail-closed release manifest** records the git commit, app/data/consent/
   legal-review/operator versions and the rights/ballot/infrastructure hashes for a release; production
   promotion refuses if any referenced artefact is absent, stale, unsigned or inconsistent.

## Consequences

- The register is the definition-of-done ledger: a PR that implements a control flips its status and test
  state, and CI immediately demands the matching evidence — closing the "documented but not enforced" gap.
- Adding a new legal requirement means adding a control (with an owner and a test), or CI fails on coverage.
- The validator is deliberately dependency-free Node so the group jobs run without an install step.
- Branch-protection wiring is a repo-settings action outside this ADR; until it lands, the compliance jobs
  run but are not yet *required*. Tracked as evidence on control-3.
