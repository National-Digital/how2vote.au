/**
 * Third-party services registry — the SINGLE SOURCE OF TRUTH for
 * every external service the site can load.
 *
 * The data lives in `third-party-services.json` and drives three consumers
 * that must never drift apart:
 *   (a) the Content-Security-Policy in `svelte.config.js` (which imports
 *       `csp.js`, a thin reader of the same JSON), so what may load and what
 *       the CSP allows can never diverge;
 *   (b) the runtime consent UI (banner + preferences modal); and
 *   (c) the privacy policy's third-party inventory table.
 *
 * Add or change a service in the JSON (data only) and the three consumers
 * follow. This module is deliberately browser-free (no `$app/*`, no `window`)
 * so it can be unit-tested and imported anywhere.
 */

import registryJson from "./third-party-services.json";

/** GDPR-aligned consent categories (superset; the registry uses what it needs). */
export type ConsentCategory = "strictly-necessary" | "functional" | "analytics" | "marketing";

/** Google Consent Mode v2 signals a category can toggle. */
export type ConsentModeSignal =
  | "ad_storage"
  | "ad_user_data"
  | "ad_personalization"
  | "analytics_storage"
  | "functionality_storage"
  | "personalization_storage"
  | "security_storage";

/** A cookie (or cookie-like storage entry) set by a third party. */
export interface ThirdPartyCookie {
  name: string;
  purpose: string;
  /** Human-readable lifespan, e.g. "2 years", "Session". */
  retention: string;
}

/** CSP fetch/navigation directives a service may require. */
export type ServiceCsp = Partial<Record<string, string[]>>;

/** One external service (analytics, embed, font host, …). */
export interface ThirdPartyService {
  id: string;
  name: string;
  provider: string;
  category: ConsentCategory;
  consentRequired: boolean;
  purpose: string;
  csp: ServiceCsp;
  cookies: ThirdPartyCookie[];
  privacyPolicyUrl: string;
  dataLocation: string;
}

/** A subprocessor a vendor discloses (name + what they do for that vendor). */
export interface Subprocessor {
  name: string;
  purpose: string;
}

/**
 * DPA / contract evidence for a vendor. The contract itself is a confidential
 * EXTERNAL artefact held in the restricted legal records — this only references it by a
 * non-sensitive evidence ID and status. `pending` is honest until it has been reviewed and
 * filed; nothing here asserts an approval that does not exist (fail-closed).
 */
export interface VendorContract {
  /** Contract shape, e.g. "DPA", "TermsOfService+DPA". */
  type: string;
  /** Non-sensitive evidence ID cross-referenced in the control/legal registers. */
  evidenceId: string;
  status: "pending" | "current" | "expired";
  /** ISO date the vendor control was last reviewed. */
  reviewDate: string;
  /** ISO date the next review is due — an overdue date fails the build (fail-closed). */
  nextReviewDate: string;
  note?: string;
}

/**
 * An infrastructure / build-time vendor (hosting, source control, data source) — distinct from a
 * browser-loaded {@link ThirdPartyService}. These are NOT consent-gated and do NOT contribute to the
 * CSP (the browser does not contact them cross-origin); they are governed by the vendor-control
 * framework (DPA/contract evidence, retention, subprocessors, review dates).
 */
export interface InfrastructureService {
  id: string;
  name: string;
  provider: string;
  surface: "infrastructure";
  role: string;
  dataProcessing: string;
  retention: string;
  subprocessors: Subprocessor[];
  /** Provider's published subprocessor list, when it maintains one. */
  subprocessorsUrl?: string;
  /** Explanation when the vendor publishes no subprocessor list. */
  subprocessorsNote?: string;
  dataLocation: string;
  privacyPolicyUrl: string;
  /** Hosts this vendor is contacted at (build/server time). Empty when never contacted directly. */
  egressHosts: string[];
  contract: VendorContract;
}

/**
 * One anti-abuse mechanism. Accessibility is a first-class requirement: a
 * mechanism must not impose an inaccessible interactive challenge. An `interactive` mechanism must
 * name an accessible alternative; a non-interactive one (score/rate-limit) is accessible by design.
 */
export interface AntiAbuse {
  id: string;
  /** The registered service id that provides this mechanism. */
  service: string;
  mechanism: string;
  interactive: boolean;
  accessible: boolean;
  /** id of an accessible alternative mechanism, required if this one is interactive. */
  accessibleAlternative?: string;
  note: string;
}

/** Presentation + consent metadata for a category, consumed by the modal. */
export interface ConsentCategoryMeta {
  id: ConsentCategory;
  label: string;
  description: string;
  consentRequired: boolean;
  consentModeSignals: ConsentModeSignal[];
}

/** Root document of `third-party-services.json`. */
export interface ThirdPartyRegistry {
  version: number;
  categories: ConsentCategoryMeta[];
  services: ThirdPartyService[];
  infrastructure: InfrastructureService[];
  antiAbuse: AntiAbuse[];
}

/** Parsed registry (single source of truth). */
export const registry = registryJson as ThirdPartyRegistry;

/** Versioned localStorage key for the persisted consent record. */
export const CONSENT_STORAGE_KEY = "how2vote:consent:v1";

/** Registry/consent schema version. Bumping it (in the JSON) re-prompts everyone. */
export const CONSENT_VERSION = registry.version;

/** Consent decision: category id → granted. */
export type ConsentState = Record<ConsentCategory, boolean>;

/** Persisted, timestamped consent record — what was agreed, and when. */
export interface ConsentRecord {
  version: number;
  timestamp: string;
  categories: ConsentState;
}

export const categories: ConsentCategoryMeta[] = registry.categories;
export const services: ThirdPartyService[] = registry.services;

/** Infrastructure / build-time vendors (hosting, source control, data source). */
export const infrastructureServices: InfrastructureService[] = registry.infrastructure ?? [];

/** Registered anti-abuse mechanisms and their accessibility posture. */
export const antiAbuse: AntiAbuse[] = registry.antiAbuse ?? [];

/**
 * Every vendor (browser + infrastructure) as a uniform provider row for the privacy policy's
 * provider table, alphabetical by name. The table is generated from the registry so it can never
 * drift from what the site actually loads and depends on.
 */
export interface ProviderRow {
  id: string;
  name: string;
  provider: string;
  surface: "browser" | "infrastructure";
  summary: string;
  dataLocation: string;
}

export const providerTable: ProviderRow[] = [
  ...services.map((s): ProviderRow => ({
    id: s.id,
    name: s.name,
    provider: s.provider,
    surface: "browser",
    summary: s.purpose,
    dataLocation: s.dataLocation,
  })),
  ...infrastructureServices.map((s): ProviderRow => ({
    id: s.id,
    name: s.name,
    provider: s.provider,
    surface: "infrastructure",
    summary: s.role,
    dataLocation: s.dataLocation,
  })),
].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

/** Services declared under a category, alphabetical by name for display. */
export function servicesForCategory(categoryId: ConsentCategory): ThirdPartyService[] {
  return services
    .filter((service) => service.category === categoryId)
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/**
 * Categories shown in the preferences UI: strictly-necessary (always) plus any
 * consent-required category that actually has a registered service — we never
 * ask for more than we use.
 */
export const visibleCategories: ConsentCategoryMeta[] = categories.filter(
  (category) => !category.consentRequired || servicesForCategory(category.id).length > 0,
);

/**
 * Pure predicate: does some consent-required category have at least one service? Exported so the
 * gate logic can be exercised against a synthetic registry in tests (the shipped machinery is
 * otherwise dormant and hard to observe). {@link hasConfigurableConsent} is this applied to the real
 * registry.
 */
export function hasConfigurableConsentIn(reg: ThirdPartyRegistry): boolean {
  return reg.categories.some(
    (category) =>
      category.consentRequired && reg.services.some((service) => service.category === category.id),
  );
}

/**
 * Whether anything on the site is actually consent-gated: true iff some consent-required category
 * has at least one live service. When false there is nothing to consent to, so the consent banner
 * and preferences UI stay hidden (gated on this in the layout and footer) even though the store and
 * its components remain intact and dormant. It is derived purely from the registry, so adding a
 * consent-required service back to the JSON flips it true and the UI returns with no code change —
 * and removing the last one hides it again. Today it is false: usage is measured by cookieless
 * Cloudflare Web Analytics at the edge and NO third party loads in the browser at all (the
 * anti-abuse check is self-hosted), so no category both requires consent and has a service.
 */
export const hasConfigurableConsent: boolean = hasConfigurableConsentIn(registry);

/** Baseline: strictly-necessary granted, everything requiring consent denied. */
export function defaultConsentState(): ConsentState {
  return categories.reduce<ConsentState>((acc, category) => {
    acc[category.id] = !category.consentRequired;
    return acc;
  }, {} as ConsentState);
}

/** Every category granted (the "Accept all" outcome). */
export function allGrantedState(): ConsentState {
  return categories.reduce<ConsentState>((acc, category) => {
    acc[category.id] = true;
    return acc;
  }, {} as ConsentState);
}

type ConsentSignalMap = Partial<Record<ConsentModeSignal, "granted" | "denied">>;

/**
 * Consent Mode v2 defaults implied by the registry BEFORE any user choice:
 * signals owned by a consent-required category default to 'denied', those owned
 * by a strictly-necessary category to 'granted'.
 */
export function consentModeDefaults(): ConsentSignalMap {
  const out: ConsentSignalMap = {};
  for (const category of categories) {
    const value = category.consentRequired ? "denied" : "granted";
    for (const signal of category.consentModeSignals) out[signal] = value;
  }
  return out;
}

/** Consent Mode v2 signal map for a concrete user decision. */
export function consentModeSignals(state: ConsentState): ConsentSignalMap {
  const out: ConsentSignalMap = {};
  for (const category of categories) {
    const value = state[category.id] ? "granted" : "denied";
    for (const signal of category.consentModeSignals) out[signal] = value;
  }
  return out;
}
