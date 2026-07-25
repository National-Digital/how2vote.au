# 0015 — First-party / Cloudflare telemetry and anti-abuse

- Status: Accepted — **D2 superseded in part (2026-07) by
  [0017](0017-self-hosted-proof-of-work-challenge.md)** (Turnstile and the Formspree forms are
  replaced by a self-hosted proof-of-work challenge and forms relay; D1, D3 and D4 stand)
- Deciders: National Digital

This ADR records the decision to remove Google from the runtime and consolidate usage
measurement and anti-abuse onto first-party / Cloudflare mechanisms, while leaving the
aggregate-only research store's zero-log guarantee ([0008](0008-aggregate-counters.md)) untouched.

## Context

The site is hosted on Cloudflare Pages and is built around data minimisation. The previous runtime
loaded two Google products in the browser:

- **Google Analytics 4** (consent-gated via Consent Mode v2) for aggregate usage, setting the
  `_ga`/`_ga_*` cookies and transferring data to the United States once consent was granted; and
- **Google reCAPTCHA v3** on the contact and feedback forms, setting a `_GRECAPTCHA` cookie on
  submit.

Both are US ad-tech vendors. Carrying them meant a cross-border transfer disclosure, cookie
disclosures, a consent banner and a large amount of consent-gating code — a poor fit for a civic
tool whose whole posture is "we collect as little as possible".

Two hard constraints bound any change:

1. The registry (`third-party-services.json`) is the single source of truth for the CSP, the consent
   UI and the privacy provider table; every change must be a data edit there first.
2. The research and geography ingestion endpoints must emit **zero** logs or telemetry of any part
   of a request — the in-flight payload is the one place a derived profile momentarily exists
   ([0008](0008-aggregate-counters.md); PIA).

## Decisions of record

**D1 — Usage analytics: Cloudflare Web Analytics (cookieless, edge).** Google Analytics is removed
entirely. Usage is measured by Cloudflare Web Analytics at the edge — no client tag, no cookie, no
device identifier, no cross-border ad-tech transfer. Because it collects no personal information and
sets no cookie, it is **not consent-gated**; it is disclosed under the Cloudflare infrastructure
entry and privacy §6. The `_ga`/`_ga_*` cookies, the `generate_card` event and the whole gtag/
Consent-Mode bridge are gone.

**D2 — Anti-abuse: Cloudflare Turnstile (cookieless, non-interactive).** reCAPTCHA v3 is replaced by
Cloudflare Turnstile in its non-interactive / invisible mode. **Two separate widgets** — each with
its own site key and secret — keep the anonymous survey's anti-abuse isolated from the identifiable
forms, so neither configuration nor Cloudflare's per-widget analytics is ever shared between the two
paths:

- the **forms** widget (`PUBLIC_TURNSTILE_SITE_KEY`) on the two Formspree forms
  (`cf-turnstile-response`, verified server-side by Formspree); and
- the **research** widget (`PUBLIC_TURNSTILE_RESEARCH_SITE_KEY`), rendered on the survey and executed
  on submit; its solution is the `challenge` posted to `/api/research/token`, verified server-side
  against the separate `TURNSTILE_SECRET` before a submission token is minted.

Both run only on submit and are lazily loaded. The non-interactive mode preserves the registry's
accessible anti-abuse posture (`interactive: false`) and keeps the blocking accessibility CI green.
The `_GRECAPTCHA` cookie is gone.

> **Superseded in part (2026-07).** D2 — and the Formspree form delivery it attached to — is
> replaced by a fully self-hosted proof-of-work challenge and first-party forms relay; no
> third-party script, iframe or verification endpoint remains. See
> [0017](0017-self-hosted-proof-of-work-challenge.md). D1, D3 and D4 stand unchanged.

**D3 — Consent UI gated, not deleted.** With nothing consent-gated left (cookieless analytics,
cookieless Turnstile), the consent banner and preferences UI are hidden behind a registry-derived
flag `hasConfigurableConsent` (true only when some consent-required category has a live service).
The consent store and its components are kept **intact and dormant** with a generic `applyConsent()`
seam, so re-introducing a consent-gated service later is a one-line registry edit, not a rebuild.
The `/privacy` page carries the standing transparency signal.

**D4 — Error visibility: none (client transmits nothing).** The site ships **no** client error beacon
and no `/api/client-error` endpoint. Two reasons: (1) Cloudflare Pages Functions do **not** persist
logs — only ephemeral real-time `wrangler pages deployment tail` exists — so a "Workers Logs
destination + retention" is not achievable without adding a Logpush→R2 sink and its own retention/PII
surface; and (2) for a civic tool, transmitting **no** client-side error data at all is the stronger
data-minimising posture. The research and geography
endpoints remain **zero-log** (unchanged) — a guard test still asserts they contain no `console.*`
and import no logger — and there is now no intentional application log site anywhere in the app.
Third-party error vendors (Sentry/GlitchTip) remain deliberately **not** adopted; if field error
visibility is ever needed it would be reconsidered as a fresh decision, EU-region, replay-off,
PII-scrubbed, with a vendor-register entry.

## Consequences

- Two US ad-tech vendors removed; `_ga`/`_ga_*`/`_GRECAPTCHA` cookies and the analytics cross-border
  transfer gone; no consent banner in the shipped build.
- The CSP no longer lists any Google origin; the only browser-loaded third party is the Turnstile
  challenge host (`challenges.cloudflare.com`), added only on form or survey submit.
- The site transmits no client-side error data at all (D4): nothing is sent, nothing is
  stored, and the research store's zero-log guarantee is unchanged.
- The electoral-expenditure register's Google line item is replaced by a Cloudflare Turnstile line;
  the Cloudflare entry now also covers edge analytics.
- Operator steps: enable Cloudflare Web Analytics; create the **two** Turnstile widgets and set the
  `PUBLIC_TURNSTILE_SITE_KEY` (forms) and `PUBLIC_TURNSTILE_RESEARCH_SITE_KEY` (survey) variables; put
  the forms secret on Formspree and the research secret in the `TURNSTILE_SECRET` Pages secret.
