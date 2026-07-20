import { browser } from "$app/environment";
import { quiz } from "./quiz.svelte";
import { saved } from "./saved.svelte";

/**
 * The age-first eligibility gate (see docs/adr/0011, as amended by docs/adr/0012).
 *
 * A one-time 18+ self-declaration is the FIRST interactive step of the quiz/comparison flow — reached
 * before any quiz state, answer, research consent, integrity token or share capability can exist
 * (the root layout redirects every gated route here until it is answered). It is a self-declaration of
 * eligibility, NOT a verified age: we never ask for, hold, or transmit a date of birth, an age band
 * or any age value — only a single yes/no eligibility bit.
 *
 * TWO CAPABILITIES (ADR 0012). Answering the declaration opens one of two capability levels:
 *   - {@link canExplore} — take the quiz and see the comparison (how your views line up with the
 *     parties' recorded votes). Open to an adult OR to an under-18 who chooses to explore.
 *   - {@link canVote} — build, print, share or save a how-to-vote plan, and join the optional
 *     research. 18+ ONLY. A how-to-vote card is electoral material for a voter, so it is never
 *     produced for someone who has told us they are too young to vote — the comparison is educational,
 *     the plan is not. This is the load-bearing line: an under-18 gets a result, never a card.
 *
 * WHAT IS STORED. The only thing persisted is a one-bit acknowledgement that the visitor affirmed
 * they are eligible ({@link STORAGE_KEY} = "1"), mirroring the terms-acknowledgement store
 * (`./terms.svelte.ts`). This lets a returning adult resume an in-progress quiz across a
 * reload (WCAG 3.3.7 Redundant Entry) without re-declaring, and lets the gate fail closed on a fresh
 * device. An under-18 (explore-only) declaration is NEVER persisted — it is in-memory only for this
 * session, so a reload fails closed to the fresh gate. No age, band or date is written anywhere.
 *
 * WHAT NEVER HAPPENS. The eligibility answer is never included in a research payload, never placed
 * in a URL and never sent over the network (enforced statically by scripts/check-age-gate.mjs and at
 * runtime by apps/web/e2e/age-gate.spec.ts): this module holds no `fetch`, and the research
 * ingestion path never imports it. The demographic "age group" question in the optional research
 * survey (`./survey.ts`) is a SEPARATE, consented, aggregate-only field — unrelated to this
 * eligibility gate (and reachable only under {@link canVote}, i.e. never by an under-18 explorer).
 */
const STORAGE_KEY = "how2vote:age-ok:v1";

class AgeGate {
  /** True once the visitor has affirmed they are 18+ (may vote). Persisted as a single bit. */
  #confirmed = $state(false);
  /**
   * True when the visitor declared they are under 18 in THIS session and chose to explore. In-memory
   * only and never persisted, so a reload fails closed back to the undeclared gate. It opens the
   * quiz + comparison (an educational result) but NEVER the plan builder / print / share / save or
   * the research survey — those stay gated behind {@link canVote}.
   */
  #minor = $state(false);
  /** True once hydrate() has run client-side. */
  ready = $state(false);

  /**
   * The gated route a visitor tried to reach before the gate, so we can return them there after they
   * answer (e.g. a deep-linked shared card). In-memory only, never persisted, single-use.
   */
  #intended: string | null = null;

  /** Whether the visitor has affirmed they are 18+ (the full, vote-capable capability). */
  get confirmed(): boolean {
    return this.#confirmed;
  }

  /** Whether the visitor declared under-18 this session (explore-only mode). */
  get minor(): boolean {
    return this.#minor;
  }

  /**
   * May enter the quiz and see the comparison — an adult, or an under-18 who chose to explore. This
   * is the gate for `/ballot`, `/quiz`, `/review` and the `/card` COMPARE stage.
   */
  get canExplore(): boolean {
    return this.#confirmed || this.#minor;
  }

  /**
   * May build / print / share / save a how-to-vote plan and join the optional research — 18+ only.
   * This is the gate for the `/card` BUILD stage, the print + share + save actions, and `/survey`.
   * An under-18 explorer is deliberately false here: they get a comparison, never a how-to-vote card.
   */
  get canVote(): boolean {
    return this.#confirmed;
  }

  /** Read any stored eligibility acknowledgement. Call once, in the browser. */
  hydrate(): void {
    if (!browser) {
      this.ready = true;
      return;
    }
    try {
      this.#confirmed = localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      this.#confirmed = false;
    }
    this.ready = true;
  }

  /**
   * Record that a visitor tried to reach `path` before answering the gate, so answering can return
   * them there. Only a same-origin absolute path is kept; anything else falls back to the default
   * start of the flow. A no-op once eligibility is confirmed.
   */
  intend(path: string): void {
    if (this.#confirmed) return;
    this.#intended = /^\/(?!\/)/.test(path) && !path.startsWith("/start") ? path : null;
  }

  /** Take (and clear) the remembered destination, defaulting to the start of the ballot flow. */
  takeIntended(): string {
    const next = this.#intended ?? "/ballot";
    this.#intended = null;
    return next;
  }

  /** Affirm eligibility (18+). Persists the single acknowledgement bit and clears explore-only mode. */
  confirmAdult(): void {
    this.#confirmed = true;
    this.#minor = false;
    if (!browser) return;
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Storage disabled — the acknowledgement still applies for this session.
    }
  }

  /**
   * Declare under-18 and continue in explore-only mode (ADR 0012). Nothing eligibility-related is
   * persisted, so a reload fails closed to the fresh gate. Any pre-existing local quiz and saved-card
   * state left on the device by a prior (adult) session is cleared first — an under-18 must never
   * inherit, print or share a plan built before the gate. The quiz + comparison then open for this
   * session; the plan builder / print / share / save and the research survey stay closed
   * ({@link canVote} is false). No age value is recorded and nothing is uploaded.
   */
  declareMinor(): void {
    this.#minor = true;
    this.#confirmed = false;
    this.#intended = null;
    // Clear anything a prior (adult) session left on this device: in-progress quiz (for EVERY
    // election, not just the active one) + saved cards. An under-18 must never inherit a plan or
    // answers built before the gate.
    quiz.clearAllElections();
    saved.clear();
    if (!browser) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clear if storage is unavailable.
    }
  }
}

/** Single shared age-eligibility gate. */
export const ageGate = new AgeGate();
