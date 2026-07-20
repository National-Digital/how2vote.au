import { formatAuthorisation } from "./print-auth";

/**
 * In-memory-only owner capability + print acknowledgement for the card route — National Digital
 * authoriser model (see docs/adr/0010, which supersedes the earlier user-particulars print model).
 *
 * The printed how-to-vote plan carries NATIONAL DIGITAL's authorisation (fixed operator particulars,
 * from {@link formatAuthorisation}), not the user's, so this state no longer collects or holds any
 * user identity. What it holds is:
 *   - the owner capability — true only for a card this browser built from its own in-progress quiz
 *     in this session (never for a card opened from a shared link);
 *   - a transient acknowledgement that the plan is National-Digital-authorised, the preference order
 *     is the user's own selection, and it is not a ballot paper.
 *
 * Both are held in memory only and are:
 *   - NEVER persisted (no localStorage / sessionStorage / cookie / IndexedDB);
 *   - NEVER placed in a URL, share fragment, DOM attribute or network request;
 *   - reset when the module re-initialises, so owner-ness is intentionally lost on reload — a
 *     reloaded or shared `/card#…` link is shared-readonly and can never print.
 */
class PrintAuthState {
  /**
   * The owner capability. True only for a card this browser built from its own in-progress quiz in
   * this session. Private so nothing outside this module can forge it; exposed read-only via
   * {@link isOwner}.
   */
  #owner = $state(false);

  /**
   * Whether the voter has ACKNOWLEDGED the print (the plan is National-Digital-authorised, the
   * preference order is their own selection, and it is not a ballot paper) AND taken the print
   * action. Only then does the printed stamp render; a mid-form native (Ctrl+P) print before the
   * acknowledgement falls through to the "not authorised" notice instead.
   */
  #acknowledged = $state(false);

  /** Whether this session holds the owner capability (may print). */
  get isOwner(): boolean {
    return this.#owner;
  }

  /** True once the voter has acknowledged the print (the print action becomes available). */
  get acknowledged(): boolean {
    return this.#acknowledged;
  }

  /**
   * The stamp actually PRINTED at the end of the document — National Digital's authorisation plus the
   * "preference order selected by the user" notice. Non-empty ONLY once the acknowledgement is given,
   * so no stamp can print from an un-acknowledged native (Ctrl+P) print.
   */
  get stamp(): string {
    return this.#acknowledged ? formatAuthorisation() : "";
  }

  /** Claim ownership for a card built from this session's own quiz. */
  claimOwnership(): void {
    this.#owner = true;
  }

  /** Acknowledge the print — makes {@link stamp} non-empty. Called from the confirm action only. */
  acknowledge(): void {
    this.#acknowledged = true;
  }

  /** Clear the acknowledgement (cancel / print completion / route change). */
  clearAcknowledgement(): void {
    this.#acknowledged = false;
  }

  /** Full teardown: drop the owner capability and the acknowledgement. */
  reset(): void {
    this.#owner = false;
    this.#acknowledged = false;
  }
}

export const printAuth = new PrintAuthState();
