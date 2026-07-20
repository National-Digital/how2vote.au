import { describe, expect, it } from "vitest";
import { mergeRegistryCsp } from "./csp.js";
import {
  allGrantedState,
  categories,
  consentModeDefaults,
  consentModeSignals,
  defaultConsentState,
  hasConfigurableConsent,
  hasConfigurableConsentIn,
  services,
  servicesForCategory,
  visibleCategories,
  type ThirdPartyRegistry,
} from "./registry";

describe("third-party registry integrity", () => {
  it("has unique category and service ids", () => {
    const catIds = categories.map((c) => c.id);
    expect(new Set(catIds).size).toBe(catIds.length);
    const svcIds = services.map((s) => s.id);
    expect(new Set(svcIds).size).toBe(svcIds.length);
  });

  it("keeps each service's consentRequired in sync with its category", () => {
    const byId = new Map(categories.map((c) => [c.id, c]));
    for (const service of services) {
      const category = byId.get(service.category);
      expect(category, `service ${service.id} references a known category`).toBeDefined();
      expect(service.consentRequired).toBe(category!.consentRequired);
    }
  });

  it("no longer declares any Google service (GA4 / reCAPTCHA removed)", () => {
    expect(services.find((s) => s.id === "google-analytics")).toBeUndefined();
    expect(services.find((s) => s.id === "recaptcha")).toBeUndefined();
    for (const s of services) {
      expect(s.provider).not.toMatch(/google/i);
      for (const sources of Object.values(s.csp)) {
        for (const src of sources ?? []) expect(src).not.toMatch(/google/i);
      }
    }
  });

  it("declares Cloudflare Turnstile as a strictly-necessary form-protection service", () => {
    const turnstile = services.find((s) => s.id === "turnstile");
    expect(turnstile).toBeDefined();
    // Anti-abuse runs only on form submit and is cookieless, so it needs no consent (like Formspree).
    expect(turnstile!.category).toBe("strictly-necessary");
    expect(turnstile!.consentRequired).toBe(false);
    expect(turnstile!.cookies).toEqual([]);
    // The CSP sources the Turnstile loader + challenge frame need.
    expect(turnstile!.csp["script-src"]).toContain("https://challenges.cloudflare.com");
    expect(turnstile!.csp["frame-src"]).toContain("https://challenges.cloudflare.com");
  });
});

describe("consent state", () => {
  it("defaults to strictly-necessary only", () => {
    const state = defaultConsentState();
    expect(state["strictly-necessary"]).toBe(true);
    expect(state.analytics).toBe(false);
  });

  it("grants everything under allGrantedState", () => {
    const state = allGrantedState();
    expect(state["strictly-necessary"]).toBe(true);
    expect(state.analytics).toBe(true);
  });

  it("shows only strictly-necessary in the preferences UI (no live consent-gated category)", () => {
    // The analytics category is retained as dormant scaffolding, but with no service under it, it is
    // filtered out of the UI — we never ask for consent we do not need.
    const ids = visibleCategories.map((c) => c.id);
    expect(ids).toContain("strictly-necessary");
    expect(ids).not.toContain("analytics");
  });

  it("lists Formspree and Turnstile under strictly-necessary, and nothing under analytics", () => {
    expect(servicesForCategory("analytics")).toEqual([]);
    const necessary = servicesForCategory("strictly-necessary");
    expect(necessary.map((s) => s.name)).toContain("Formspree");
    expect(necessary.map((s) => s.name)).toContain("Cloudflare Turnstile");
    expect(necessary.every((s) => s.consentRequired === false)).toBe(true);
  });
});

describe("hasConfigurableConsent gate", () => {
  it("is false for the shipped registry — nothing is consent-gated", () => {
    expect(hasConfigurableConsent).toBe(false);
  });

  it("is false when a consent-required category has no service", () => {
    const reg = {
      categories: [
        { id: "strictly-necessary", consentRequired: false },
        { id: "analytics", consentRequired: true },
      ],
      services: [{ id: "form", category: "strictly-necessary" }],
    } as unknown as ThirdPartyRegistry;
    expect(hasConfigurableConsentIn(reg)).toBe(false);
  });

  it("flips true the moment a consent-required category gains a live service", () => {
    const reg = {
      categories: [
        { id: "strictly-necessary", consentRequired: false },
        { id: "analytics", consentRequired: true },
      ],
      services: [
        { id: "form", category: "strictly-necessary" },
        { id: "some-analytics", category: "analytics" },
      ],
    } as unknown as ThirdPartyRegistry;
    expect(hasConfigurableConsentIn(reg)).toBe(true);
  });
});

describe("Consent Mode signal vocabulary (retained for the dormant consent machinery)", () => {
  it("denies analytics_storage by default, grants security_storage", () => {
    const defaults = consentModeDefaults();
    expect(defaults.analytics_storage).toBe("denied");
    expect(defaults.security_storage).toBe("granted");
  });

  it("maps a granted analytics decision to analytics_storage=granted", () => {
    const signals = consentModeSignals(allGrantedState());
    expect(signals.analytics_storage).toBe("granted");
    expect(signals.security_storage).toBe("granted");
  });

  it("maps a rejected decision to analytics_storage=denied", () => {
    const signals = consentModeSignals(defaultConsentState());
    expect(signals.analytics_storage).toBe("denied");
  });
});

describe("CSP derived from the registry", () => {
  const base = {
    "script-src": ["self"],
    "img-src": ["self", "data:"],
    "connect-src": ["self"],
    "font-src": ["self"],
  };

  it("appends registry third-party origins after the base tokens", () => {
    const merged = mergeRegistryCsp(base);
    // 'self' leads; the only script-src third party is the Turnstile challenge host.
    expect(merged["script-src"]).toEqual(["self", "https://challenges.cloudflare.com"]);
    // Formspree (strictly-necessary) contributes its connect-src origin through the same merge.
    expect(merged["connect-src"]).toContain("https://formspree.io");
    // Turnstile contributes its challenge host to connect-src too.
    expect(merged["connect-src"]).toContain("https://challenges.cloudflare.com");
    // No Google/analytics origin appears anywhere.
    expect(merged["script-src"].some((s) => /google/i.test(s))).toBe(false);
    expect(merged["img-src"][0]).toBe("self");
  });

  it("leaves directives with no registry sources untouched", () => {
    const merged = mergeRegistryCsp(base);
    expect(merged["font-src"]).toEqual(["self"]);
  });

  it("drops a base 'none' when a registry service adds a real source (frame-src)", () => {
    // Turnstile's challenge frame must override the locked-down frame-src: ['none'] default.
    const merged = mergeRegistryCsp({ "frame-src": ["none"] });
    expect(merged["frame-src"]).toEqual(["https://challenges.cloudflare.com"]);
    expect(merged["frame-src"]).not.toContain("none");
  });

  it("keeps a lone 'none' when no service contributes to that directive", () => {
    const merged = mergeRegistryCsp({ "object-src": ["none"] });
    expect(merged["object-src"]).toEqual(["none"]);
  });

  it("does not mutate the base object", () => {
    const snapshot = JSON.parse(JSON.stringify(base));
    mergeRegistryCsp(base);
    expect(base).toEqual(snapshot);
  });
});
