/**
 * Records VERSIONED, active acceptance of the Terms of Use before any consequential action — building
 * a voting plan, creating a share link, printing the s321D worksheet, or contributing to research.
 * Passive "by using the site you agree" is not enough
 * for the actions with real consequences, so we ask for an explicit, versioned acceptance at that
 * point and record WHAT was accepted (the Terms version) and WHEN (a timestamp), device-locally.
 *
 * Fail closed: {@link accepted} is true ONLY when the recorded acceptance is for the CURRENT
 * {@link TERMS_VERSION}. A stored acceptance of any other version (a material Terms change bumped the
 * version) reads as not-accepted, so a user re-accepts the current wording before proceeding.
 *
 * Device-local (static export, no server session) and deliberately SEPARATE from research consent,
 * which is a distinct decision with its own gate. Mirrors the theme/consent/age store pattern.
 */

import { browser } from "$app/environment";
import { TERMS_VERSION } from "./terms/terms";

const STORAGE_KEY = "how2vote:terms-accept:v2";

/** What is persisted device-locally: the accepted Terms version + when it was accepted. */
type AcceptanceRecord = { version: string; acceptedAt: string };

class TermsAcceptance {
  #record = $state<AcceptanceRecord | null>(null);
  /** True once hydrate() has run client-side. */
  ready = $state(false);

  /**
   * Whether the user has actively accepted the CURRENT Terms version. False until an explicit
   * acceptance of exactly {@link TERMS_VERSION} — a stored acceptance of an older/other version
   * (Terms changed) reads as not-accepted, so the current wording is re-accepted (fail closed).
   */
  get accepted(): boolean {
    return this.#record?.version === TERMS_VERSION;
  }

  /** The Terms version the user last accepted, or null if none is recorded. */
  get acceptedVersion(): string | null {
    return this.#record?.version ?? null;
  }

  /** When the current acceptance was recorded (ISO), or null. */
  get acceptedAt(): string | null {
    return this.#record?.acceptedAt ?? null;
  }

  /** Read any stored acceptance. Call once, in the browser. */
  hydrate(): void {
    if (!browser) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof (parsed as AcceptanceRecord).version === "string" &&
        typeof (parsed as AcceptanceRecord).acceptedAt === "string"
      ) {
        this.#record = parsed as AcceptanceRecord;
      } else {
        this.#record = null;
      }
    } catch {
      this.#record = null;
    }
    this.ready = true;
  }

  /** Persist an explicit acceptance of the CURRENT Terms version, stamped with the time. */
  accept(): void {
    const record: AcceptanceRecord = {
      version: TERMS_VERSION,
      acceptedAt: new Date().toISOString(),
    };
    this.#record = record;
    if (!browser) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    } catch {
      // Storage disabled — the acceptance still applies for this session.
    }
  }
}

/** Single shared versioned Terms-acceptance store. */
export const termsAcceptance = new TermsAcceptance();
