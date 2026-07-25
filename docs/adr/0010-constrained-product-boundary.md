# 0010 — Constrained product boundary and National Digital print authorisation

- Status: Accepted; external determinations recorded in `data/legal/product-boundary.json`
- Deciders: National Digital
- Relates to: [0006](0006-legal-compliance-rebuild.md) (compliance design),
  [0008](0008-aggregate-counters.md) (aggregate-counters research storage),
  [0009](0009-compliance-control-register.md) (control register),
  [0015](0015-first-party-telemetry-and-anti-abuse.md) (telemetry + anti-abuse)

This ADR is the single record for the printed how-to-vote authorisation. It establishes the
**National Digital authoriser model**, replacing an earlier theory that treated the voter as the sole
s321D author/authoriser of the printed material.

## Context

A clean-room electoral-law review of the full feature set concluded that several capabilities should
not ship as "legally complete" until specific **external determinations** are made, and that a
constrained, read-only historical comparison service is defensible in the meantime. The review's
central engineering recommendation was to make the legal state **machine-readable but externally
determined**, and to **fail closed** wherever a determination is missing, expired, or inconsistent
with the running code.

The two most material findings were:

1. **The printed authorisation and its authoriser were not safely established.** The earlier model
   treated the voter as the sole s321D author/authoriser of the printed how-to-vote material because
   they chose the preference order. National Digital, however, creates and communicates the template,
   ballot list, voting instructions and the software that assembles the document — so the safe position
   is that National Digital authorises the material it publishes, with the preference order clearly
   identified as user-supplied.

2. **The optional research survey collects a sensitive political/demographic profile in transit.**
   Aggregate-only storage is strong, but collection and transit remain legally material until a PIA,
   a Privacy Act coverage determination, a field-by-field necessity assessment, per-category sensitive
   consent, and provider log/retention evidence exist.

## Decision

1. **A machine-readable product boundary** (`data/legal/product-boundary.json`) records the
   externally-determined legal state: `printMode`, `researchEnabled`, `liveElectionEnabled`,
   `archivePrintEnabled`, `candidateScorePlacement`, and the pending determinations
   (print authoriser, disclosure entity, electoral expenditure, Privacy Act coverage, AEC provenance,
   accessibility human testing). It is bound into the release manifest (`productBoundaryHash`) and a
   blocking guard (`scripts/check-product-boundary.mjs`) fails the build if it is expired, malformed,
   or **disagrees with the signed runtime control plane** — a declared boundary that is not actually
   enforced is treated as a failure.

2. **Printing and research are governed by the signed control plane** (`data/governance/control-plane.json`,
   global `printing` and `research` suspensions). A capability stays withdrawn until its determination
   clears, at which point the suspension is lifted with an audited RESTORE record. The live state is
   whatever the signed control plane and the product boundary encode; CI holds the two in agreement, so
   the boundary file — not this ADR — is the source of truth for what is currently enabled.

3. **National Digital authoriser model for print.** When printing is enabled, the printed material
   carries National Digital's entity authorisation (correct operator entity particulars) and separately
   states that the preference order was selected by the user. The printed plan carries a neutral ballot
   list, the user's numbers and official voting instructions — no party-alignment scores. This reverses
   the user-as-sole-authoriser theory. The stamp therefore carries **no user-entered particulars**
   (no name, no locality); the print step is an **acknowledgement**, not a form that collects the
   user's identity. The still-current print mechanism:

   - **Authorisation is mandatory before any print.** The print action never calls `window.print()`
     directly; it opens an authorisation screen, reachable only after that screen is completed.
   - **The authorisation step is a real modal** — it traps focus, moves focus in on open, restores it
     on close, closes on Escape and backdrop click, and locks body scroll (the `ConsentSettings`
     pattern), so `aria-modal="true"` matches the DOM.
   - **The stamp renders at the foot of every printed page** via a `position: fixed` element inside an
     `@media print` block (the site `<footer>` is print-hidden), so multi-page Senate ballots carry the
     authorisation on each page. The stamp is non-empty only once the voter has affirmed; a native
     (Ctrl+P) print that was not affirmed falls through to a "not authorised for distribution" foot
     notice instead of an unaffirmed stamp.
   - **In-memory owner capability, never persisted, never in a URL.** The single card route models a
     discriminated session — `shared-readonly` / `owner-session` / `print-authorisation` — defaulting
     to the least-privileged `shared-readonly` (fail closed). A card built from this browser's own quiz
     claims an in-memory-only owner capability; a card opened from a share link never does. Owner-ness
     is intentionally lost on reload, so a reloaded or shared `/card#…` link is `shared-readonly` and
     can never print.
   - **No preselected or auto-ranked candidates.** Rows render in official ballot order and every plan
     order starts empty; the printed order equals the reviewed order.
   - Free-text reaching print is length- and character-validated and the authorisation is bounded so it
     cannot overflow the printed area.

4. **Party-level score placement.** Party-derived alignment scores are shown in a dedicated
   party-level panel with a visible "party record — not the candidate's personal position" qualifier,
   never as a percentage beside an individual candidate's name.

5. **Fail-closed production surfaces.** The research and geography endpoints refuse production
   submissions when a mandatory integrity control (token secret, challenge secret, atomic D1 nonce store,
   research DB) is absent, rather than failing open. Production deploys fail on missing D1
   infrastructure credentials rather than skipping their verification steps.

## Consequences

- The legal state is auditable and drift-proof: the boundary, the control plane and the release
  manifest must agree, and any relaxation requires an explicit, attributed change to all three.
- The print invariants are held by a blocking Playwright suite, `legal-electoral-output`
  (`apps/web/e2e/legal-electoral-output.spec.ts`): no prohibited field in a share payload; owner
  capability never in a URL; a shared card has no builder/print; printed order equals reviewed order;
  the personal authorisation form cannot be bypassed; and the stamp is the exact locked wording.
- Because owner-ness is deliberately non-persistent, a voter who reloads mid-build must rebuild — an
  accepted privacy trade-off (no owner token is stored anywhere to restore it).
- The definitive resolution of the authoriser identity, disclosure-entity status, Privacy Act coverage
  and expenditure classification remains an external legal determination, not a code comment. The
  code's job here is to enforce those determinations and refuse to ship without them.
