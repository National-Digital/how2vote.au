# Governance

## Who decides

how2vote.au is operated by **National Digital** (a trading name; the legal entity and ABN are
recorded in `apps/web/src/lib/org.ts`). National Digital maintains the project, reviews
contributions, and is responsible for what is published.

**No political party, candidate, campaign, or the Australian Electoral Commission (AEC) controls,
directs, funds, or endorses this project.** It is not affiliated with any of them. Decisions are made
by the maintainer in the public interest of helping voters compare parliamentary voting records.

## Non-partisan by construction

Neutrality is not a promise we ask you to take on trust — it is enforced mechanically and blocks
release if broken:

- **CSS neutrality lint.** The interface is strictly two-tone (ink on paper) with no hue anywhere; a
  CI lint greps the built CSS and fails on any non-monochrome colour value, so match quality can
  never be encoded as colour.
- **Claims register.** Neutrality and privacy claims are tracked in a machine-checked register with
  required-checks and control-register completeness gates, so a stated guarantee cannot silently
  drift from what the code does.

## Decisions of record

Significant, hard-to-reverse decisions are recorded as Architecture Decision Records in
[`docs/adr/`](docs/adr/) — the context, the choice, and its consequences, one file per decision,
numbered and immutable (superseded rather than rewritten). That directory is the authoritative
record of why the project is built the way it is.

## Contributing and conduct

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for how changes are proposed and the CI-enforced ground
rules, and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) for community expectations.
