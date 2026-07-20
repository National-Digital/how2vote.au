/**
 * Consent store — the client-side owner of the visitor's consent
 * decision, its persistence, and the seam that applies a decision to the
 * consent-gated services of the day.
 *
 * Static export means there is no server session, so the decision lives on the
 * device under a versioned localStorage key. A version mismatch (bump the
 * registry version) or a malformed record is treated as "no decision", so a
 * policy change re-prompts. Same-tab writes update the runes state directly;
 * cross-tab changes come through the `storage` event.
 *
 * The banner is gated on `ready` (set only after hydrate() runs in the
 * browser), so it never appears in the statically-prerendered HTML and cannot
 * cause a hydration mismatch. It is additionally gated in the layout on
 * `hasConfigurableConsent`, so with no consent-gated service registered (the
 * state today — analytics is cookieless Cloudflare edge, Turnstile is
 * cookieless) the UI stays hidden. The store is kept fully intact and dormant:
 * it still hydrates and persists a decision so that adding a consent-gated
 * service back to the registry — and wiring it into applyConsent() below — is a
 * one-line change, not a rebuild.
 */

import { browser } from "$app/environment";
import {
  CONSENT_STORAGE_KEY,
  CONSENT_VERSION,
  allGrantedState,
  categories,
  defaultConsentState,
  type ConsentRecord,
  type ConsentState,
} from "./registry";

/**
 * Apply a consent decision to the consent-gated services it governs. This is the single seam a
 * future consent-gated service hooks into (e.g. loading a tag only once its category is granted, or
 * revoking it on withdrawal). It is intentionally a no-op today: nothing the site loads is
 * consent-gated, so there is nothing to switch on or off — but every decision still flows through
 * here so the wiring point is obvious and the store never needs to learn about a specific vendor.
 */
function applyConsent(_next: ConsentState): void {
  // No consent-gated service is registered today (see hasConfigurableConsent). When one is added,
  // read `_next[category]` here and load/unload it accordingly.
}

/** The stored decision, or null if none/invalid/outdated (→ show the banner). */
function readConsentRecord(): ConsentRecord | null {
  if (!browser) return null;
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsentRecord> | null;
    if (!parsed || parsed.version !== CONSENT_VERSION || !parsed.categories) return null;

    // Normalise against the current category set: missing → denied, and
    // strictly-necessary is forced on regardless of what was stored.
    const stored = parsed.categories;
    const normalised = defaultConsentState();
    for (const category of categories) {
      normalised[category.id] = category.consentRequired ? Boolean(stored[category.id]) : true;
    }
    return {
      version: CONSENT_VERSION,
      timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : new Date().toISOString(),
      categories: normalised,
    };
  } catch {
    return null;
  }
}

/** Persist a decision. Returns the record so the session applies it even if storage fails. */
function writeConsentRecord(state: ConsentState): ConsentRecord {
  const record: ConsentRecord = {
    version: CONSENT_VERSION,
    timestamp: new Date().toISOString(),
    categories: state,
  };
  if (browser) {
    try {
      localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
    } catch {
      // Storage disabled (private mode etc.) — the choice still applies this
      // session via the in-memory record, it just won't be remembered.
    }
  }
  return record;
}

class Consent {
  #record = $state<ConsentRecord | null>(null);
  /** True once hydrate() has run client-side; gates the banner (SSR-safe). */
  ready = $state(false);
  /** Whether the preferences modal is open. */
  isSettingsOpen = $state(false);

  /** Current decision (defaults to strictly-necessary only before any choice). */
  get state(): ConsentState {
    return this.#record?.categories ?? defaultConsentState();
  }

  /** Whether the visitor has made an explicit choice (vs. needing the banner). */
  get hasDecided(): boolean {
    return this.#record !== null;
  }

  /** Read the stored decision and apply it. Call once, in the browser. */
  hydrate(): void {
    if (!browser) return;
    this.#record = readConsentRecord();
    this.ready = true;
    // Apply a returning visitor's stored choice so it takes effect from the first hit. No-op today
    // (nothing is consent-gated), but the seam is live so a future service is honoured immediately.
    if (this.#record) applyConsent(this.#record.categories);
    window.addEventListener("storage", (event) => {
      if (event.key !== CONSENT_STORAGE_KEY) return;
      this.#record = readConsentRecord();
      // A decision made in another tab must take effect here too (a revoke must unload, a grant must
      // load). Without this, a cross-tab change would be stale until reload.
      applyConsent(this.#record?.categories ?? defaultConsentState());
    });
  }

  #commit(next: ConsentState): void {
    this.#record = writeConsentRecord(next);
    applyConsent(next);
  }

  acceptAll(): void {
    this.#commit(allGrantedState());
    this.isSettingsOpen = false;
  }

  rejectAll(): void {
    this.#commit(defaultConsentState());
    this.isSettingsOpen = false;
  }

  savePreferences(next: ConsentState): void {
    this.#commit(next);
    this.isSettingsOpen = false;
  }

  openSettings(): void {
    this.isSettingsOpen = true;
  }

  closeSettings(): void {
    this.isSettingsOpen = false;
  }
}

/** Single shared consent store (mirrors the theme/quiz store pattern). */
export const consent = new Consent();
