# Claims register

**Purpose.** A single index of every material, externally-visible *claim* How2Vote makes
about itself — what it is, what it does, how it is scored, and how it handles data — with
the exact place each claim is worded and the place that substantiates it. The register
exists so that website copy, page metadata, structured data, social cards, the onboarding
flow, `llms.txt` and the generated `llms-full.txt` stay **consistent and defensible**: any
one of them should be traceable back to an authoritative source, and none should assert
more than that source supports.

**Scope.** Externally-visible copy only (what a visitor, crawler or answer engine can read).
It does not catalogue internal code comments or test fixtures.

> **Maintenance.** Update this register whenever externally-visible copy changes. In
> particular, when you edit any of the copy sources below (a–g), reconcile the claim here and
> confirm its substantiation still holds. The authoritative *copy* sources are, in order of
> precedence:
> - `apps/web/src/lib/org.ts` — the operating entity and the legal facts (ABN, contact,
>   authorisation, licences, data source, research min-age). Everything that names the
>   entity or states a legal fact must read from here.
> - `apps/web/src/lib/seo.ts` — per-route titles/descriptions (`pageMeta`,
>   `electionLandingMeta`), site name/URL.
> - `apps/web/src/lib/structured-data.ts` — the machine-readable claims (JSON-LD).
>
> The authoritative *substantiation* pages are `/methodology`, `/privacy`, `/terms`,
> `/about`, `/accessibility`, and the decisions of record in `docs/adr/` (chiefly
> `0006-legal-compliance-rebuild.md`). Absolute / quasi-legal wording is additionally gated by the
> enforceable register `docs/legal/absolute-claims.json` (`scripts/check-absolute-claims.mjs`).

**Neutral-language note.** The legal-compliance rebuild (ADR 0006) deliberately moved copy
to "comparison / voting plan / worksheet / evidence only" language and removed absolute
claims ("anonymous", "cannot be linked to you", "who to vote for"). Claims flagged
**[wording-sensitive]** below are ones where the *exact* wording is legally load-bearing —
do not soften or strengthen them without checking the substantiation and ADR 0006.

**Enforceable absolute-claims gate.** Categorical / quasi-legal wording — an absolute
"non-partisan" self-label, "anonymous", "unlinkable", "no personal information", "cannot
recognise/track", "IP addresses are never collected", an absolute legal-compliance claim — is
banned in public copy unless a *current, evidence-backed* permit expressly allows it at that
location. The machine-readable register is `docs/legal/absolute-claims.json`; the fail-closed
CI guard is `scripts/check-absolute-claims.mjs` (Legal group).

---

## Cross-cutting material claims (the ones that must never drift)

| # | Claim (as worded) | Substantiated by |
|---|---|---|
| C1 | **Independent / even-handed** — self-described as "independent" (the absolute "non-partisan" *self-label* is retired — see `docs/legal/absolute-claims.json`); "favours no party", "applies the same published, deterministic method to every party", two-tone (no colour) so match quality is never dressed as allegiance. | `/methodology`, `/about` ("Built to be even-handed"); enforced by the CSS neutrality lint, the absolute-claims gate and `content.server.test.ts`. |
| C2 | **Scored on real parliamentary votes** — parties are scored on their *recorded* parliamentary voting record, "not what they said in a campaign". | `/methodology` ("Where the data comes from", "From members to parties"); data via They Vote For You under ODbL (`ORG.DATA_SOURCE`, `LICENCES.data`). |
| C3 | **Does not recommend a candidate** — results are "evidence only"; "nothing is ranked, nothing is crowned"; "How2Vote never suggests who to put first"; the user authors their own preference order. **[wording-sensitive]** | `/methodology` ("Your comparison, then your plan"); ADR 0006 (Commonwealth Electoral Act 1918 ss 329, 351 — must not suggest a first preference). |
| C4 | **Describes the party, not the candidate** — a party's score "describes the party, not any individual candidate's personal views, and does not predict how a candidate would vote in future". **[wording-sensitive]** | `/methodology` ("From members to parties", "What the method does and doesn't capture"). |
| C5 | **Historical comparison** — results are historical comparisons of the record as it stood; past elections say so plainly. | `/terms`, Landing (`isPast` note), OG subline for past elections. |
| C6 | **Aggregate-only by construction, never "anonymous"** — no per-person research record is created or stored (device-derived results tallied into group counts; quiz answers/weights never leave the device); residual small-count risk acknowledged rather than an absolute claim. **[wording-sensitive]** | `/privacy` ("What is collected if you opt in", "Aggregate-only storage and residual risk"), `/methodology` ("Aggregate insights"), `/survey` gate notice; ADR 0008 (counters), ADR 0006 (absolute "anonymous" claim removed). |
| C7 | **Electorate kept separate** — electorate is held only as a running tally with nothing attached, sent as its own unlinkable request; no count pairs electorate with a result or survey answer. **[wording-sensitive]** | `/privacy` ("How electorate is handled separately", "What is never collected"); ADR 0006 (D2), ADR 0008. |
| C8 | **Indefinite retention of aggregates** — research contributions are stored only as genuinely aggregated group counts (not personal information), so they may be retained indefinitely; still reviewed after each federal election, with purpose-based (not age-based) deletion. **[wording-sensitive]** | `/privacy` ("Research retention and publication"); ADR 0008 (supersedes the earlier 15-year / pack 5-year wording); `docs/privacy/retention.md`. |
| C9 | **Usage analytics is cookieless and identifier-free** — usage is measured only in aggregate by cookieless Cloudflare Web Analytics at the edge; no analytics tag, cookie or device identifier is used, so there is nothing to consent to, and the analytics sink never receives quiz answers, weights, electorate, alignment, preference order, the share fragment or survey answers. **[wording-sensitive]** | `/privacy` (§6 "Analytics"); the registry (`$lib/privacy/registry`, `third-party-services.json`) drives the CSP + provider table; pinned by `e2e/consent.spec.ts`. |
| C10 | **Research contribution is optional opt-in** — never automatic, does not change your result, off-by-default consent control, 18+. | `/privacy` (§5), `ORG.RESEARCH_MIN_AGE`; ADR 0006 (D1/consent). |
| C11 | **Operator identity** — operated by National Digital (`ORG.tradingName`), with the full legal name and ABN as recorded in `ORG` (single source; not copied here per BRAND.md); not endorsed by any party, candidate or the AEC. | `apps/web/src/lib/org.ts` (`ORG`); `/about` ("Who makes it"), `/privacy` (§1, §15), footer authorisation (`ORG.AUTHORISATION`). |
| C12 | **Open source + open data** — app under AGPL-3.0, dataset under ODbL; every proposition links to the divisions behind it; dataset carries a checksum and data vintage. | `apps/web/src/lib/org.ts` (`LICENCES`), `/about` ("Open and checkable"), `/methodology` ("Provenance and changes"). |
| C13 | **No account, works offline, no cookies for the core tool** — runs entirely on-device; core comparison/plan needs no login. | `/privacy` (§2), `/offline` meta, `llms.txt` intro. |
| C14 | **Insights are closed on election day** — the aggregate survey analysis is not published on polling day from 00:00 until the last national poll close (8 pm AEST); it returns after polls close. | `/insights` (`InsightsClosed.svelte`: "Insights are closed for election day … from 8 pm AEST"), `/methodology` ("Aggregate insights"); ADR 0014; window from `timetable.pollsCloseAt` in `packages/data-schema` (`isPollingDayNoticeWindow`). |

---

## By source

### (a) Website copy — `.svelte` routes/components

| Location | Claim(s) | Substantiation |
|---|---|---|
| `lib/components/AboutPage.svelte` | "independent tool that turns the public record of parliament into a personal comparison and voting worksheet" (C1); "aims to favour no party … same published, deterministic method" (C1); AGPL/ODbL, checksum + data vintage (C12); "built by National Digital (legal name, ABN) … not produced, approved, registered or endorsed by any political party, candidate, or the AEC" (C11). | `org.ts` (`ORG`, `LICENCES`); `/methodology`. |
| `lib/content/MethodologyContent.svelte` | Full scoring method (C2); "evidence only … never suggests who to put first" (C3); "describes the party, not the candidate" (C4); "group counts, not individual records" + answers never leave the device (C6); electorate handling + k-anonymity threshold of 10 (C6/C7); "one reasonable reading of the public record, not the only one". | Self-substantiating (the method page is the source of record); `/privacy` for the research claims. Single source `HOWTO_STEPS` shared with the JSON-LD (source (c)). |
| `lib/content/PrivacyContent.svelte` | All privacy claims C6–C10, C13; overseas processing; provider inventory (rendered from the service registry so copy cannot disagree with the CSP/consent UI). | Self-substantiating (privacy policy is the source of record); reconciled with ADR 0006; `org.ts` for entity + min-age. |
| `lib/content/TermsContent.svelte` (meta in `seo.ts`) | "you build your own voting plan, results are historical comparisons only, always check your ballot before voting" (C3, C5). | `/terms`; ADR 0006; governing law `ORG.governingLaw`. |
| `routes/how-to-decide/+page.svelte`, `lib/content/how-to-decide.ts` | "compare your views with the parties' recorded votes in federal parliament" (C2); "How2Vote does not recommend a candidate or party"; "does not rank parties and does not recommend a preference order"; "shown beside the candidates in official ballot order, as evidence only", or, before there is a ballot, "there are no candidates or ballot yet" / "there is no ballot yet" / "How2Vote hasn't listed this election's candidates yet", or, with candidates listed before a declared, drawn ballot, "the candidates listed so far are on each electorate's page. The voting plan opens once How2Vote has the AEC's declared ballot order and it is verified", or, once held, "a historical demonstration and cannot be used to vote", or, held without electorates, "How2Vote holds no ballot for it" (C3, C5); "describes its members' recorded votes, not any individual candidate's personal views" (C4); the current election's proposition count, read from its dataset. | `/methodology`; `docs/legal/required-checks.json` (DISC-NO-RECOMMENDATION). |
| `routes/[election=election]/electorates/+page.svelte`, `buildElectorateHub` (`lib/content.server.ts`), `electorateHubCopy` (`lib/stage-copy.ts`) | Introduction and meta/og description, by stage (`lib/election-stage.ts`). With a declared ballot or a held election: "Choose your federal electorate to see every candidate on the House ballot" and "Every candidate standing in all N federal House electorates at the {election}, by state, plus each state's Senate ballot." Listed (a provisional list, before or after the declaration): "the candidates listed so far" and "How2Vote doesn't have the AEC's declared list and ballot order yet". Without: "hasn't been announced yet, so no electorates or candidates have been drawn" (no timetable); "Candidates aren't final yet, so no electorates or candidates are listed yet" (called); "How2Vote hasn't listed this election's electorates and candidates yet" (declared); "How2Vote holds no electorates or candidates for the {election}" (held). No count is stated without electorates. | The election's dataset and AEC timetable (`data/dist/elections.json`); `stage-copy.test.ts`. |
| `routes/[election=election]/postcodes/` (both pages), `lib/postcodes.server.ts`, `lib/components/PostcodeAttribution.svelte` | Web only. A postcode "falls in" an electorate, "falls mainly in" one with "a small part may be in" another (an ABS below-minimum share), or "spans more than one federal electorate"; "This applies to the 2025 federal election, on the electorate boundaries used at that election" or "the next federal election, using the electorate boundaries of the 2025 election, which were unchanged for this postcode as at 12 October 2026"; postcodes in SA, Tasmania and the ACT "are not listed" for the next election because those electorates "were redrawn on 8 October 2026"; "Postcodes do not follow electorate boundaries … the Australian Bureau of Statistics' approximation of each electorate"; "The AEC's Find my electorate search is the authoritative source for any address"; the ABS source, attribution, licence link, "adapted by How2Vote and provided without warranty". | `data/postcodes/source-record.json` (sources, method, `checkedAt`, AEC redistribution URLs; `scripts/check-postcode-staleness.mjs` fails once `checkedAt` is stale); `data/rights/rights-classes.json` (`abs-asgs-cc-by`); https://electorate.aec.gov.au/; `postcodes.server.test.ts`, `e2e/postcodes.spec.ts`. |
| `routes/accessibility/+page.svelte` (meta in `seo.ts`) | "WCAG 2.2 AA target, keyboard and screen-reader support, no drag-and-drop, text alternatives". | `/accessibility`; ADR 0006 (WCAG 2.2 AA / DDA 1992). |
| `lib/components/Landing.svelte`, `lib/components/LandingIntro.svelte`, `lib/stage-copy.ts` | `trust` list (`Landing.svelte`): "Built from real parliamentary voting records" (C2); "Even-handed — the method is public and deterministic" (C1); "No account, works offline, analytics off by default" (C9, C13). Lede (`landingLede` in `lib/stage-copy.ts`): "Answer N real questions parliament has voted on … how your views compare with the parties' recorded votes" (C2). Stage-aware (`lib/election-stage.ts`): with no timetable, "hasn't been announced yet, so this is a provisional comparison"; called, "Candidates for this election aren't final yet, so this is a provisional comparison"; listed (electorates before the declaration), "How2Vote doesn't have the AEC's declared candidates and ballot order yet, so this is a provisional comparison"; declared but not loaded, "The AEC has declared the candidates for this election, but How2Vote hasn't listed them yet … the questions may change until it does"; once held, "historical comparison, scored on the record as it stood then" (C5). | `/methodology`, `/privacy`, `/about`. |
| Footer / authorisation component | Electoral authorisation string (site + comparison content only, not user output). | `org.ts` (`ORG.AUTHORISATION`); ADR 0006 (Commonwealth Electoral Act s 321D; s 351(5) rationale for not authorising user output). |

### (b) Page metadata — `apps/web/src/lib/seo.ts`

| Symbol | Claim(s) | Substantiation |
|---|---|---|
| `pageMeta["/"]` | Title "How do your views compare with the parties? — How2Vote"; desc "Answer real questions the current Parliament has voted on and see how your views compare with the parties, scored on their recorded votes — not their promises." (C2, C3 framing). | `/methodology`. Count-free by design. |
| `pageMeta["/about"]` | "independent voting-record comparison tool that scores parties on their real parliamentary voting record, not their promises." (C1, C2). | `/about`, `/methodology`. |
| `pageMeta["/methodology"]` | "every party is scored on its recorded parliamentary votes, then compared question by question with your answers." (C2). | `/methodology`. |
| `pageMeta["/privacy"]` | Data-handling summary (C6–C13). | `/privacy`. |
| `pageMeta["/how-to-decide"]` | "Compare what you care about with the parties' recorded votes in federal parliament. How2Vote does not rank parties or recommend who to put first." (C2, C3). Stage-neutral, since it also feeds llms.txt. | `/how-to-decide`, `/methodology`. |
| Postcode page and index meta (`buildPostcodePage`, `buildPostcodeHub` in `lib/postcodes.server.ts`) | "Postcode {n} falls in the federal electorate of {name} for {election}", "falls mainly in {name}; a small part may be in {other}", "spans more than one federal electorate ({names}) … Check your address with the AEC"; next election phrased "the next federal election (2025 boundaries, as at 12 October 2026)"; index: "Find the federal electorate or electorates each Australian postcode falls in for {election}, listed by state." | As for the postcode pages above. |
| `pageMeta` (`/terms`, `/accessibility`, `/insights`, flow routes) | C3, C5 (terms); WCAG (accessibility); "Anonymised, aggregate insights" (C6); flow-route descriptions marked `index:false`. | Respective pages; `/privacy`. |
| `electionLandingMeta(label)` | "Compare your views with the parties' real parliamentary voting record for the {label}, House and Senate." (C2). | `/methodology`. |
| `SITE_NAME` = "How2Vote", `SITE_URL` = "https://how2vote.au" | Brand + canonical origin. | Single source consumed by (c), (f), (g). |

### (c) Structured data (JSON-LD) — `apps/web/src/lib/structured-data.ts`

| Symbol | Claim(s) | Substantiation |
|---|---|---|
| `SITE_DESCRIPTION` | "An independent tool to compare your views with parties' real parliamentary voting records for Australian federal elections." (C1, C2). Used by WebSite + WebApplication `description`. | `/methodology`, `/about`. |
| `siteGraph()` → Organization node | **Publisher is the operating ENTITY:** `name = ORG.tradingName` ("National Digital"), `legalName = ORG.legalName`, `sameAs = [ORG.website]` (C11). Brand "How2Vote" stays on WebSite/WebApplication `name`. | `org.ts` (`ORG`). See item 21. Test `structured-data.test.ts` pins the Organization `@id` only. |
| `siteGraph()` → WebSite/WebApplication | `name = SITE_NAME` (brand); `publisher → ORG_ID`; `isAccessibleForFree`, free `Offer` (C13); `sameAs = [SOURCE_REPO_URL]` (C12); "works offline as a PWA" (C13). | `seo.ts`, `org.ts`, `/about`, `/offline`. |
| `insightsDatasetGraph()` | "Anonymised, aggregate results … published with k-anonymity suppression. Descriptive only — an opt-in, non-probability sample, not a representative poll." (C6); no `license` asserted (deliberate). | `/insights`, `/privacy` (thresholds); comment in-file explains the missing licence. |
| `openDataDatasetGraph()` | Dataset of the static `/data/` files (propositions, recorded party positions, candidate ballots); each `DataDownload` states its own `license` and `creditText` from the rights register (ODbL + TVFY attribution for propositions/positions, CC BY 4.0 + AEC attribution for candidates); no Dataset-level licence (mixed sources, deliberate). | `data/rights/rights-classes.json`; `/methodology` ("Provenance and changes"); `open-data.server.test.ts`, `structured-data.test.ts`. |
| `HOWTO_STEPS` / `methodologyHowToGraph()` | The three onboarding steps + "build your own voting plan" (C3). Single source shared with the visible `/methodology` "In short" list. | `/methodology`; `structured-data.test.ts` asserts JSON-LD == `HOWTO_STEPS`. |
| `electionEventGraph()` / `electionEventNode()` | Each election with a recorded polling day is an `Event`: `name` = registry label, `startDate` = `endDate` = polling day, `eventStatus` = `EventScheduled`, `location` = Place "Australia" (`addressCountry` AU), `organizer` = the Australian Electoral Commission, `url` = the election's own landing path (omitted while it is current). An election with no polling day emits nothing. | `ELECTIONS` registry (`packages/data-schema/src/elections.ts`, transcribed from the AEC timetable); `structured-data.test.ts`, `e2e/structured-data.spec.ts`. |
| `ballotPageGraph()` / `houseBallotList()` / `senateBallotList()` (electorate + Senate pages) | A `CollectionPage` (page URL, page heading) whose `about` is the election `Event`, `spatialCoverage` the electorate/state, and `mainEntity` the ballot `ItemList`: House candidates at their printed ballot position; Senate candidates nested per group ("Group X" / "Ungrouped", in printed order) at their within-group position. Each candidate is a `Person` with the printed name and the printed ballot label as `affiliation` (not `memberOf`: a ballot label is not proof of membership); omitted for a blank, "Independent" or own-name label. Candidates only: no office held, alignment, rank or `itemListOrder`; no fields beyond the ballot line (candidate minimisation). | AEC ballot data as rendered on the same page; `structured-data.test.ts`, `e2e/structured-data.spec.ts` (JSON-LD == visible groups and rows). |
| `faqGraph()` (via `content.server.ts`) | Factual "which parties are recorded agreeing/disagreeing" Q&A on the issue pages — data facts only (C2). | The dataset (They Vote For You); `content.server.test.ts`. |
| `faqGraph()` (via `content/how-to-decide.ts`) | The /how-to-decide questions, each answer identical to the paragraph shown under its heading: compare views with recorded votes (C2), the current election's proposition count (from the dataset), the They Vote For You source, a party's position describing its members' recorded votes rather than a candidate's views (C4), and that How2Vote does not rank parties or recommend a candidate, party or preference order (C3). Stage-aware (`stageFor` in `lib/election-stage.ts`, six stages): unannounced (no timetable, no electorates), "hasn't been announced"; called (timetable, no electorates), "candidates … aren't final yet"; listed (electorates before the declaration of nominations), "your answers are compared with the parties' recorded votes, as evidence only; the candidates listed so far are on each electorate's page" and "The voting plan opens once How2Vote has the AEC's declared ballot order and it is verified"; declared (nominations declared, no electorates loaded), "How2Vote hasn't listed them yet, and the propositions may change until it does"; ballot (declared and loaded), official ballot order and an 18+ voting plan; held, a historical comparison and a historical demonstration plan, or without electorates, "How2Vote holds no ballot for it … as a historical comparison and evidence only". | `/methodology`; `how-to-decide.test.ts`, `e2e/how-to-decide.spec.ts`. |

### (d) Social cards — `apps/web/scripts/generate-og.mjs` + `scripts/og-taglines.mjs`

| Location | Claim(s) | Substantiation |
|---|---|---|
| `generate-og.mjs` `svgFor()` subline (current election) | "Independent — scored on parties' real parliamentary votes." (C1, C2). **[wording-sensitive]** — this is a standalone marketing claim on a shared image; keep it matched to C1/C2 copy and clear of the absolute "non-partisan" self-label banned by `absolute-claims.json`. | `/methodology`, `/about`. |
| `generate-og.mjs` `svgFor()` subline (past election) | "The {year} federal election, scored on the record as it stood then." (C5). | `/terms`, Landing `isPast`. |
| `og-taglines.mjs` `TAGLINE_1` | Baked outline of "Their promises are words." (brand tagline; frames C2). | Regenerated by `generate-brand-mark.py`; brand copy. |
| `og-taglines.mjs` `TAGLINE_2` | Baked outline of "Their votes are on the record." (brand tagline; frames C2). | As above. To change the words, edit `generate-brand-mark.py` and rerun — the `.mjs` is generated, not hand-edited. |

### (e) Onboarding flow copy — Landing / ballot / quiz / review / survey / card `.svelte`

| Location | Claim(s) | Substantiation |
|---|---|---|
| `components/Landing.svelte`, `components/LandingIntro.svelte`, `components/LandingActions.svelte`, `lib/stage-copy.ts` | See (a) — trust list (`Landing.svelte`), lede, stage note and steps ("Ballot / Answer / Compare") (`LandingIntro.svelte`), CTA "See how my views compare" (`LandingActions.svelte`) (C1, C2, C5, C9, C13). | `/methodology`, `/privacy`, `/about`. |
| `/ballot` (meta + page) | "Choose your state and federal electorate … your House and Senate ballot paper." | `seo.ts` `pageMeta["/ballot"]`; `/methodology` step 1. |
| `/quiz`, `/review` (meta + pages) | "Answer {n} real questions that parliament has voted on … ~5 min", {n} = the active question count of the election being answered (`quizDescription`; prerendered with the current election's, `CURRENT_QUESTION_COUNT`), omitted when unknown (C2); "Check and change your answers before How2Vote builds your personal voting comparison." | `seo.ts`; `/methodology`. |
| `/survey` (meta + page) | "An optional research invitation before you build your voting plan … Contributing is your choice and never changes your result." (C10). | `seo.ts` `pageMeta["/survey"]`; `/privacy` §5. |
| `/card` (meta + page) | "See how your answers align with each candidate's party record in official ballot order, then build your own voting plan" (C3, C4). Export/authorisation note (user authors the order). Hint (`cardHint` in `lib/stage-copy.ts`, by stage): "as evidence only … How2Vote does not tell you who to put first", or, before there is a ballot, "hasn't been announced" / "Candidates for this election aren't final yet, so there is no ballot yet" / "How2Vote hasn't listed this election's candidates yet" with "a provisional comparison against the parties, not a recommendation"; with candidates listed before a declared, drawn ballot, the chambers hint ending "How2Vote doesn't have the AEC's declared candidates and ballot order yet, so there is no voting plan to build yet", with panels not described as in ballot-paper order; for an election held without a drawn ballot, "This election has already been held and How2Vote holds no ballot for it; this is a historical comparison against the parties, not a recommendation" and, in place of the plan builder, "How2Vote holds no declared ballot for this election, so there is no plan to build", with no historical-demonstration banner (C3, C5). | `seo.ts`; `/methodology`; `org.ts` (`AUTHORISATION` rationale), ADR 0006. |

### (f) `llms.txt` — `apps/web/src/routes/llms.txt/+server.ts`

| Symbol | Claim(s) | Substantiation |
|---|---|---|
| `INTRO` | "An independent tool to compare your views with parties' real parliamentary voting records …"; "each party is scored on its recorded parliamentary votes"; "sets no cookies and runs … entirely in the browser"; "methodology is public and deterministic" (C1, C2, C9/C13). | Mirrors `SITE_DESCRIPTION` (c) and `/methodology`. Keep this hand-owned prose in sync with `SITE_DESCRIPTION`. |
| `DATA` | "Party positions are derived from real parliamentary voting records"; dataset "carries a tamper-evident checksum and a data vintage" (C2, C12). | `/methodology`, `org.ts` (`LICENCES`, `DATA_SOURCE`). |
| `dataFiles()` | Lists the `/data/` JSON files per election with each file's licence id (C12). | `apps/web/src/lib/open-data.server.ts` (rights register). |
| `RECORDS` postcode links | "[electorates by postcode]" beside each election that has postcode pages (2025 and next; web build only). | The postcode pages above. |
| `RECORDS` + `## Pages` list | Generated from `indexableRoutes`/`pageMeta` (source b), so per-page claims are inherited, not restated. | (b). |

### (g) Generated `llms-full.txt` — `apps/web/src/lib/content.server.ts`

| Symbol | Claim(s) | Substantiation |
|---|---|---|
| `fullCorpus()` header line | "Every position below is a party's or independent's recorded parliamentary voting record, sourced from They Vote For You and placed on a 1–5 scale … It is the record, not a prediction or endorsement; How2Vote is non-partisan. Candidate lists are as declared by the Australian Electoral Commission." (C1, C2, C4). | The committed dataset; `/methodology`; `org.ts` (`DATA_SOURCE`). Body is fully generated from data (no hand-authored claims) — non-partisan by construction, asserted by `content.server.test.ts`. |
| `STANCE` labels | "Strongly agrees / Agrees / Equal merits / Disagrees / Strongly disagrees" — the 1–5 scale wording, shared with the data-derived pages. | `/methodology` (the five bands). |

---

## Known copy-consistency watch-points

- **Question counts** differ by election (for example 2025: 50, 2022: 36), so copy never
  states one literally. Election-specific copy (the Landing lede and steps, the `/quiz`
  description, the `/offline` checklist) takes it from the election's data; election-independent
  copy (`pageMeta["/"]`, the store listings' `howItWorks`) is count-free.
  `question-count.test.ts` fails if a literal count returns, or if a manifest's
  `counts.questions` differs from its dataset's active questions.
- **`SITE_DESCRIPTION` (c) vs `llms.txt` `INTRO` (f)** are two hand-authored copies of the
  same non-partisan one-liner. Change both together.
- **OG sublines (d)** are standalone claims baked into images; they are not generated from
  the copy sources, so they must be reconciled by hand against C1/C2/C5.
- **Absolute-language ban (enforced):** never reintroduce "anonymous" (use "de-identified"),
  "cannot be linked to you", "unlinkable", an absolute "non-partisan" self-label (use
  "independent"), "no personal information", "IP addresses are never collected", "neutral" as an
  absolute, or any "who to vote for" framing — these are the highest-risk regressions. This ban is
  now machine-enforced by
  `scripts/check-absolute-claims.mjs` against `docs/legal/absolute-claims.json`: any such wording
  fails CI unless a current, evidence-backed permit expressly allows it at that location.
