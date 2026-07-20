# 0014 — Close the Insights page on election day

- Status: Accepted
- Deciders: National Digital

## Context

The Insights page (`/insights`) publishes aggregate, k-anonymised figures from the optional
post-comparison survey — descriptive counts of how respondents' attributes line up with parties'
records ([0008](0008-aggregate-counters.md)). We do not want to publish that live analysis on
**election day while people are still voting**: descriptive figures about who is leaning which way,
served during polling hours, sit too close to the kind of last-minute influence the project
deliberately stays away from (the neutrality posture of [0006](0006-legal-compliance-rebuild.md)),
even though it is not an opinion poll. The rest of the site — the comparison, the plan builder,
the archive — is unaffected; this is only about not surfacing survey analysis mid-poll.

The window we want is **00:00 until the last national poll close** on polling day. That upper bound
is already a first-class, authoritative instant: `timetable.pollsCloseAt` (8 pm AEST = 6 pm AWST,
the last close nationally), transcribed from the AEC timetable per election in
`packages/data-schema/src/elections.ts`. All federal polls fall outside daylight saving, so the
AEC reference zone is a fixed +10:00 (AEST).

The site is fully static (`adapter-static`, every route prerendered): there is no request-time
server for pages, so the gate cannot be server-driven. Crucially, though, `/insights` is a
prerendered *shell* that fetches its aggregates client-side from static `/stats/*` assets — the
numbers are never in the prerendered HTML.

## Decision

**Gate `/insights` on a client-side polling-day window.** Add a pure, injectable-`now` predicate
`isPollingDayNoticeWindow(meta, now)` to `packages/data-schema/src/elections.ts`, next to
`electionStage`/`electionPhase`: true when `${meta.date}T00:00:00+10:00 <= now < pollsCloseAt`.
It is driven by the **current** election (`CURRENT_ELECTION_ID`), never whichever election the
visitor has toggled to view.

Inside the window `/insights` renders a short, non-dismissible notice (`InsightsClosed.svelte`,
"Insights are closed for election day — check back after polls close nationally, from 8 pm AEST")
in place of the analysis, and **makes no `/stats/*` request at all**, so the withheld aggregates
never reach the browser. A tiny ticking clock (`$lib/now.svelte.ts`, ~60 s) drives the reactive
check so a tab left open flips at the 00:00 and 8 pm boundaries without a reload.

**Scope is `/insights` only.** `/review` (the quiz answer-review step) and every other route are
untouched. This does not touch electoral authorisation or any accuracy notice.

**The `Dataset` JSON-LD stays.** `/insights` emits a schema.org `Dataset` description in its
prerendered `<head>`. It is a build-time *description that the dataset exists* (for discovery), not
election-day numbers, and cannot be time-gated client-side; we leave it as-is.

## Consequences

- **Best-effort, not enforcement.** The gate reads the visitor's device clock, which can be wrong
  or spoofed. Acceptable here: the worst case is that already-published aggregates appear a few
  hours early or late for one visitor. It is not a compliance control, and this is recorded so no
  one later mistakes it for one.
- **No-JS clients and crawlers** only ever see the shell and headings, never the numbers — which is
  fine (arguably better) for a "closed" state.
- **Effective withholding.** Because the aggregates are client-fetched, skipping the fetch inside
  the window genuinely withholds them — no flash-of-content, nothing extra in the network response.
- **Dormant until a live election exists.** Every shipped election (2019/2022/2025) is already
  archived; the current election's polling day is in the past, so with a real clock the gate never
  fires today. It activates automatically when a future election with a `timetable` becomes current.
- **A robust, no-JS-proof block would require an edge function** (compute the window at the edge and
  refuse `/stats/*` or rewrite the response), departing from the fully-static model. Out of scope;
  the client-side gate is proportionate for aggregate insights.
