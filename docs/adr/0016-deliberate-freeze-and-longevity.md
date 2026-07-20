# 0016 — Deliberate freeze posture and a longevity re-review

- Status: Accepted
- Deciders: National Digital

This ADR records how the codebase is expected to age. how2vote is a static, client-scored PWA for
Australian **federal elections**, which happen roughly every three years. Between elections the
codebase may legitimately go **untouched for 3+ years** — that is a supported state, not neglect. This
ADR names what that freeze protects, what it puts at risk, and the dated commitment that keeps the
freeze from silently becoming permanent. It is the umbrella for the pre-launch hardening applied
alongside it (security headers, AI-usage preferences, WCAG 2.2), and it is informed by a forward-look
review of web-platform, AI-protocol, accessibility and security trajectories over 2026–2029.

## Context

The build is deliberately inert. `@sveltejs/adapter-static` emits plain HTML/CSS/JS that outlives the
tools that produced it, and Cloudflare manages TLS, post-quantum key agreement, and certificate
renewal *underneath* a deployed site with no redeploy. So the platform layer ages well on its own.

The real decay surface for a frozen build is not the platform — it is the parts **we** freeze:

1. **Runtime/toolchain reaching end-of-life.** Node 24 reaches end-of-life around **April 2028**,
   inside the plausible untouched window. A pinned runner keeps building but runs unpatched, and
   hosted runners eventually drop old majors — a "can't rebuild in an emergency" risk.
2. **A frozen lockfile accruing CVEs.** An exact, integrity-pinned lockfile is our best defence
   against supply-chain worms (a malicious patch-bump cannot match the pinned hash), but it also means
   disclosed vulnerabilities in already-installed versions are never patched unless someone acts. The
   vuln gate keeps flagging them into a void.
3. **Pre-standard experiments pointing at dead APIs.** Surfaces built on emerging, not-yet-standard
   browser APIs can quietly stop meaning anything as those APIs change or are withdrawn.
4. **Silent header/allowlist drift.** Response headers or host allowlists tied to a vendor's asset
   hosts can weaken or break when the vendor moves things.

Much of the defence is already in place: hash-mode CSP (no host allowlist to drift), a hardened
`static/_headers` set, SHA-pinned GitHub Actions, `pnpm install --frozen-lockfile` throughout, pinned
`packageManager` and Cloudflare `compatibility_date`, and TypeScript held at 6.0.x. This ADR records
the posture explicitly and adds the one thing a frozen project most often lacks: a **date**.

## Decision

1. **Reproducibility floor (keep).** The exact `pnpm-lock.yaml` with integrity hashes, frozen-lockfile
   installs in every CI job, SHA-pinned Actions, `packageManager` pinned (`pnpm@11.12.0`, Node ≥ 24),
   and an explicitly pinned Cloudflare `compatibility_date` are the reproducibility guarantee. A rebuild
   years later must reproduce byte-for-byte. None of these is a floating range.

2. **Dependencies are security-only and human-approved.** Dependabot routine version updates are
   **off**; only security updates flow, they are **never auto-merged** (an unattended "security" merge
   is itself the npm-worm delivery vector), and they pass CodeQL + dependency-review like any change.
   Majors that would break the pinned toolchain (TypeScript 7, `@types/node` ahead of the runtime)
   stay held. See [`.github/dependabot.yml`](../../.github/dependabot.yml). Repo-level Dependabot
   security updates must be enabled once in repository settings for this to take effect — a
   maintainer-once step, in the same class as the branch-protection toggles tracked in
   [`docs/legal/required-checks.json`](../legal/required-checks.json).

3. **Pre-standard surfaces are marked non-durable.** The WebMCP tool surface
   (`navigator.modelContext`, an Edge-native / Chrome-origin-trial, W3C **Community Group** draft — not
   on the Standards Track) is kept only as a progressive, read-only, no-op-when-absent mirror of the
   public content. It is **explicitly not a supported surface** and may be removed at any time with no
   user-facing loss; its rot risk is contained to itself. The durable agent-facing surfaces are
   `robots.txt`, schema.org structured data (incl. `Dataset`), and `llms.txt`/`llms-full.txt`.

4. **Do not chase build-chain majors.** Vite 8 (Rolldown), SvelteKit 3, and Svelte 6 are **not**
   adopted for a frozen tree; the static output does not need them. The one future *forced* migration
   to be aware of is SvelteKit 3 replacing the `$env/*` modules with explicit environment config,
   which intersects the `$env/dynamic/public` convention — noted here, acted on only at re-review.

5. **A dated, mandatory re-review — the keystone.** By **2028-01-31**, or at the next federal
   election's onboarding (whichever is sooner), a maintainer must re-review, even with no feature work
   planned:
   - runtime/toolchain EOL (Node 24 ≈ April 2028) and whether the runner/build image is still patched;
   - the accumulated CVE list against the frozen lockfile;
   - standards drift on the surfaces above (WebMCP, AIPREF, WCAG, `$env/*`).

   This aligns naturally with the project's core recurring operation: adding the next election (see the
   [adding-an-election runbook](../adding-an-election.md)) already reopens the tree around 2028, before
   Node 24's EOL. The date exists so that if an election is *not* imminent, the freeze still gets a
   scheduled look rather than drifting indefinitely.

## Consequences

- A vulnerability disclosed against a pinned dependency will surface in the vuln gate and go unpatched
  until a security update is offered or the re-review lands. This is an accepted, bounded trade-off:
  bounded by the security-only Dependabot channel and by the dated re-review, and preferred over
  floating ranges that would reopen the supply-chain-worm surface.
- CI stays green on a truly untouched tree (frozen-lockfile installs are deterministic); the vuln gate
  may go red if a CVE lands mid-freeze — that redness is the signal for the re-review, not something to
  suppress.
- If the WebMCP API changes or is withdrawn, the affected code no-ops; nothing else regresses. Removing
  it later is a clean deletion.
- The next-election onboarding is the expected moment this ADR is revisited; a maintainer doing that
  work should treat this file's checklist as part of the job.

## Assessed and deferred — Trusted Types (`require-trusted-types-for 'script'`)

Trusted Types reached cross-browser Baseline in early 2026 and is the one mechanism that structurally
closes DOM-XSS injection sinks (rather than only script *loading*, which the CSP already governs). It
was assessed for this freeze and **deferred**. This is a "resolvable for our own code, but not worth
enforcing on a frozen build" call, recorded here so a future maintainer does not re-litigate it from
scratch:

- **It is not, in fact, blocked by our framework.** Svelte 5.56 is Trusted-Types-aware: its client
  runtime instantiates every template through a named `svelte-trusted-html` policy
  (`node_modules/svelte/src/internal/client/dom/reconciler.js`), so enforced TT does not break
  hydration as long as the CSP `trusted-types` directive lists that policy.
- **Our only app-level sinks are fixable.** The three `{@html}` JSON-LD injections (`JsonLd`,
  `StructuredData`, `insights`) set `innerHTML` with a plain string. That would throw under enforced
  TT, but the value is build-time, first-party schema.org data, so it can be routed through a small
  passthrough policy (`{@html policy.createHTML(json)}`) — Svelte supports this explicitly.
- **The blocker is the third-party challenge on a frozen build.** Cloudflare Turnstile loads on
  form submit and is reachable from any page (the feedback widget is global). Under enforced TT with a
  restrictive `trusted-types` policy list, any TT-incompatible sink or unlisted policy a *future*
  Turnstile build introduces would break the contact/feedback forms **silently, with no maintainer for
  ~3 years** — and its behaviour cannot be verified locally (it needs the live Cloudflare challenge).
- **The marginal value here is modest.** `script-src` is already hash-locked (no host allowlist, no
  `unsafe-inline` fallback that CSP3 honours), so script injection is already blocked; TT would add
  DOM-sink depth over a small, first-party, no-user-HTML surface.
- **Report-Only is near-inert for a freeze.** It avoids breakage but, with no report collector, a
  Report-Only header just goes unread for the life of the freeze.

**Decision:** do not ship Trusted Types (enforced or Report-Only) into the frozen build. Re-evaluate at
the [dated re-review](#decision) — by then the tree is being actively worked (next election), Turnstile
can be exercised against an enforced policy in a preview, and the JSON-LD policy shim can be added and
verified in the same pass. If TT is adopted then, note it must be delivered as an **HTTP header** in
`static/_headers`: the app's CSP is emitted as a `<meta>` tag, and browsers ignore
`require-trusted-types-for` / `trusted-types` in meta policies.
