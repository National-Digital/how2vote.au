# 0018 — Native iOS core for the answer-to-card path

- Status: Accepted (planned — not yet implemented)
- Deciders: National Digital

This ADR records the decision to answer App Review guideline 4.2 by rebuilding the app's
*interactive core* natively on iOS — the questionnaire, the card and the ballot-order path — over
the existing shared scoring engine, leaving the document pages and the modal compliance chrome in
the WebView and the web and Android channels unchanged. It replaces an earlier, unreleased draft of this record that proposed a
peripheral capability layer (widgets, system intents, a Control Center tile) instead; that approach
is retained here as a deferred follow-on, not as the answer to 4.2. It does not change the product
boundary ([0010](0010-constrained-product-boundary.md)), the privacy posture
([0006](0006-legal-compliance-rebuild.md)) or the offline guarantee
([0001](0001-static-client-scored-pwa.md)).

## Context

The shells bundle the already-built web app, register four Capacitor plugins (app, browser,
preferences, share) and add no capability of their own. App Review rejected v1.3.21 on 18 August
2026 — reviewed on an iPad Air 11-inch — as "not sufficiently different from a web browsing
experience", pre-emptively discounting push notifications, Core Location and sharing. A written
reply was sent and the finding was restated on 21 August, so the clarification path is spent: the
next move has to be a build, not an argument.

Two facts decide the shape of that build.

**The guideline names what the reviewer sees on opening the app.** Capabilities that live outside
the app — a home-screen widget, a Control Center tile, Spotlight results, icon shortcuts — leave
the app itself unchanged. A reviewer taps the icon and lands in the same WebView that was refused
twice. Investing the largest available increment in the periphery does not address the sentence in
the rejection.

**The app is not one undifferentiated surface.** It is 27 routes and 32 components, ~11.3k lines of
Svelte over ~6.7k lines of library TypeScript, and those routes divide cleanly:

- an **interactive core** — `start`, `quiz`, `card`, `ballot`, `review`, `saved` — where the value
  is gesture, ordering, input and accessibility, all of which are better native;
- **document pages** — `about`, `privacy`, `terms`, `methodology`, `accessibility`, `glossary`,
  `corrections`, `contact`, `research`, `insights`, `offline` — twelve of the twenty-seven, which
  are text, and where a native rewrite buys nothing a reviewer would notice.

Rebuilding the documents natively is worse than merely wasteful: six compliance guards address the
public copy **by file path**, so a second copy in Swift either defeats those registers or forces
all six to learn a second location. A 4.2 argument is the worst possible reason to fork the
legally-sensitive copy.

Those guards bind to the copy in two different ways, and a native core defeats each differently:

- **Explicit file lists.** `scripts/check-terms.mjs` holds `WIRING = ["apps/web/src/routes/card/+page.svelte", …]`
  and greps each entry for `termsAcceptance` and `termsAcceptance.accepted`; `docs/legal/required-checks.json`
  names `apps/web/src/routes/card/+page.svelte` under `DISC-NO-RECOMMENDATION`. A native card screen
  is simply absent from these lists, so the gate it is supposed to enforce goes unenforced in silence.
- **Prefix-scoped scanners.** `scripts/check-neutrality-claims.mjs` sets `SCAN_PREFIX = "apps/web/src/"`
  and bans recommendation verbs (`we recommend`, `you should vote`, `vote 1`, …) across everything
  beneath it. Swift under `apps/mobile/ios/` falls outside that prefix entirely, so partisan copy in
  a Swift file would be invisible to the scanner whose whole purpose is to catch it.

The second is the more dangerous of the two: an absent allow-list entry is a gate that does not
fire, but an out-of-scope scanner is a ban that does not apply. D8 and D9 below exist to close both.

Four constraints bound any answer. The first three are unchanged and non-negotiable; the fourth is
amended by D6 below.

1. **Nothing may leave the device.** Answers and weights are on-device by design; the declared
   network surface is the contact form and the opt-in aggregate research contribution
   ([0008](0008-aggregate-counters.md)).
2. **"Clear all my How2Vote data" must stay complete.** The control sweeps namespaces, not key
   lists (`apps/web/src/lib/privacy/local-data.ts`), and `scripts/check-clear-all.mjs` fails the
   build if any store escapes them. State written outside the `how2vote:` namespace is unsweepable
   by construction and invisible to the guard.
3. **Nothing may put a political preference on a shared surface.** A home screen, a lock screen or
   a Control Center tile is visible to whoever is holding or standing near the device. A party
   match or a plan's top preference on any of them is a coercion surface.
4. **Channels may not drift.** `scripts/check-store-channel.mjs` enforces that the three channels
   are one product shipped three ways.

Australia is roughly 55–60% iOS, so the iOS channel is the larger half of the reachable audience.
That is what makes this worth building rather than conceding.

## Scope and size

Measured against the tree at the time of writing, so the estimate is grounded rather than assumed.

The engine is already portable: 876 lines across six modules with 1,191 lines of tests, and free of
DOM and browser globals today (`document`, `window`, `localStorage`, `navigator` and `fetch` appear
nowhere in `packages/engine/src` outside a comment). D2's JavaScriptCore assumption therefore needs
no engine change, and D5 has three golden fixtures to assert against from day one
(`ballot-paper-2025-act.json`, `card-2019-bean.json`, `card-2025-bean.json`). The data is a static
payload — 1.1 MB across `data/dist/`, one `dataset.json` per election at ~334 KB — so the native
layer decodes files and needs no server or API.

The interactive core to reproduce:

| Surface | Lines |
| --- | --- |
| 6 route pages (`start`, `quiz`, `ballot`, `review`, `card`, `saved`) | 2,922 |
| 14 components | 1,887 |
| 17 library modules | 1,839 |
| **Total** | **~6,650** |

The distribution is lopsided and should drive sequencing: `routes/card/+page.svelte` alone is 1,787
lines — 27% of the whole — while `quiz` (223) and `review` (236) are close to trivial natively.

Estimated **5,000–8,000 lines of Swift plus tests, at roughly 3–5 weeks** of focused work: about a
week for the JavaScriptCore bridge, data layer and D5 parity harness; a week for
start/ballot/quiz/review; one and a half to two weeks for the card; then the Dynamic Type and
VoiceOver passes, which are the point of the exercise and so cannot be trimmed to make the number
smaller.

## Decisions of record

**D1 — A native core, a WebView for documents.** The `start → quiz → card → ballot/review` path and
`saved` are rebuilt in SwiftUI/UIKit; the document routes continue to render in the existing
WebView. This is an ordinary native application shape, and it targets the objection precisely: the
screens a reviewer exercises are native, and the legally-registered copy stays exactly where CI
expects it. The election browse routes (`electorates`, `issues`, `parties`, `senate`) stay in the
WebView for this release and are candidates for a later increment.

**D1a — The card stays web, and the boundary is legal ownership.** *(Amends D1, 2026-08-27.)* The
native core is `landing → quiz → ballot → review`; `card` remains a WebView route alongside the
other documents. D1 drew the boundary around "screens a reviewer exercises"; this draws it around
**who owns the legally-registered wording**, which is the property that will not shift. The card
carries the s321D print authorisation and sits behind the Terms gate, and a native card would move
that copy out of the files the path-scoped guards read — requiring the copy register to grow a third
mode for print- and modal-shaped chrome, so that electoral-law wording could exist in two renderings
instead of one. The split also falls on a real seam in the product: the selection experience is an
*interaction* (device-owned state, native input, the dataset resolved offline in JavaScriptCore),
while the card is a *document* — printed, shared, authorised. Guideline 4.2 asks what the app does
that a browser cannot, and the whole of that answer lives on the interactive side.

Two consequences, both simplifications. The card's D8 islands are no longer needed — the card is not
a native screen, so there is nothing for an island to embed in — and D9's second guard change (a
`WIRING` entry in `scripts/check-terms.mjs` for a native gate) has no subject and is withdrawn.
What this decision does buy is a **visual** obligation rather than a legal one: `review` is native
and `card` is not, so the transition between them must not read as a mode change. The mechanics are
already right — the cover is taken down with `dismiss(animated: false)` onto a WebView that has
already rendered the route underneath, so there is no load flash — leaving the native top bar and
the web's sticky chrome to line up closely enough that the cut is not the thing the voter notices.

**D2 — One engine, never two.** `@how2vote/engine` (`answers`, `scoring`, `ballot`, `card`,
`share`) is the single source of every result. The native layer runs the same compiled engine in
**JavaScriptCore** — a system framework, no new dependency and no network — behind a single-file
bundle step, and is a view over it. Scoring, ordering and card construction are **never**
reimplemented in Swift: two implementations of the matching logic would eventually disagree about
the same answers, which is the only drift that matters for a voting tool. The engine bundle must
stay free of DOM and browser globals, asserted in CI, or it silently stops being runnable there.

**D3 — One state, one namespace, one writer per key.** The native core reads and writes the same
`how2vote:` keys, in the same place: Capacitor's Preferences plugin is backed by `UserDefaults`, so
writing through `UserDefaults` under the plugin's namespace (`CapacitorStorage.`) puts native state
exactly where the WebView, the durable mirror and `clearLocalDeviceData()` already look. No second,
unsweepable store appears, and `scripts/check-clear-all.mjs` keeps working unchanged.

The mirror itself cannot simply be shared, which an earlier draft of this decision assumed it could.
`native-storage.ts` treats `localStorage` as the sole source of truth: its backup pass PRUNES every
`how2vote:` key that Preferences holds and `localStorage` does not, then overwrites the rest. Against
a key the native core wrote — which this WebView has never seen — that deletes a voter's in-progress
answers on the next visibility change. Verified against the shipped module before any native state
was written.

So ownership is declared at runtime and each key has exactly one writer. The native core writes
`how2vote:native-core:v1` to Preferences at launch, and the mirror stands down for the prefixes it
names (`quiz:`, `saved:`, `election:`) only when it finds that marker — restoring them into
`localStorage` so the WebView can READ native state, never mirroring them back. Everything else
(terms acceptance, consent, the eligibility bit, theme) stays the WebView's, which lines up with the
compliance chrome living in the D8 islands.

The claim is made at runtime rather than inferred from the build channel because the question is not
"is this iOS" but "is the native core the writer of this key", and those come apart: the iOS build
renders some routes natively and some in the WebView (D1, and the D4 fallback), so ownership is
per-screen where a channel is per-build. A channel gate would also claim native ownership in every
release shipped before the native screens existed, removing eviction protection from state the
WebView was still the sole writer of. Two consequences follow and are enforced rather than
remembered: `NativeState.set` refuses to write before `claimOwnership()` has run, because state
written ahead of the claim is state the next backup pass prunes; and **no route served by the WebView
may write a native-owned key**, which bounds what D4 may fall back to.
`scripts/check-native-state-keys.mjs` holds both sides to the same marker, prefixes and namespace.

**D4 — Unknown content falls back to the WebView.** Any question type, card section or route the
native layer does not recognise renders in the WebView instead. The failure mode of a web-side
addition is therefore "this screen looks like the web app", never "this screen shows the wrong
thing" or "this content is missing". A CI check names every type without a native renderer, so the
fallback is a visible warning rather than a silent regression. Bounded by D3: the fallback may render
a native-owned surface but must not WRITE a native-owned key, or the single-writer rule breaks in the
direction that costs a voter their answers.

**D4a — The WebView asks; the shell may decline.** Route handover is a call the web layer makes
(`NativeRouterPlugin.present`), not something the shell infers by watching the WebView's URL. Under
the alternative, every web-side routing change is a silent native behaviour change and the shell has
no way to say no. Here declining is a first-class answer — an unknown route, an engine that will not
load, a dataset that will not decode — and the web then renders its own screen, which is D4's
fallback rather than a failure. Capacitor's bridge controller stays the window's root and the native
screen covers it: re-rooting buys nothing a voter can see and puts every Capacitor assumption about
its own view controller in play at once. A route asked for and declined must also not have written
anything, so the asking page waits for the answer before loading or persisting — a WebView-served
route may render a native-owned surface but must not write one (D3).

**D10a — The emergency levers stay single-implementation, and are answered rather than re-evaluated.**
The control plane (`data/governance/control-plane.json`, ADR 0006) is a fail-closed, digest-verified
suspension register: a tampered artefact refuses every capability. A native re-evaluation of it would
be a second implementation of the one mechanism the product relies on during a campaign, and the two
could disagree about whether something is suspended — the failure mode being that iOS keeps showing
what every other channel has withdrawn. So the native core never evaluates the plane. The WebView
resolves the levers with its single implementation and hands the ANSWER over, as it already does for
the 18+ declaration (D3): the allowed map ids are passed to the native ballot, and an absent or empty
list renders no maps at all, so a handover that fails leaves the lever closed rather than open.

**D4b — The handover is proved at runtime, not only in the wiring.** Every static guard over the
handover passed while the native core was never once reached: the plugin was registered natively and
the web never asked it anything, because an app-target plugin ships no JavaScript and so never
appears in `Capacitor.Plugins` — the web must ask the bridge for a proxy by name. The app built,
launched, screenshotted and reported success, serving the web screens it always had. Wiring checks
can only ever prove the parts match; they cannot prove the thing runs. So CI launches the built app
on a simulator and reads the shell's own markers, failing when the native core was never asked or
declined a route it should serve. The screenshot it keeps is the other half: with no simulator on the
development machine, it is the only place these screens are seen before TestFlight.

**D5a — Presentability is the engine's decision, not Swift's.** Which questions may be shown is
`activeQuestions` (ADR 0005), and the ordering the share codec is positional over deliberately
differs from it. The native bridge exposes both through one `questions` entry point rather than
letting Swift filter the dataset, because the two lists are identical in every committed election —
nothing is withdrawn today — so a native core that presented the share ordering would pass every
golden artifact and every check in the repository, and show a withdrawn question to a voter the
first time one existed. The distinction is pinned on a synthetic dataset in `native.test.ts` for
that reason.

**D5 — Parity is proven, not asserted.** The engine's existing golden fixtures
(`packages/engine/src/__golden__`, exercised by `golden.test.ts` and `golden-output.test.ts`) are
run through the native path and asserted byte-identical. Question order stays pinned by
`question-order:check` against the compiled dataset, which the native UI reads rather than copies.

**D6 — A bounded, declared iOS-only gap, amending constraint 4.** The **user interface** of the
core may differ between iOS and the other channels. **Capabilities and results may not**: every
channel offers the same functions and, because of D2 and D5, produces identical output for
identical answers. `scripts/check-store-channel.mjs` is extended to encode exactly that boundary,
so the gap is enforced at its declared width instead of being argued case by case. Android and web
are unchanged by this ADR.

**D7 — iPad is a first-class target.** v1.3.21 was reviewed on an iPad, where the app is an
orientation-unlocked WebView with no pointer, keyboard or drag affordances of its own. The native
core ships hardware-keyboard shortcuts, pointer interactions, native context menus and
drag-to-reorder for preference ordering — the interaction that is most obviously native and most
obviously better than its web equivalent.

**D8 — Compliance chrome stays web, as embedded islands.** The card's legally-registered chrome is
already modal- or print-shaped: `TermsGate` (`routes/card/+page.svelte:891`, `:1181`),
`PrintAuthorisationDialog` (`:1225`) and `PlanAuthorisationBand` (`:1190`). Each renders in a
`WKWebView` embedded as one subview of the native screen — a sheet, or the print/share output —
loading the same local route the web app serves. A sheet of legal text is indistinguishable native
or web, so the interaction cost is nil, and the copy never leaves the file the guards already watch.
Islands are **not** used for inline copy: the "these numbers are your choice" notices sit inside the
ballot layout (`:998`, `:1005`, `:1140`), and a web strip nested in a native scroll view buys a
seam, a sizing race and nested scrolling to save nothing. Inline copy is handled by D9 instead.

**D9 — Required copy is generated, never authored in Swift.** The notice strings the native screens
render inline are emitted as a generated Swift constants file from the registries that already hold
them (`docs/legal/required-checks.json` disclaimers, `docs/legal/terms-registry.json`
`requiredWording`). There is therefore exactly one copy of every required notice, not two that can
drift. Three guard changes make this fail closed:

1. `scripts/check-neutrality-claims.mjs` extends `SCAN_PREFIX` to cover the iOS app target, so
   banned recommendation copy is caught in Swift as it is in Svelte.
2. `scripts/check-terms.mjs` gains the native gate's path in `WIRING`, so the native share and print
   actions must demonstrate the same `termsAcceptance.accepted` gate as the web card.
3. A new check asserts the generated Swift file matches its JSON source, so hand-editing the copy
   breaks the build instead of quietly shipping a second wording.

Taken with D8, **no compliance copy is authored in Swift at all** — it is either behind an island or
generated — and the guards keep their teeth without being reimplemented in a second language.

**D10 — Platform target and the width of visual parity.** Minimum target is **iOS 17**, which gives
modern SwiftUI and `UISheetPresentationController` with no back-compat layer. `ElectorateMap.svelte`
(299 lines) is rebuilt natively as **drawn paths**, not islanded: it is interactive and inline, the
two properties that make an island wrong. An earlier draft of this decision said MapKit, which was
wrong on two counts. The committed boundary data is not geographic — `apps/web/static/maps/` holds
already-projected SVG outlines in a flat viewBox, using only `M`, `L` and `Z` — so there is nothing
for MapKit to place, and feeding it lat/lon would mean reprojecting and drifting from what the other
channels draw. MapKit also fetches tiles, which would put a network dependency inside a screen the
offline guarantee covers ([0001](0001-static-client-scored-pwa.md)) and add a declared network
surface for no gain. A path renderer reproduces the same outlines from the same file. Native screens track the web and Android design
**generally, not exactly** — the same visual language, hierarchy and colour, with native idiom where
it improves the result. Exact pixel parity is explicitly not a goal; reading as the same product is.

**D11 — Deferred, not rejected.** WidgetKit widgets and their Glance mirror, App Intents with
CoreSpotlight/AppSearch indexing, a `ControlWidget`/`TileService`, and polling-day Live Activities.
These remain worth building, and the Spotlight indexing of the bundled reference content has value
independent of App Review — but they are follow-ons once the app itself no longer reads as a
browser, not the argument that it does not. Live Activities additionally have nothing to show until
an election carries a `date`: the current election is the placeholder `next` with
`provisionalStage: "pending"` (`packages/data-schema/src/elections.ts`).

**D12 — Permanently refused.** Wallet passes and Files/document export (constraints 1 and 2: a pass
must be signed server-side, and both write state outside the swept namespace), and push
notifications, Core Location and geofencing (no live call site, an unnecessary permission
declaration, and discounted by App Review in any case). Reopen only on new facts.

## Alternatives considered

- **A peripheral capability layer as the answer to 4.2** — the previous draft of this record:
  widgets, system intents, a Control Center tile and native quick actions, on both platforms. It is
  the largest increment that touches nothing a reviewer opens, it doubles its own cost by mirroring
  an Apple-specific problem onto Android under constraint 4, and its widget content is thin while
  there is no election date to count down to. Kept as D11.
- **Rebuilding all 27 routes natively.** Removes the hybrid seam, and is roughly an order of
  magnitude more work than the core alone. Decisive against: it duplicates the path-registered
  compliance copy that six guards address by filename.
- **Rebuilding the compliance chrome natively.** Would remove the D8 islands and give one
  uninterrupted native surface. Refused: it moves legally-reviewed, path-registered copy into files
  no existing guard reads, to improve screens a user sees once. The chrome is already modal- or
  print-shaped, so an island costs nothing a user would notice, where a fork of the copy costs the
  registers their authority.
- **Reimplementing scoring in Swift.** Would make the native core self-contained and would
  guarantee eventual divergence between what a voter sees on the web and in the app. Refused under
  D2 on those grounds alone.
- **Replying to App Review again.** Spent — the finding was restated on 21 August after a written
  reply.
- **Accepting that the iOS channel is closed.** Still the fallback if this increment is refused,
  but it forfeits the larger half of the Australian audience without having attempted the thing
  the guideline actually names.

## Consequences

- **Two UI implementations of the core, permanently.** Svelte for web and Android, SwiftUI for iOS.
  D2 and D5 keep the *logic* single-sourced so the two cannot disagree about results; nothing keeps
  the *interface* single-sourced, and every core-screen change is two pieces of work from here on.
  This is the real cost of the decision and it is ongoing, not one-off.
- **A hybrid seam to maintain.** Two navigation systems, deep links (`appUrlOpen`) routing into
  both, and visual consistency across the boundary. Bounded and well-trodden, but real. The D8
  islands add a second, smaller seam inside the card screen: a sheet's web content must match the
  native screen's type scale and colour scheme closely enough not to read as a foreign panel.
- **No state migration is required.** D3 keeps the native core on the same `how2vote:` keys, so an
  updating install keeps its answers and saved cards. The single existing TestFlight tester is
  informed directly rather than through migration machinery.
- **Accessibility moves from liability to asset, then needs keeping.** Dynamic Type does not
  auto-apply in a WKWebView — the known risk in the ASC accessibility labels — and does apply
  natively. VoiceOver behaviour likewise improves, and both then need testing on device per release.
- **Four CI guards grow, and one is new.** `check-store-channel.mjs` encodes the D6 boundary;
  `check-neutrality-claims.mjs` widens its `SCAN_PREFIX` to the iOS target and `check-terms.mjs`
  gains the native gate in `WIRING` (both per D9); a native-parity check covers D4's renderer
  coverage, D5's golden-vector run and the D9 generated-copy sync. Without them this layer decays
  silently the way an unsynced Capacitor plugin does.
- **No new dependency, and no effect on the other channels.** JavaScriptCore is an iOS system
  framework, so the Android build, the declared permission surface and the F-Droid inclusion scan
  (`scripts/check-fdroid-ready.mjs`) are untouched.
- **The ownership claim is a one-way door on a device.** The native core writes the marker at launch
  (D3), and from then on the WebView's mirror stands down for the owned prefixes on that device. A
  later release that removed the native screens would leave the marker in place, so those keys would
  have no durable copy and no eviction protection, silently. Nothing enforces that today; the marker
  is versioned (`native-core:v1`) so a build that stops owning these keys must retire it.
- **The compiled datasets ship twice on iOS, for about 1.1 MB.** The web app reaches them as hashed
  JS chunks — Vite bundles the JSON at build time — and JavaScriptCore has no loader for those, so
  the native core needs the same payload as plain files. The iOS channel build therefore copies
  `data/dist/*/dataset.json` and `manifest.json` into the web output alongside the engine bundle,
  and both copies genuinely ship: the WebView still serves the document routes from the chunks. The
  alternative — making the web fetch raw JSON — was refused because the bundling is what the offline
  guarantee ([0001](0001-static-client-scored-pwa.md)) rests on. iOS only, so the F-Droid tree is
  byte-identical. CI asserts every committed election is present, since a missing file builds
  cleanly and then throws on the first question screen.
- **Delivery order.** Lands after the listing-scoped reviews as a `feat` release, which moves the
  minor version (`scripts/next-version.mjs`); an archive-and-export dry run precedes any
  submission, because a build that fails to export costs a review slot; smoke-tested on device via
  TestFlight before the review slot is spent. Review notes are rewritten as a walkthrough of the
  native path on a fresh device.
- **A dependency on App Review's judgement remains.** Guideline 4.2 has no objective threshold.
  This increment is aimed at the sentence in the rejection rather than at the largest available
  surface; if it is still refused, the remaining options are the deferred watch companion or
  accepting that the iOS channel is closed to a tool of this shape — a decision for a later record,
  not a reason to weaken the privacy posture.
