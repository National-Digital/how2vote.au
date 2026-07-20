# Architecture Decision Records

Records of the foundational architecture and design decisions for how2vote.au — the context, the
choice, and its consequences — including choices deliberately deferred for later. One file per
decision, ordered foundation-first: the platform and data model, then the compliance and research
design built on them, then the product-level decisions.

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-static-client-scored-pwa.md) | Static, client-scored offline PWA | Accepted |
| [0002](0002-multi-election-support.md) | Support multiple elections with faithful historical data | Accepted |
| [0003](0003-drop-unelected-candidates.md) | No self-submitted candidate positions | Accepted (reversible) |
| [0004](0004-aec-nominations-manual-ingestion.md) | AEC candidate nominations are a manual, election-time ingestion step | Accepted (reversible) |
| [0005](0005-tvfy-snapshot-lock.md) | TVFY snapshot & lock at declaration of nominations | Accepted |
| [0006](0006-legal-compliance-rebuild.md) | Electoral & privacy compliance design (user-authored output + minimised research) | Accepted |
| [0007](0007-same-origin-research-backend.md) | Minimal same-origin research backend (Pages Functions + D1) | Accepted (reversible) |
| [0008](0008-aggregate-counters.md) | Aggregate-counters research storage (no per-person rows) | Accepted |
| [0009](0009-compliance-control-register.md) | Fail-closed compliance control register and release manifest | Accepted |
| [0010](0010-constrained-product-boundary.md) | Constrained product boundary + National Digital print authorisation | Accepted |
| [0011](0011-age-first-gate.md) | Age-first eligibility gate before any quiz state | Accepted |
| [0012](0012-under-18-explore-mode.md) | Under-18 explore-only mode (comparison yes, how-to-vote card no) | Accepted |
| [0013](0013-provisional-upcoming-quiz.md) | Provisional quiz for an upcoming election | Accepted |
| [0014](0014-election-day-notice.md) | Close the Insights page on election day | Accepted |
| [0015](0015-first-party-telemetry-and-anti-abuse.md) | First-party/Cloudflare telemetry & anti-abuse | Accepted |
| [0016](0016-deliberate-freeze-and-longevity.md) | Deliberate freeze posture and a longevity re-review | Accepted |
