# 0002 — Support multiple elections with faithful historical data

- Status: **Accepted**
- Deciders: National Digital

## Context

The tool covers the 2019, 2022 and 2025 federal elections. A visitor can toggle between them and get,
for each, the questions, party positions and ballot as they stood at that election.

Two things are genuinely per-election: the **ballot** (candidates and electorates from that election's
AEC nominations) and the **party positions** (each party's compiled parliamentary voting record). The
hard part is the positions: They Vote For You publishes a party's record *cumulatively as of today*,
so re-deriving 2019 positions from the live API would need historical date-filtering and would still
drift as votes are added. We required positions to be **faithful to the election date**.

## Decision

1. **Datasets are per-election.** The pipeline builds one self-contained `Dataset` per election into
   `data/dist/<id>/` (`dataset.json` + `manifest.json`), plus a top-level `data/dist/elections.json`
   index. `ELECTIONS` in `@how2vote/data-schema` is the single source of truth for which elections
   exist and how they present.

2. **Historical data is the period-accurate compilation committed at each election, not a fresh
   re-derivation.** Each election's compiled `questionData.json` (positions already compiled) and
   candidate/electorate data were committed at the time. We snapshot each election's committed data at
   its final pre-poll commit (2019 → `a58e778`, 2022 → `1d5d5c4`, 2025 → the committed 2025 seed) into
   `data/v0-seed/<id>/` and migrate it through the clean-schema migrator. Because those positions were
   compiled *at the time*, this reproduces the as-of-election-date record faithfully with no
   re-derivation.

3. **Party resolution replays each election's own tables.** 2019 used a single `matchCandidates`
   table (no split/combine); 2022 used `manualMatch`/`manualSplit`/`manualCombine`; 2025 keeps its
   curated aliases. Any ballot party string that does not resolve is recorded in `noRecord` and scores
   "no data" — exactly how the original site treated an unmatched candidate.

4. **Positions for non-contesting entities are dropped.** Original `questionData` carries positions for
   every parliamentarian who ever voted on a policy, including former MPs and defunct party labels not
   on that election's ballot. Those keys resolve to no candidate and are unreachable by scoring, so
   they are dropped, keeping every position key a real party/independent. Every party actually on a
   ballot retains its own compiled position (verified: no ballot party depends on a dropped key).

5. **Share links carry the election.** The codec is now `v2.<election-id>.<electorate-slug>.<payload>`.
   A payload can only be unpacked against the right election's question ordering, so the link must
   name the election; the app resolves it before decoding. Former `v1.<slug>.<payload>` links (there
   were effectively none in the wild — prod launched the same day) are read as the current election.

6. **Per-election social previews via crawlable landing paths.** Each election gets its own OG image
   (`static/og-<id>.png`, generated at build from `elections.json`). Because social crawlers run no
   JS and never see the URL fragment, a per-election preview needs the election in a *prerendered
   path*: past elections get `/2019`, `/2022` (current stays at `/`), prerendered via a route param
   matcher that only matches past ids. Each page emits its own title, description, canonical and OG
   image, and its body is driven by the path (not the store) so it is correct without JS. The
   election toggle is a set of links to these paths, so switching produces a shareable URL with the
   right preview. The card's OG is set per-election client-side (best-effort for JS-aware unfurlers);
   a fragment-based card cannot vary its prerendered OG for a plain crawler.

## Consequences

- Adding a future election is **config + data only, no code change**: author its `data/source/<id>/`,
  build it into `data/dist/<id>/`, and add its `ELECTIONS` entry. The route matcher, content pages,
  toggle, OG images **and the dataset/manifest loaders** all derive from `ELECTIONS` or discover
  `data/dist/*/` on disk automatically (`data.ts` uses a templated dynamic import; `manifest.ts` /
  `content.server.ts` use an eager `import.meta.glob`), so there is no per-election switch or import to
  edit — a guarantee pinned by `apps/web/src/lib/election-config-only.test.ts`. The CI gate rebuilds
  `data/dist` from source and fails on drift. The full step-by-step process — for both a new election
  and a historical backfill — is the [adding-an-election runbook](../adding-an-election.md).
- All elections' datasets are bundled into the client (≈103 KB gzip for the three combined), so every
  election works offline in the PWA with no fetch. This is revisited only if the count grows large.
- The quiz keeps **separate saved progress per election** (localStorage namespaced by id), so
  switching does not mix answer sets between elections with different question ids.
- Historical merges that reference an off-ballot key become no-ops (a build **warning**, not an
  error) — the same treatment 2025 already ships for `trumpet_of_patriots`.

## Verification against AEC + TVFY

House/Senate candidate counts from the migrated ballots match the known AEC figures for each election
(2022: 1203 House / 421 Senate; 2019: 1056 / 458). Positions are the original site's ODbL-licensed
compilation; TVFY's live API returns cumulative-to-today records and so cannot re-confirm a historical
snapshot, which is exactly why the as-of-date committed data is the authoritative source here.
