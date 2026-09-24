# 0019 — Native iOS documents drawn from the web's prerendered HTML

- Status: Proposed
- Deciders: National Digital
- Amends: [0018](0018-native-ios-core.md) D1 and D1a

This ADR records how the iOS app draws document pages, and the election data pages, natively without anyone rewriting their
wording. The app draws each page from the HTML the web itself prerenders. The HTML is projected
into a closed structure, and CI checks at every step that no text is lost on the way to the screen.
The end state is an iOS app with no WebView at all. Moving pages across route by route is the
means of getting there.

## Context

ADR 0018 kept the documents in the WebView for two reasons. D1: a native rewrite gains nothing
that a reviewer would notice. D1a: the legally registered wording has to stay in the files that
the path-scoped compliance guards read. Both reasons still hold. What 0018 did not foresee is the
cost of mixing the two renderers:

- There are two navigation systems.
- State has to be handed across the bridge.
- Native screens sit over web layout chrome that they must redraw.
- Deep links resolve into either renderer.

Every defect found in the native core so far has been at that boundary rather than inside a screen.

A native rewrite of the documents would reintroduce D1a's problem: electoral and privacy wording
would exist twice. What is needed is a native renderer with no copy of its own.

## Decision

**D1 — iOS draws the prerendered page, not a rewrite of it.** At build time,
`scripts/build-native-documents.mjs` reads each document's prerendered HTML, from the iOS channel
build, and projects it into a small, closed set of node types. The wording stays in the Svelte
sources, so the compliance guards, the copy registers and the Terms hash are unchanged. The native
screen is a rendering of the web's output, not a second source.

**D2 — The projection fails closed.** Any of the following stops the build:

- an element, class or attribute that has not been mapped;
- an unknown entity;
- text hidden from VoiceOver that is more than a decorative glyph;
- a projection whose text differs from the page's text.

"Page text" here means the page's text less the declared chrome: the top bar and the popover
controls. The projection also collapses whitespace the way a browser does, so the renderer can
draw text verbatim.

**D3 — Four checks, each on a different boundary.**

1. **HTML to projection.** The projection conserves the page's text. Node checks this for every
   prerendered page, including every election data page.
2. **Projection to layout.** The Swift decoder is exhaustive and refuses unknown nodes, roles and
   fields. The layout recomputes the text digest the projection recorded, and the text VoiceOver
   should read, from the spans it will draw. `DocumentLogic` runs this in CI over every page. At
   runtime, the same check turns a failure into a declined route.
3. **Layout to screen.** A simulator UI test opens each document from the footer and compares the
   accessibility tree with the projection's spoken text.
4. **Prerender to hydration.** A Playwright check requires each native document's hydrated text to
   equal its prerendered text, under voter state that could change it. A page whose text depends
   on the voter's state cannot be native in that state. About reports the selected election's
   dataset, so it is offered natively only while the current election is selected, which is the
   election it was prerendered for. It is checked in that state (`CURRENT_ELECTION_DOCUMENTS`).

**D4 — Controls are slots, and the web still does the work.** An interactive part of a page, such
as privacy's "clear all my data", is a declared slot. Its labels are projected with the page. Its
confirmation wording is registered in `docs/legal/native-copy.json`. The action itself is a
request to the web, which owns the keys (ADR 0018 D3).

**D4a — Election data pages are documents too.** Each election's `issues`, `parties`,
`electorates` and `senate` pages are projected and drawn the same way. The router offers them by
section (`NATIVE_DATA_SECTIONS`). The projection, layout and hydration checks cover every one of them; the on-screen check opens the issues, parties and electorates indexes, one party page, and one electorate page with its candidates in ballot order. Issue and Senate pages use no node kind those pages do not, and are held by the projection, layout and hydration checks. Their breadcrumb trail is chrome
that the native top bar draws. It is projected alongside the page, outside the page's text.

**D4b — A screen's states are prerendered too.** Some screens have a state the build does not
reach on its own, such as the age gate's explore-only explainer, which appears only after an
answer. Such a state is rendered at build time into a states file (`states/start.html`) from the
same component the live page uses, so there is still one copy of the wording. A states file is
not a page: it exists only in the iOS channel's build, is removed from every other channel's, and
is never precached, so no visitor can open that copy out of the flow that explains it.

The native screen draws whichever state applies. Each control names its action on the page (the
button's `value`), and the projection requires each slot to carry exactly its expected actions.
Pressing one asks the web to do what the page's own control does (`nativeSlotAction`), through the
same functions the page calls. The action is named, never positional, so a page that reorders its
buttons cannot swap what they do.

**D4c — The landing is composed from the web's pages.** Each election's landing is prerendered in
a first visit's state, at the stage the election had on the day of the build. The stage can change
while an app version is in use, and a returning voter has a quiz to resume or a comparison to
see. So `/states/landing.html` holds every stage's lede and steps for every election, each call to
action (the question numbers marked with `<data>`), and both theme labels. It is rendered at build
time from the landing's own components, as a states file (D4b): not a page, no client code, and
only in the iOS build. The native landing
replaces those parts of the page with the ones for the stage the engine reports and the voter's
progress. `DocumentLogic` requires that composing each landing with the stage it was prerendered
at, and a first visit's progress, gives back the page exactly. That proves the two pages agree
word for word. The landing's buttons act natively, because on iOS the quiz state is the native
core's (ADR 0018 D3).

**D6 — The iOS app is a skeleton, and it has a contract with the web build.** The goal is that no
iOS screen shows hand-written copy. Every word comes from the web build: projected pages, the
chrome handed over with each route, and the datasets. Two checks hold this in place as the web
interface changes:

- **The contract** (`apps/mobile/ios/native-contract.json`) lists every node kind, role and slot a
  projected page may contain. The projection may emit nothing outside it, and `DocumentLogic`
  requires the Swift renderer to draw exactly it. A web change that needs something new fails the
  projection first, then fails the renderer, until the skeleton has learned it. Wording changes
  need no skeleton change at all. Styling is not covered, as ADR 0018 D10 intends.
- **The hand-written copy record** (`apps/mobile/ios/native-copy-debt.json`) lists every string
  literal in Swift that is not plainly a name, key or diagnostic, all of it on screens built before
  this rule. `scripts/check-native-content.mjs` reads the literals from the compiler's parse and
  fails new copy. It also fails a record that has grown against the PR base, so the record can only
  shrink as those screens move to the web build.

**D5 — The WebView goes route by route.** A route moves to the native side only when all four
checks pass for it. The WebView is removed once no route is left that uses it. Until then, ADR
0018 D4's runtime fallback remains. Removing the WebView means moving that failure to build time,
where the checks above already live.

## Consequences

- Document pages are native on iOS with no second copy of their wording. Legal review of the
  wording is unchanged, and the legal register records the native rendering.
- The iOS app ships the projected pages: about 7.6 MB for the eight documents and 792 data pages,
  or about 480 KB compressed.
- Adding markup to a document page can fail the iOS build until the projection and the renderer
  learn it. That is the intended trade.
- These remain in the WebView and need native counterparts, or screen logic run in
  JavaScriptCore, before the WebView can go:
  - About, while a past election is selected;
  - contact;
  - survey;
  - insights;
  - offline;
  - saved;
  - the card.
- The quiz, ballot and review screens still hold the hand-written copy the record lists,
  and the registered notices in `docs/legal/native-copy.json` are still typed copies checked
  against the web source rather than read from the build. Both are the next moves.
- Existing installs keep their data. The `how2vote:` keys and the native-core ownership marker are
  not changed by any of this.
