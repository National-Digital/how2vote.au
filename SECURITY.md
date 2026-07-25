# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately via
[GitHub security advisories](https://github.com/National-Digital/how2vote.au/security/advisories/new)
— do **not** open a public issue for anything exploitable. The deployed site publishes the same
channel at [`https://how2vote.au/.well-known/security.txt`](https://how2vote.au/.well-known/security.txt)
(RFC 9116).

We aim to acknowledge reports within a few business days. Please include reproduction steps and the
affected URL, route, or package.

## Safe harbour

We welcome good-faith security research. If you make a genuine effort to follow this policy — you
report privately through the channel above, avoid privacy violations and destruction of data, do not
access or modify data beyond what is needed to demonstrate the issue, and give us reasonable time to
respond before any disclosure — we will treat your research as authorised and will not pursue or
support legal action against you for it. We aim to acknowledge within a few business days and to keep
you updated while we work on a fix.

This is a small independent public-interest project with no bug-bounty budget: we cannot offer
payment, but we are glad to credit researchers who want recognition. If you are unsure whether a
particular test is within scope, ask us first through the private channel above.

## Scope

- The web app (`apps/web`), including the `/api/research` Pages Function and its D1 store.
- The workspace packages (`packages/*`) and data pipeline.
- The GitHub Actions workflows in `.github/workflows/`.

Out of scope: the infrastructure the site declares on its privacy page (Cloudflare — including
Web Analytics and Email Sending) — report those to the vendor — and volumetric
denial-of-service findings. The anti-abuse challenge and the contact/feedback forms are
self-hosted (`/api/challenge`, `/api/forms`) and **in** scope.

## What we especially care about

This project's core promises are enforced in code, and a break in any of them is a security bug
even if no data is "stolen":

- Quiz answers and weights must never leave the device except via the share-link fragment
  (user-initiated, never sent to a server). The research feature is opt-in only: when the user opts
  in, the device derives its own result on-device and tallies it into aggregate counters — no
  per-person research record is ever created or stored.
- The research store must hold only aggregate group counts with no identifiers (no IP, cookie,
  device id, or sub-day timestamp), electorate must be kept as a separate tally with nothing attached, and
  published insights must never reveal a group smaller than the k-anonymity threshold.
- The build must be deterministic and the served dataset must match the committed, checksummed
  `data/dist`.

## Security controls

<!-- BEGIN GENERATED SECURITY CONTROLS (scripts/generate-security-md.mjs) -->

_Generated from `docs/legal/security-register.json` — do not edit by hand. Run `pnpm security:generate`; CI fails if this drifts from the register._

The following security controls are enforced or evidenced for this project:

- **Least-privilege access to production infrastructure and CI.** Access to production infrastructure and the deployment pipeline follows the principle of least privilege. GitHub Actions workflows request the minimum token scopes they need (they default to read-only and widen only where a job must write), and human access to the hosting and data platforms is limited to the roles required and reviewed periodically.
- **Multi-factor authentication on all privileged accounts.** Multi-factor authentication is required for the accounts that can change the source, the infrastructure or the published data.
- **Secrets held in a managed secret store, never in source.** Deployment credentials and other secrets are held in the platform secret stores (GitHub Actions secrets and Cloudflare), referenced by name at build and deploy time. No secret is committed to the repository, and the code is scanned for accidentally-committed secrets across its full history.
- **Full-history secret scanning on every branch.** Every push and pull request is scanned for secrets across the repository's entire git history and all branches, so a credential committed anywhere fails the build rather than reaching production.
- **Static code scanning and dependency review.** The codebase is configured for automated static security analysis (CodeQL) and pull-request dependency review that blocks a new dependency carrying a known high or critical vulnerability. These GitHub features require a public repository, so their workflows are visibility-gated and self-activate the moment the repository is made public.
- **Deployment blocked on high/critical dependency vulnerabilities.** A dependency vulnerability at high or critical severity blocks deployment. The block can only be waived by a signed, time-limited risk acceptance recorded in the security register; an expired or missing acceptance fails closed.
- **Transport security and hardened response headers.** The site is served over HTTPS only, with HTTP Strict Transport Security, a strict Content-Security-Policy, anti-clickjacking (frame-ancestors 'none'), MIME-sniffing protection, a strict referrer policy and a locked-down permissions policy applied to every response.
- **No identifiers or personal data in logs.** The research endpoint records no telemetry and logs nothing about a request. Application logging is scanned so that identifiers and personal data (such as IP addresses, user agents, precise location, electorate or the raw contribution) can never be written to a log.
- **Vulnerability disclosure and incident response.** There is a private vulnerability disclosure channel (GitHub security advisories, mirrored at /.well-known/security.txt) and a documented process for triaging and responding to reports and incidents.

Dependency vulnerabilities at high or critical severity block deployment; the block can only be waived by a signed, time-limited risk acceptance recorded in the register, and an expired or missing acceptance fails closed.

<!-- END GENERATED SECURITY CONTROLS -->
