# Accessibility conformance

**Target: WCAG 2.2 Level AA.** This is the benchmark the Australian Human Rights Commission cites
under the Disability Discrimination Act and the bar the project holds itself to.

## How conformance is enforced

- **Automated, blocking in CI:** axe-core on every screen (zero WCAG 2 A/AA violations), Lighthouse
  accessibility as a required check, and a keyboard-only end-to-end run of the full 50-question flow.
- **By construction:** the interface is strictly two-tone with no hue anywhere (CI greps the built
  CSS), so information is never conveyed by colour alone; `forced-colors` maps the palette onto system
  colours; a visible non-default focus indicator is global (2.4.7).

## WCAG 2.2 manual conformance pass (2026-07-18)

Automated tools (axe-core, Lighthouse) **under-detect** the nine success criteria added in WCAG 2.2, so
a passing automated run does not by itself prove 2.2 AA. The new A/AA criteria were reviewed by hand and
the following recorded, so the conformance state is defensible independent of any future tool version
(re-review is tied to [ADR-0016](adr/0016-deliberate-freeze-and-longevity.md)):

| SC (level) | Status |
| --- | --- |
| 2.4.11 Focus Not Obscured (Minimum) (AA) | **Met.** No sticky top header exists; a root `scroll-padding-bottom` keeps keyboard focus clear of the bottom-fixed consent banner when it is live. |
| 2.5.7 Dragging Movements (AA) | **Met.** No interaction requires dragging; the electorate map pans/zooms but selection is by single-pointer tap and all data is reachable without the map. |
| 2.5.8 Target Size (Minimum) (AA) | **Met** — see below. |
| 3.3.7 Redundant Entry (A) | **Met.** The flow never asks for information already provided in the same process. |
| 3.3.8 Accessible Authentication (Minimum) (AA) | **Met.** There is no login; the only challenge is Cloudflare Turnstile (a managed, non-interactive challenge), not a cognitive-function test / solved-puzzle CAPTCHA. |
| 3.2.6 Consistent Help (A) | **Met.** The contact/feedback affordance is in a consistent relative location. |

### 2.5.8 Target Size — controls enlarged and exceptions recorded

Interactive targets must be ≥ 24×24 CSS px **unless** an exception applies (a 24px spacing circle to
every adjacent target does not overlap; the control is inline in a sentence; or an equivalent control
meets the size elsewhere). The following standalone controls were given a 24px-tall hit area *without*
changing their type size (`min-height` + `inline-flex`, or a 24px box for the checkbox):

- Footer navigation links and the cookie-settings button (adjacent targets 16px apart — spacing
  exception does not apply);
- Breadcrumb links (crumbs 6px apart — spacing exception does not apply);
- the quiz "source" citation link and "Pause" link;
- the per-category consent checkbox (its label is associated by `for=`, a separate box, so the
  checkbox must meet the size on its own).

Controls **left unchanged because an exception applies** (recorded so the decision is auditable):

- the electorate-map licence `<summary>` and other isolated small disclosures — no other interactive
  target sits within 24px, so the spacing exception is met automatically;
- inline links inside sentence prose (electoral authorisation, credit line, the card's inline "record"
  citation) — the inline-in-a-sentence exception;
- the card's "Change my answers" / "Make my own comparison" links — an equivalent primary action of at
  least 24px is present on the same screen.

## WCAG 3.0

Not applicable in the project's horizon: WCAG 3.0 remains a Working Draft with no normative status
expected before ~2028–2029, and its outcome/scoring model is not settled. Conforming to 2.2 AA, with
contrast and semantics kept above the minimums, is the durable position — see
[ADR-0016](adr/0016-deliberate-freeze-and-longevity.md).
