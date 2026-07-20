# Redirecting the old how2vote.com.au to how2vote.au

The previous site lived at `how2vote.com.au`, with each election served from a year
subdomain (`2019.`, `2022.`, `2025.how2vote.com.au`). Its shared how-to-vote cards were
links of the form:

```
https://2025.how2vote.com.au/card/?res=<participantID>
```

The `res` ID keyed a row in that site's server-side database. That backend is retired, so
**those old cards are unrecoverable by design** — the new site is fully static and encodes a
card's answers in the URL fragment instead (`/card#v1.<election>.<electorate>.<payload>`).

## What the app already handles

`apps/web/src/routes/card/+page.svelte` detects a `?res=` query parameter and renders a
dedicated explanation: why the old card can't be shown (retired server, stale election
data) and a CTA to build a fresh card at `/ballot`. Covered by an e2e test in
`apps/web/e2e/flow.spec.ts`.

So the only infrastructure requirement is: **get old-domain traffic to how2vote.au with
path and query string preserved.**

## Required redirect rules (old domain's DNS/host)

Set up on whatever serves `how2vote.com.au` (Cloudflare Bulk Redirects / a Redirect Rule
if the zone is on Cloudflare):

| Source | Target | Notes |
| --- | --- | --- |
| `how2vote.com.au/*` | `https://how2vote.au/$1` | 301, preserve query string |
| `www.how2vote.com.au/*` | `https://how2vote.au/$1` | 301, preserve query string |
| `2019.how2vote.com.au/*` | `https://how2vote.au/$1` | 301, preserve query string |
| `2022.how2vote.com.au/*` | `https://how2vote.au/$1` | 301, preserve query string |
| `2025.how2vote.com.au/*` | `https://how2vote.au/$1` | 301, preserve query string |

Preserving the query string is what carries `?res=<id>` through to the new `/card` route
so the explanation page (rather than a silent bounce to `/ballot`) is what users see.

## Old-path → new-path map

Cloudflare Pages normalises the old site's trailing slashes (`/card/` → `/card`) since the
new routes are prerendered without them, so a plain path-preserving redirect covers most
pages:

| Old path | New destination | How |
| --- | --- | --- |
| `/` | `/` | path-preserving redirect |
| `/card/?res=<id>` | `/card?res=<id>` → former-link explainer | app handles `?res=` |
| `/poll/` | `/quiz` | needs an explicit rule (or accept the branded 404) |
| `/methodology/` | `/methodology` | path-preserving redirect |
| `/contact/` | `/contact` | path-preserving redirect |
| `/privacy-policy/` | `/privacy` | needs an explicit rule (or accept the branded 404) |
| `/unelected-candidates/` | dropped (ADR-0003) | branded 404 is acceptable |
| `/changelog/` | dropped | branded 404 is acceptable |

If explicit per-path rules are cheap to add (Cloudflare Redirect Rules), add `/poll/` and
`/privacy-policy/`; otherwise the branded 404 page on how2vote.au is the fallback.
