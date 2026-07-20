# Runbook: adding an election

This is the authoritative, step-by-step process for adding a federal election to how2vote — the
operation this project is built to repeat every ~3 years, indefinitely. If you are reading this years
after launch with no prior context, this file is the entry point; everything else it references is in
the repo.

The design that makes this cheap is recorded in
[ADR-0002](adr/0002-multi-election-support.md) (per-election datasets, one source of truth) and
[ADR-0005](adr/0005-tvfy-snapshot-lock.md) (how positions are frozen faithfully to the election date).
Read those once for the *why*; this file is the *how*.

## The one idea to hold onto

`ELECTIONS` in [`packages/data-schema/src/elections.ts`](../packages/data-schema/src/elections.ts) is
the **single source of truth** for which elections exist. Everything the user sees derives from it —
and from the committed `data/dist/<id>/` dataset — automatically:

- the election toggle and every landing path (`/2025`, `/2022`, …) via the route matcher
  [`apps/web/src/params/election.ts`](../apps/web/src/params/election.ts);
- the data-derived content pages (electorates / Senate / issues / parties) under
  `apps/web/src/routes/[election=election]/`;
- the per-election OpenGraph images (`apps/web/scripts/generate-og.mjs` loops `elections.json`);
- the sitemap, structured data, and `llms.txt` surfaces;
- the dataset and manifest loaders, which discover every `data/dist/*/dataset.json` and
  `data/dist/*/manifest.json` on disk at build time (`apps/web/src/lib/data.ts`,
  `apps/web/src/lib/manifest.ts`, `apps/web/src/lib/content.server.ts`).

So **adding an election needs no code change at all** — it is a registry entry (`ELECTIONS`) plus the
committed dataset under `data/dist/<id>/`. There is no hand-written per-election switch or import to
edit. This config-only guarantee is enforced by a regression test,
[`apps/web/src/lib/election-config-only.test.ts`](../apps/web/src/lib/election-config-only.test.ts),
which fails if a new election is not picked up by the data-driven loaders, or if anyone reintroduces a
hardcoded per-election import.

## Two kinds of "add an election"

The steps differ depending on which you are doing:

| | **A new (future) election** — e.g. 2028 | **A historical backfill** — an old election not yet covered |
| --- | --- | --- |
| Where positions come from | A **live TVFY snapshot** captured during the writ window and then locked ([ADR-0005](adr/0005-tvfy-snapshot-lock.md)). TVFY publishes a party's record *cumulatively as of today*, so the snapshot must be taken **at the time**, not re-derived later. | The period-accurate compilation committed at the time, seeded under `data/v0-seed/<id>/` and migrated ([ADR-0002](adr/0002-multi-election-support.md) §2). |
| Where ballots come from | AEC candidate nominations, published as CSV once nominations are declared ([ADR-0004](adr/0004-aec-nominations-manual-ingestion.md)). | The committed historical ballots in the seed. |
| Timing | Must be done *during* the campaign — the snapshot window closes at declaration of nominations and cannot be reconstructed afterwards. | Any time. |

Most future additions are **column A**. The rest of this runbook is written for column A (a new
election); the historical path is covered in [ADR-0002](adr/0002-multi-election-support.md) and only
differs in steps 1–2.

## Timeline for a new election

The snapshot-lock design ([ADR-0005](adr/0005-tvfy-snapshot-lock.md)) ties three of these steps to the
AEC's own timetable, so you cannot do them all in one sitting:

1. **Election announced / writs issued** → capture the TVFY position snapshot (writ window opens).
2. **Declaration of nominations** → the snapshot **locks** (immutable thereafter), and the AEC
   publishes the candidate nomination CSVs → fetch ballots.
3. **Any time after** → compile the dataset, wire it in, open the PR.

Record the exact AEC dates in the `timetable` block (step 3 below) — they drive the writ window, the
election-day survey close ([ADR-0014](adr/0014-election-day-notice.md)), and the snapshot lock.

## Steps

Throughout, `<id>` is the election id (the year, e.g. `2028`). Commands run from the repo root.

### 1. Capture and lock the TVFY position snapshot (writ window only)

During the writ window (writs issued → declaration of nominations):

```sh
cp packages/data-pipeline/.env.example packages/data-pipeline/.env   # add TVFY_API_KEY if not set
pnpm data:snapshot:fetch      # capture the live TVFY snapshot for the current parliament
pnpm data:snapshot:divisions  # capture the division detail behind each policy
pnpm data:snapshot:lock       # freeze it — immutable after this (CI snapshot-guard enforces)
```

This is the step that cannot be redone later. See [ADR-0005](adr/0005-tvfy-snapshot-lock.md). The
locked snapshot is what `data/source/<id>/questions.json` is validated against.

### 2. Fetch the AEC ballots (after declaration of nominations)

The AEC only publishes nominations — as CSV downloads with per-election URLs — once nominations are
declared; there is no stable API to poll ([ADR-0004](adr/0004-aec-nominations-manual-ingestion.md)).
The turnkey path is the **Data refresh** workflow (Actions → *Data refresh* → *Run workflow*) with the
two published CSV URLs (`aec_house_csv_url`, `aec_senate_csv_url`); it fetches, rebuilds, validates,
and opens a PR. To do it locally instead:

```sh
pnpm data:fetch:aec   # supply the published House + Senate nomination CSV URLs (see the bin's --help)
```

### 3. Author the source files under `data/source/<id>/`

`data/source/**` is **compliance-tier** (CODEOWNERS routes it to a signatory — see
[CONTRIBUTING.md](../CONTRIBUTING.md#review-tiers-risk-based-review)). Use `data/source/2025/` as the
template. Six files:

| File | What it is | Notes |
| --- | --- | --- |
| `questions.json` | The propositions and each party's compiled position per question. | Positions come from the **locked snapshot** (step 1), not a fresh API pull. |
| `parties.json` | Party registry: `key`, `displayName`, `aecName`, `aliases`, `kind`. | Aliases are how ballot party strings resolve; unresolved strings score "no data". |
| `ballots.json` | House + Senate candidates in official ballot order (from step 2). | |
| `candidate-mapping.json` | Approval record for the candidate↔party mapping. | `reviewer` **must** be an active id in [`docs/legal/signatories.json`](legal/signatories.json) (`check-signatories.mjs` enforces). |
| `aec-sources.json` | AEC provenance register: source URLs, coverage counts, `outputHash`. | Feeds the AEC-provenance gate. |
| `ballot-verification.json` | **Two-person** ballot attestation. | Both `reviewers.primary` and `reviewers.second` must be distinct active signatories. |

> The two review records above are not paperwork for its own sake — they are what the provenance and
> two-person gates check. Fill them with real, registered people or the build fails closed.

### 4. Add the `ELECTIONS` entry

In [`packages/data-schema/src/elections.ts`](../packages/data-schema/src/elections.ts), add the new
election to the `ELECTIONS` array (newest-first — it is the toggle order) and **flip `current`**:

- Set the new election `current: true`.
- Set the previously-current election `current: false`.
- Fill the full `timetable` from the AEC's published timetable page (link it in a comment, as the
  existing entries do). All fields matter: they drive the writ window, the snapshot lock, and the
  polling-day survey close.
- Set `dataVersion` to the last division date the positions were compiled from.

### 5. (No code to wire — the loaders are data-driven)

There is **no code step here** — this is the point of the config-only design, and it is deliberate.
The three places that load a dataset or manifest keyed by election all discover elections from disk
rather than from a hand-kept list, so a newly-committed `data/dist/<id>/` is picked up with no edit:

- [`apps/web/src/lib/data.ts`](../apps/web/src/lib/data.ts) — the client-side lazy loader uses one
  **templated** dynamic import, `` import(`$data/dist/${id}/dataset.json`) ``; Vite's
  dynamic-import-vars resolves the `$data/dist/*/dataset.json` glob and still emits a distinct,
  statically-analysable async chunk per election (verified in the build).
- [`apps/web/src/lib/manifest.ts`](../apps/web/src/lib/manifest.ts) and
  [`apps/web/src/lib/content.server.ts`](../apps/web/src/lib/content.server.ts) — use
  `import.meta.glob("$data/dist/*/…", { eager: true })` to statically bundle every committed
  manifest / (server-only) dataset.

The interpolated id in `data.ts` is guarded against the `ELECTION_IDS` registry (unknown → the
current election), so it is always a known, url-safe slug — never an unbounded or path-traversing
specifier. The guarantee that this stays code-free is pinned by
[`election-config-only.test.ts`](../apps/web/src/lib/election-config-only.test.ts).

### 6. Build the compiled dataset and commit it

```sh
pnpm --filter @how2vote/data-pipeline dataset:build
```

This writes `data/dist/<id>/dataset.json`, a checksummed `data/dist/<id>/manifest.json`, and updates
the top-level `data/dist/elections.json` index. **Commit the `data/dist/` output** — CI rebuilds it
from source and fails on any drift (`git diff --exit-code data/dist`), so committed dist must match a
fresh build exactly. Never hand-edit compiled output; change the source and rebuild.

The OG image (`static/og-<id>.png`) and the default `og.png` are regenerated automatically by
`prebuild:assets` on the next build — no manual step.

### 7. Validate, then run the full local gate

```sh
pnpm data:validate     # schema + referential integrity + snapshot-consistency (fail closed)
pnpm test              # all package tests incl. golden methodology tests
pnpm typecheck
pnpm lint
pnpm build             # confirms prebuild:assets + the static build, including the new OG image
```

### 8. Open the PR

- Branch from `main` in a fresh worktree (project convention).
- Sign off every commit with the DCO `Signed-off-by` trailer (`git commit -s`) — see
  [CONTRIBUTING.md](../CONTRIBUTING.md#developer-certificate-of-origin-dco).
- Because `data/source/**` is compliance-tier, the PR also needs a **compliance-signatory** review
  via CODEOWNERS. The reviewer must resolve to an active id in
  [`docs/legal/signatories.json`](legal/signatories.json) (`check-signatories.mjs` enforces this for
  the compliance-artefact review records).
- Fill the **Compliance-tier block** in the PR template (linked requirement, policy version, BDD
  example, automated test, sample diff, named reviewer).

## Preview and go-live

You can review the entire next election on an isolated preview before it goes live, and the go-live
timing is largely driven by the timetable rather than by the merge. Three things are worth
understanding:

**Previews.** Every PR deploys an isolated, `noindex` Cloudflare Pages preview at
`https://pr-<number>.how2vote-au.pages.dev` ([deploy.yml](../.github/workflows/deploy.yml)), torn down
when the PR closes. The preview is built in the release manifest's **draft** mode, so an
unfinished *wider* compliance programme does not block it — you get a full clickthrough (electorates /
Senate / issues / parties / quiz / card) of the new election for review.

**A preview is only green once the data is real — this is deliberate.** The data and compliance gates
([ci.yml](../.github/workflows/ci.yml), [compliance.yml](../.github/workflows/compliance.yml)) run
**fail-closed on every PR** and validate the committed dataset: `data:validate`, the two-person ballot
attestation, signatory resolution, AEC provenance, the candidate/party mapping approval, and
"research election registry matches datasets". An `ELECTIONS` entry with no committed `data/dist/<id>/`
fails these, and you cannot fabricate a passing dataset early — ballots come from AEC nominations
(post-declaration) and positions from the writ-window snapshot, and those gates exist precisely to
reject anything not backed by real, attested records. So:

- **Before nominations** you can open a *scaffold* draft PR (the `ELECTIONS`/timetable entry plus
  docs), but its checks stay red until the real snapshot and ballots land. That is a legitimate WIP
  draft, not a previewable build.
- **After the snapshot is locked and nominations are published**, you fill `data/source/<id>/`, build
  `data/dist/<id>/`, and the PR goes green and deploys a full preview. This is the earliest a real
  dataset can exist.

**Merging is not, by itself, "go live".** Three independent switches govern what the public sees:

1. **The `timetable` dates drive the plan builder** (`electionStage` / `electionPhase`), evaluated at
   wall-clock — so `upcoming` → `live` → `archived` flips **on its own with no redeploy**. You can
   merge whenever; the builder opens at `declarationOfNominations` and archives after `pollsCloseAt`
   automatically. (Note: since a valid dataset cannot exist before nominations, in practice a merged
   election is already at least `live`.)
2. **The `current` flag** sets the `/` landing and the toggle default; merging with `current: true`
   changes production's default election immediately. Flipping the *previous* election to
   `current: false` is a manual step (step 4) — the `elections.test.ts` "exactly one current" guard
   fails the build if you forget.
3. **The production release posture is the fail-closed `historical-demo` profile** (explicitly *no
   live ballot*; see [release-profiles.json](legal/release-profiles.json)). Operating a *live*
   election as the authoritative tool is a deliberate posture change (`--mode production` in
   `deploy.yml`), not a side effect of merging a dataset.

## What you do **not** have to touch

A useful negative checklist — none of these need per-election edits, because they read `ELECTIONS`
or discover the committed `data/dist/<id>/` on disk:

- route matcher / landing paths (`/<id>`), content routes under `[election=election]/`;
- the dataset and manifest loaders (`data.ts`, `manifest.ts`, `content.server.ts`) — they glob
  `data/dist/*/`, so there is **no per-election import or switch to add** (this is the config-only
  guarantee; see step 5 and `election-config-only.test.ts`);
- the election toggle UI, sitemap, structured data, `llms.txt`/`llms-full.txt`;
- OG image generation (loops `elections.json`);
- the scoring engine and share-link codec (the codec already names the election:
  `v2.<election-id>.<electorate-slug>.<payload>`).

## After it ships

- The previous election automatically becomes a past election: its landing moves from `/` to
  `/<old-id>`, and its saved quiz progress stays namespaced separately in `localStorage` (switching
  never mixes answer sets).
- On polling day the survey Insights page closes for the statutory window
  ([ADR-0014](adr/0014-election-day-notice.md)), driven by the `timetable.pollsCloseAt` you set.
- Bundle size grows by one dataset (~330 KB raw / ~35 KB gzip). All elections are bundled for offline
  use; [ADR-0002](adr/0002-multi-election-support.md) notes this is revisited only if the count grows
  large — not a concern for one-every-three-years.
