# How2Vote brand marks

The identity is `how[2]vote`: a preference numeral "2" marked inside a ballot-paper
box, with the ghost `[1]` and `[3]` cells of its column above and below — the act the
site explains, drawn in the brand face.

The wordmark sets the name in lower case. That is the artwork, not the spelling: in
text the product name is **How2Vote**. See [`BRAND.md`](../../BRAND.md) for the rule.

- `how2vote-mark.svg` — the icon: the ballot column, the 2's cell dominant, ghost
  `[1]`/`[3]` cells at reduced size and opacity (64×64 grid).
- `how2vote-wordmark.svg` — the display lockup: "how", the boxed 2 inside its ballot
  column, "vote" on one baseline. For display surfaces that can afford the height
  (social cards, marketing, documents).
- `how2vote-wordmark-compact.svg` — the wordmark without the ghost cells. For small
  UI (the site header uses this via the Logo component); the ghost cells turn to fuzz
  below roughly 40px of box height, so the compact lockup takes over there. The same
  rule gives the favicon the boxed 2 alone.

Each mark ships in two inkings. The files above default to ink `#181611` for light
grounds; a `-chalk.svg` sibling of each (`how2vote-mark-chalk.svg`,
`how2vote-wordmark-chalk.svg`, `how2vote-wordmark-compact-chalk.svg`) defaults to chalk
`#EBE8DF` for dark grounds. The pair is otherwise byte-identical — only the root
`style` colour differs. Use them where the embedding context cannot re-ink from the
outside: e.g. a GitHub README, which picks the right file per theme via
`<picture>`/`prefers-color-scheme`.

All marks are pure vector paths — Newsreader (OFL, `apps/web/static/fonts`) instanced
at weight 600 / optical size 72 and converted to outlines — so they render identically
everywhere with no font dependency. They are strictly monochrome: every fill and
stroke is `currentColor`, defaulting to the file's ink via the root `style` attribute.
Set `color` on the embedding context to re-ink them (e.g. chalk `#EBE8DF` on dark
grounds). Never introduce a hue.

These files are **generated** — exports of the canonical geometry in
`apps/web/src/lib/brand/mark.mjs` — by `apps/web/scripts/generate-brand-mark.py` (run
with `uv run`); never hand-edit them. The Logo component, favicons, PWA icons, and
OpenGraph cards all draw from that same module, so an export is byte-identical to the
mark the app renders. To change a mark, edit the geometry in the generator and rerun
it (`uv run apps/web/scripts/generate-brand-mark.py`) to re-emit `mark.mjs` and these
SVGs together.
