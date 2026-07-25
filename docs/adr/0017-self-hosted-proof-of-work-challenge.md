# 0017 — Self-hosted proof-of-work challenge and forms relay

- Status: Accepted — supersedes in part [0015](0015-first-party-telemetry-and-anti-abuse.md) (D2)
- Deciders: National Digital

This ADR records the decision to replace Cloudflare Turnstile and Formspree with a fully
self-hosted anti-abuse challenge and a first-party contact/feedback forms relay, removing the last
third-party JavaScript and the last third-party data processor from the runtime. The aggregate-only
research store's zero-log guarantee ([0008](0008-aggregate-counters.md)) is untouched.

## Context

[0015](0015-first-party-telemetry-and-anti-abuse.md) (D2) adopted Cloudflare Turnstile for
anti-abuse and kept Formspree for form delivery. Both earned their keep at the time, but three
pressures accumulated against them:

1. **Turnstile is third-party proprietary JavaScript on the submission path.** The client loads
   `challenges.cloudflare.com/turnstile/v0/api.js` at submit time — the only remaining third-party
   script and iframe in the browser, the only external CSP origin, and code whose behaviour on a
   frozen build cannot be verified locally ([0016](0016-deliberate-freeze-and-longevity.md)
   recorded it as the Trusted Types blocker).
2. **The native shells broke on the site-key hostname allowlist.** The iOS/Android WebViews present
   the origin `localhost` (`capacitor://localhost`, `https://localhost`), so every Turnstile widget
   needed `localhost` added to its dashboard allowlist — per-widget, per-channel configuration that
   fails closed when forgotten, invisible to CI, and exactly the kind of per-channel divergence the
   store builds are designed never to have.
3. **F-Droid ineligibility.** Runtime-loaded proprietary JavaScript (Turnstile) and a proprietary
   SaaS form processor (Formspree) made the research feature and the forms unshippable in a FOSS
   build — a whole-variant product cut, not a packaging detail
   ([store-distribution](../store-distribution.md)).

Formspree was also, independently of F-Droid, a third-party processor of the only identifiable
personal information the product handles (a visitor's own contact message) — a disclosure and
vendor-register line carried for what is ultimately an email hand-off.

## Decisions of record

**D1 — Anti-abuse: self-hosted ALTCHA proof-of-work.** The challenge is the open ALTCHA v2
protocol via the MIT-licensed `altcha-lib` (no widget, no third-party service):

- **Issuance:** our own Pages Function `POST /api/challenge` issues an HMAC-signed challenge
  (secret `ALTCHA_HMAC_SECRET`, a Cloudflare Pages secret) — algorithm pinned to PBKDF2/SHA-256,
  cost 10 000, 10-minute expiry, and a signed **purpose** (`research` | `contact` | `feedback`) so
  a solution can only be spent on the path it was issued for.
- **Solving:** the bundled `altcha-lib` solver runs on the visitor's own device as an invisible
  background computation (~1 s behind the submit state) — no third-party script, iframe or
  endpoint, no cookie, no puzzle (`apps/web/src/lib/altcha.ts` replaces the deleted `turnstile.ts`).
- **Verification:** in-process on the server (`apps/web/src/lib/research/challenge.ts`,
  `AltchaVerifier` replacing `TurnstileVerifier`) — expiry, HMAC signature, then a single key
  re-derivation. There is **no** siteverify network call at all.
- **Single-use:** every verified solution is burned in the existing single-use nonce store —
  the atomic D1 store required in production, fail-closed (503) otherwise
  ([0007](0007-same-origin-research-backend.md)).

**D2 — Forms: self-hosted relay via Cloudflare Email Sending.** Formspree is removed. The contact
and feedback forms post to our own Pages Function `POST /api/forms`, which verifies the same
challenge (purpose-bound per form) and **relays** the message to the project inbox via Cloudflare's
Email Sending REST API at `api.cloudflare.com` — already the registry's allowlisted egress host.
Relay-only: nothing is stored, no IP or user-agent is read, nothing is logged. Secrets
`EMAIL_API_TOKEN` + `EMAIL_ACCOUNT_ID`; committed vars `FORMS_FROM_ADDRESS` /
`FORMS_DELIVERY_ADDRESS`. Production fails closed (503) when unprovisioned; non-production accepts
inertly, so dev and previews run secret-free.

**D3 — One challenge for every channel (invariant).** Web, iOS, Android and F-Droid use the
identical mechanism, difficulty and endpoints — the challenge is **never diverged per channel**.
There is no site key, hostname allowlist, or per-channel configuration left to drift; purposes
distinguish payload paths, not channels.

## Alternatives considered

- **Keep Turnstile.** Free and behaviourally stronger, but it retains the last third-party script,
  the external CSP origin, the per-widget hostname allowlists that already failed in the native
  shells, and F-Droid ineligibility. All three motivating problems stay.
- **hCaptcha.** The same third-party-script and allowlist shape as Turnstile with a worse
  accessibility profile (interactive fallback puzzles risk the WCAG 3.3.8 posture), plus a new
  vendor register entry. Strictly worse for this product.
- **Roll-our-own proof-of-work.** Equivalent privacy properties, but hand-built crypto protocol
  code with no ecosystem review. ALTCHA is an open, documented protocol with an MIT reference
  implementation we can pin and audit — the same result without inventing a scheme.
- **Mailto-only forms.** Removes the processor without new infrastructure, but breaks the
  in-product feedback flow (no default mail client on many devices, no anti-abuse, no
  deliverability) and would have dropped a working feature to solve a plumbing problem.

## Consequences

- **Zero third-party JavaScript or iframes in the browser.** The CSP has no external origin left
  and `frame-src` returns to `'none'`; no visitor data leaves our infrastructure for anti-abuse,
  and forms data goes only to the recipient mailbox. The registry
  (`third-party-services.json`) now has `services: []`, with the challenge recorded as the
  `altcha-pow` anti-abuse entry under the Cloudflare infrastructure vendor.
- **F-Droid is unblocked.** Research and the forms work identically in a FOSS build — no
  proprietary JS, no per-variant feature drop ([store-distribution](../store-distribution.md)).
- **Honest trade-off: PoW is a weaker bot deterrent than Turnstile's behavioural signals.** A
  proof-of-work only prices submissions (CPU time per attempt); it cannot distinguish a human from
  a well-funded bot the way behavioural analysis can. Mitigations already in place: the edge
  rate-limit + Bot Fight Mode on the ingestion path, single-use purpose-bound challenges burned in
  the atomic nonce store, the single-use signed submission token, and registry validation — abuse
  is bounded and priced, not merely detected.
- **New operational dependency: Cloudflare Email Sending.** Form delivery now rides our own
  Cloudflare account (domain onboarding, token scope, sending quotas) instead of Formspree's SLA.
  It fails closed in production, and an outage affects only form delivery — never the quiz,
  research or published content.
- **Configuration shrinks.** `TURNSTILE_RESEARCH_SECRET` and all `PUBLIC_*` form/challenge
  variables are gone; new secrets are `ALTCHA_HMAC_SECRET`, `EMAIL_API_TOKEN` and
  `EMAIL_ACCOUNT_ID` (see `infra/providers/cloudflare/config-policy.json`). The accessibility
  claim for WCAG 3.3.8 now rests on our own fully non-interactive background computation rather
  than a vendor's challenge mode.
- [0015](0015-first-party-telemetry-and-anti-abuse.md) D2 is superseded; its D1 (Cloudflare Web
  Analytics), D3 (dormant consent UI) and D4 (no client error beacon) stand.
  [0016](0016-deliberate-freeze-and-longevity.md)'s Trusted Types deferral loses its main blocker
  and is re-weighed at the dated re-review.
