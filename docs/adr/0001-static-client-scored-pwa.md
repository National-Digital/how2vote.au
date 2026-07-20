# 0001 — Static, client-scored offline PWA

- Status: **Accepted**
- Deciders: National Digital

## Context

how2vote compares a voter's answers against parties' recorded parliamentary votes and helps them
build a voting plan. That comparison is a pure function of the committed dataset and the voter's own
answers — it needs no account, no server-side state, and no per-visit computation that only a backend
could do. The data it runs on (compiled vote positions, ballots) is fixed per election and published
openly.

The material a voter produces — their answers, their comparison, their draft ballot — is sensitive.
The strongest privacy position is for it never to reach a server at all.

## Decision

**The site is a static, client-scored, offline-capable PWA.** SvelteKit builds with
`adapter-static`: every route is prerendered to static HTML/JS/CSS and served as files, with no
request-time server rendering. All scoring runs on the device in `@how2vote/engine`; the app imports
the committed, checksummed dataset (`data/dist`) and computes the comparison and ballot entirely in
the browser. A service worker caches the shell and dataset so the tool works offline.

- **No server for the core product.** The card, quiz, comparison, plan builder, sharing and printing
  have no server dependency. A voter's answers and draft ballot never leave the device.
- **Share links are self-contained.** A shared link encodes the answers in its URL fragment and the
  recipient's device recomputes the comparison; nothing is stored server-side to make sharing work.
- **The dataset is committed, not fetched at runtime.** Builds are deterministic and the dataset is
  checksummed, so what a visitor runs is exactly what is in the repo (see [0005](0005-tvfy-snapshot-lock.md)).

The **one** deliberate exception is the optional, opt-in research backend
([0007](0007-same-origin-research-backend.md)), which is same-origin and never touched by the card.

## Consequences

- Hosting is a static CDN (Cloudflare Pages) with no application server to run, scale or secure for
  the core product; the only server surface is the research Pages Function.
- The strict CSP can keep `connect-src 'self'` — there is nothing for the card to talk to.
- Features that would need a backend (accounts, server-side persistence, self-submitted candidate
  data — see [0003](0003-drop-unelected-candidates.md)) are out of scope unless a future ADR revisits
  this, because they would add the very server surface this decision avoids.
- All election datasets are bundled for offline use; if the number of elections grows large enough to
  strain the client bundle, that trade-off is revisited (see [0002](0002-multi-election-support.md)).
