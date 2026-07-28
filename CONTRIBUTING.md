# Contributing to How2Vote

Thanks for your interest in improving How2Vote. This is a non-partisan public-interest tool, and
contributions are welcome — from typo fixes to new features. Please read this guide first; a few of
the project's rules are unusual and enforced in CI.

## Ground rules (enforced by CI)

These are not style preferences — a PR that breaks any of them will fail the required checks:

- **Neutrality is absolute.** The interface is strictly two-tone (ink on paper) with **no hue
  anywhere**. A CI lint greps the built CSS for any non-monochrome colour value and fails on a
  match. Match quality must never be encoded as colour.
- **The scoring method is pinned.** The engine's worked examples are immutable golden tests. Any
  change to scoring must be deliberate and versioned: bump the methodology version so it surfaces in
  the app footer, and update the golden tests in the same PR with justification.
- **The dataset is deterministic.** Committed `data/dist` must match a fresh build from `data/source`
  (a CI job rebuilds and diffs). Never hand-edit compiled output; change the source and recompile.
- **No identifiers in the research store.** The `/api/research` endpoint must never store an IP,
  cookie, device id, or sub-day timestamp, and published insights must respect the k-anonymity
  threshold. See [`SECURITY.md`](SECURITY.md).

## Developer Certificate of Origin (DCO)

All commits **must be signed off**. By signing off you certify the
[Developer Certificate of Origin](https://developercertificate.org/) — that you wrote the change (or
have the right to submit it) and agree to it being distributed under this project's licences.

Sign off by adding a `Signed-off-by` trailer to every commit:

```sh
git commit -s -m "feat: add electorate search"
```

This appends a line matching your git `user.name` and `user.email`:

```
Signed-off-by: Your Name <you@example.com>
```

A CI check verifies every commit in a PR carries this trailer. If you forget, amend with
`git commit --amend -s` (or `git rebase --signoff main` for several commits) and force-push.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/). The **PR title** becomes the
squash-merge commit subject, so it must be conventional. The commit types since the last release then
inform the version chosen at deploy time (`scripts/next-version.mjs` reads them and suggests the next
version) — this is a helper for the deploy step, not a fully automated release-and-publish pipeline:

- `feat: …` → suggests the next **minor** version
- `fix: …`, `docs: …`, `chore: …`, `perf: …`, `refactor: …`, `test: …` → suggests the next **patch**
  version
- The major version is **never** bumped automatically.

A CI check (`PR title`) verifies the title is a Conventional Commit when the PR is opened or edited;
if it fails, edit the PR title and the check re-runs.

## Licensing of contributions

Code is licensed **AGPL-3.0-or-later** ([`LICENSE`](LICENSE)); the vote dataset is **ODbL v1.0**
([`LICENSE-DATA.md`](LICENSE-DATA.md)). By contributing under the DCO you agree your contribution is
provided under the licence covering the files you touch.

## Development setup

Requires Node ≥ 24 and pnpm ≥ 11 (pinned via `packageManager`).

```sh
corepack enable          # provides the pinned pnpm
pnpm install             # also wires up the git hooks (see below)
pnpm dev                 # run the web app
```

### Git hooks

`pnpm install` runs a `prepare` step that points `core.hooksPath` at [`.githooks/`](.githooks), so the
committed hooks run automatically — no husky or other dependency is added. They are:

- **pre-commit** — formats (Prettier) and lints (ESLint, `--max-warnings 0`) the _staged_ files and
  re-stages the fixes, so the CI "Lint & format" gate never fails on something fixable locally.
- **pre-push** — runs `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm preflight` before anything
  leaves your machine. `preflight` is the source-only compliance guards (control register, vendor,
  legal-review, privacy, boundary, brand, operator, store-channel, …) — all plain Node, ~13s, so the
  blocking checks a normal change can trip are caught before the PR. Skip for a WIP branch with
  `SKIP_HOOKS=1 git push`.
- **prepare-commit-msg** — appends the DCO `Signed-off-by` trailer so commits satisfy the DCO check.

### Running checks locally

`pnpm preflight` (also run by pre-push) covers the fast, blocking, Node-only guards. Some checks are
**deliberately CI-only** because they need a heavier toolchain or are non-blocking safety/drift
checks — don't install extra tooling just to run them, CI will catch them:

```sh
pnpm preflight           # fast source-only compliance guards (runs on pre-push)
pnpm test && pnpm typecheck && pnpm lint

# CI-only by design — run by hand only if your change touches these areas:
pnpm build && pnpm --filter @how2vote/web neutrality:check   # build-dependent (CSS scan, bundle budget)
pnpm --filter @how2vote/web test:e2e                          # Playwright browsers
```

**Mobile store checks** (`.github/workflows/mobile-ci.yml`) are **CI-only and non-blocking**, and
need toolchains a web contributor should not have to install:

- **fastlane / Ruby** — only relevant if you change `apps/mobile/Gemfile`. To run locally: install
  Ruby via the pinned `apps/mobile/.ruby-version` (`rvm install "$(cat apps/mobile/.ruby-version)"`),
  then `cd apps/mobile && bundle install && bundle exec fastlane lanes`. CI proves this on every PR,
  so you normally don't need to.
- **Android / iOS shell compiles** need the Android SDK / Xcode — leave them to CI (the Android
  compile runs every PR; the iOS compile is enabled with repo var `MOBILE_CI_IOS=1`).

## Code comments

The code should read for itself; comments carry the **why**, not the **what**. A comment earns its
place when it records something the code cannot state on its own — a compliance or fail-closed reason,
an accessibility choice, an ordering or security invariant, a non-obvious edge case, the provenance of
a generated file. If a comment only restates the line beneath it, delete the comment, not the code.
(The framing here follows Ousterhout's _A Philosophy of Software Design_ and Google's TypeScript style
guide: `/** */` documents an interface for its callers; `//` notes an implementation detail for the
next maintainer.)

Doc comments follow the [TSDoc](https://tsdoc.org) standard. `eslint-plugin-tsdoc` lints that the
`/** */` blocks we write are **well-formed** — it never requires a comment to exist, so it will not
push you towards boilerplate. Practical consequences: put package names, object shapes, placeholders
and other `@`/`{`/`<` tokens in `` `code spans` `` so they read literally; write `@param name - text`
with the hyphen; a file's leading summary needs no tag. Node build/CI scripts (`.mjs`) keep their
Closure-style `@fileoverview` headers and are outside the TSDoc lint. Wrap comment prose at 100 columns
(Prettier handles the rest).

## Pull requests

1. Fork and branch from `main`.
2. Keep PRs focused; one logical change per PR.
3. Make sure the checks above pass locally, then open the PR with a Conventional-Commits title.
4. Fill in the PR template, including how you verified the change.

## Review tiers (risk-based review)

Not every change needs the same scrutiny. Reviewers and contributors should classify each PR by the
**highest** tier it touches; the PR template asks you to tick it. This mirrors the compliance control
register (`docs/legal/control-register.json`) and CODEOWNERS routing.

| Tier | What it covers | Who reviews | Required in the PR |
| --- | --- | --- | --- |
| **Ordinary** | Styling, copy, non-material UI, docs, tooling | Engineering | The standard checklist |
| **Enhanced** | Scoring, data imports, sharing, analytics, historical records, accessibility | Engineering | Above + note the affected control(s) and updated tests/goldens |
| **Compliance** | Printing/authorisation, election-period publishing, attribution, licence handling, provenance, retention, and the legal/privacy registers + CI guards that enforce them | Engineering **and** a compliance signatory (`docs/legal/signatories.json`) via CODEOWNERS | Above + the **Compliance-tier block** in the PR template (linked requirement, recorded policy version, BDD example, automated test, sample output/diff, named reviewer) |

**Compliance-tier paths** (auto-routed to a signatory in `.github/CODEOWNERS`): `docs/legal/**`,
`docs/privacy/**`, `docs/research/**`, `scripts/check-*.mjs`, `.github/workflows/compliance.yml`,
`data/source/**`, `data/rights/**`, `data/corrections/**`, `data/governance/**`, `data/aec-spatial/**`,
the print-authorisation surface (`apps/web/src/lib/print-auth*`, `PrintAuthorisationDialog.svelte`),
the research-ingestion backend (`apps/web/functions/**`), and the operator/signatory records.

A signatory recorded as a reviewer on a compliance artefact (e.g. a provenance sign-off, a two-person
ballot attestation, or register evidence) must be a natural person listed in
`docs/legal/signatories.json`; `scripts/check-signatories.mjs` fails the build if an id-shaped
reviewer reference does not resolve to an active, in-scope signatory. Making these owners *blocking*
is a one-time branch-protection setting — see [`docs/legal/required-checks.json`](docs/legal/required-checks.json).

## Adding an election

Adding a federal election (every ~3 years) is the project's core recurring operation. It is a
compliance-tier change with a fixed, documented process — see the
**[adding-an-election runbook](docs/adding-an-election.md)**.

## Reporting bugs & security issues

- **Bugs / features:** open an issue using the templates.
- **Security vulnerabilities:** do **not** open a public issue — see [`SECURITY.md`](SECURITY.md).

## Code of conduct

This project is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating you agree to
uphold it.
