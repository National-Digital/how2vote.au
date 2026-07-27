# How2Vote brand guidelines

These guidelines describe how the **How2Vote** name and identity may and may not be used. They
exist so that people can always tell the genuine service from a fork, a mirror or an imitation.

**Legal basis.** How2Vote does **not** rely on a registered or pending trade mark. The name and
identity are protected through **copyright** in the original brand assets, the tort of **passing
off**, and the **misleading-or-deceptive-conduct** provisions of the Australian Consumer Law
(Competition and Consumer Act 2010 (Cth), Schedule 2). Enforcement rests on those principles, not
on any claim of registration. Nothing here should be read as asserting a registered mark.

## Product name and spelling

Two things are protected here, and they are spelt differently on purpose: **the name**, which is
text, and **the wordmark**, which is a drawing. Getting the difference right is the whole rule.

- **In text the product name is `How2Vote`** — one word, no space or hyphen, capital `H` and
  capital `V`, with the numeral `2` (never "how to vote", "how-2-vote", or "HOW2VOTE"). This is the
  spelling for running prose, page titles, the app name under its icon, store listings, and
  anything a screen reader speaks aloud.
- **The wordmark sets the name in lower case**, as `how[2]vote`. That is a fixed piece of artwork,
  not a spelling — the lower case is a typographic decision baked into the outlines, in the same
  way the box around the `2` is. Reproduce it as drawn; do not "correct" its case.
- The test for which to use: **if it is rendered as glyphs by a font, or read aloud, it is
  `How2Vote`; if it is baked vector artwork, it is the lockup as drawn.** An `aria-label` or an
  `alt` on the logo is therefore `How2Vote`, because it is spoken, not drawn.
- The identity concept is `how[2]vote`: the preference numeral "2" marked inside a ballot-paper box.
  See `docs/brand/README.md` for the full description of the mark.

### Identifiers are always lower case

**An identifier is never the name, and is never title-cased.** Anything a machine matches on — not a
reader — stays `how2vote`, always, with no exceptions:

| Kind | Example |
| --- | --- |
| Domains and hosts | `how2vote.au`, `send.how2vote.au`, `how2vote.com.au` |
| Application id / bundle id | `au.how2vote.app` |
| Package scope | `@how2vote/engine` |
| Storage and cache keys | `how2vote:quiz:v2`, `how2vote:consent:v1` |
| Tool and function names | `how2vote_find_electorate` |
| Infrastructure names | the `how2vote-au` worker, the `how2vote-research` D1 database |
| File and asset names | `docs/brand/how2vote-wordmark.svg` |
| Email addresses | `how2vote@nationaldigital.com.au` |
| Repository and module paths | `National-Digital/how2vote.au` |

The rule is absolute in that direction, and it is enforced: `scripts/check-brand-casing.mjs` fails
CI on a title-cased identifier. Two reasons it matters more than tidiness. Several of these are
**load-bearing and effectively irreversible** — re-casing a storage key silently discards every
user's saved cards and consent, and an application id cannot be changed once published. And several
are **case-sensitive in ways that break silently** rather than loudly.

If you are adding a new identifier, spell it `how2vote`. If you are writing something a person
reads, spell it `How2Vote`.

## Operator

How2Vote is operated by **National Digital** (trading name). Refer to the operator by that trading
name. The authoritative operator record — including the full legal entity details — lives in
`apps/web/src/lib/operator.json` and is surfaced through `apps/web/src/lib/org.ts`; do not copy the
legal entity name or ABN into other files.

## Logo files and permitted variants

The canonical brand marks live in `docs/brand/` and are documented in
[`docs/brand/README.md`](docs/brand/README.md):

- `docs/brand/how2vote-mark.svg` — the icon (ballot column with the boxed "2" dominant and ghost
  `[1]`/`[3]` cells). Use for favicons, app icons and small square contexts.
- `docs/brand/how2vote-wordmark.svg` — the full display lockup with the ghost cells. Use where the
  height is available (social cards, documents, marketing).
- `docs/brand/how2vote-wordmark-compact.svg` — the wordmark without the ghost cells, for small UI
  such as the site header.

Permitted use of the marks:

- Reproduce a mark **whole and unaltered**, preserving its proportions and clear space.
- Re-ink a mark by setting `color` on the embedding context (the marks are monochrome and use
  `currentColor`) — e.g. ink `#181611` on light grounds, chalk `#EBE8DF` on dark grounds.

Not permitted:

- Do not stretch, rotate, recolour with a hue, add effects to, or redraw the marks.
- Do not add a registered-mark or trade-mark symbol to the marks or the name.
- Do not use the marks to brand a fork, mirror or derivative (see attribution, below).

## Colour, typography and accessibility

The identity is strictly monochrome — a single ink/chalk colour on its ground; **never introduce a
hue** into the marks. Colour and type tokens are defined once in `apps/web/src/app.css` (the
`--ink`, `--paper`, `--serif`/`--ui`/`--mono` custom properties and their light/dark overrides) and
described in [`docs/brand/README.md`](docs/brand/README.md):

- **Ink / paper.** Light ground `--paper` `#f6f4ee` with `--ink` `#181611`; dark ground `--paper`
  `#151410` with `--ink` `#ebe8df`. The theme flips via `prefers-color-scheme` and an explicit
  `data-theme` override.
- **Type.** Display and headings use Newsreader (`--serif`, OFL, bundled in
  `apps/web/static/fonts`); UI text uses the system UI stack (`--ui`).
- **Accessibility.** Maintain the WCAG 2.2 AA contrast the ink/paper pairs provide, honour reduced
  motion, and never rely on colour alone to carry meaning. The mark must stay legible in
  monochrome; below roughly 40px box height use the compact lockup (the ghost cells turn to fuzz).

## Attribution requirements for forks

The software is licensed under AGPL-3.0 and the compiled dataset under ODbL. Those licences cover
the code and data — **not** the How2Vote name or marks. If you fork or redeploy:

- Use **your own** product name and branding; do not present your deployment as "How2Vote".
- Remove or replace the How2Vote marks in `docs/brand/` and `apps/web/static/` with your own.
- Retain the source-code and dataset attributions the AGPL and ODbL require (including the They
  Vote For You / OpenAustralia Foundation data attribution).
- Make clear your version is a modified, independent deployment.

## No implied endorsement

Do not use the How2Vote name or marks, or National Digital's name, in any way that implies National
Digital produces, sponsors, endorses or is affiliated with your fork, product or content. Do not
suggest an official relationship that does not exist.

## Copyright ownership and licensing of the brand assets

The original How2Vote brand assets — the marks in `docs/brand/`, the wordmark geometry generated
from `apps/web/src/lib/brand/mark.mjs`, and the derived favicons, PWA icons and OpenGraph cards —
are **original creative works whose copyright is owned by National Digital**. They are **not**
covered by the AGPL-3.0 grant over the application source code, nor by the ODbL grant over the
dataset. No licence to use the brand assets as brand identity is granted by this repository beyond
the whole-and-unaltered reproduction described above; all other rights are reserved. (Newsreader,
from which the mark geometry is outlined, is a third-party font under the SIL Open Font License —
its own terms govern the font, not these marks.)

## Reporting brand confusion

If you believe a deployment, product or content is passing itself off as How2Vote or implying an
endorsement by National Digital that does not exist, contact **how2vote@nationaldigital.com.au**.
