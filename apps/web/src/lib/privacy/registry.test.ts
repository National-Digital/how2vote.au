import { describe, expect, it } from "vitest";
import { mergeRegistryCsp } from "./csp.js";
import {
  allGrantedState,
  antiAbuse,
  categories,
  consentModeDefaults,
  consentModeSignals,
  defaultConsentState,
  hasConfigurableConsent,
  hasConfigurableConsentIn,
  infrastructureServices,
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

  it("declares exactly one browser-loaded service: the cookieless page counter", () => {
    // Turnstile and Formspree are gone: the anti-abuse challenge is a self-hosted proof-of-work and
    // the forms post to our own /api/forms. The one service that does load in the browser is the
    // page counter, and it earns its no-consent classification by setting nothing and keeping
    // nothing — a service that took a cookie or an identifier could not be registered this way.
    expect(services.map((s) => s.id)).toEqual(["cloudflare-web-analytics"]);
    const counter = services[0]!;
    expect(counter.category).toBe("strictly-necessary");
    expect(counter.consentRequired).toBe(false);
    expect(counter.cookies).toEqual([]);
    expect(services.find((s) => s.id === "turnstile")).toBeUndefined();
    expect(services.find((s) => s.id === "formspree")).toBeUndefined();
  });

  it("registers the self-hosted proof-of-work as the accessible anti-abuse mechanism", () => {
    const pow = antiAbuse.find((a) => a.id === "altcha-pow");
    expect(pow).toBeDefined();
    expect(pow!.interactive).toBe(false);
    expect(pow!.accessible).toBe(true);
    // Attributed to a registered vendor (the Pages Functions run on Cloudflare infrastructure).
    expect(infrastructureServices.map((v) => v.id)).toContain(pow!.service);
    // And no anti-abuse mechanism resolves to a third-party challenge service.
    expect(antiAbuse.find((a) => a.id === "turnstile")).toBeUndefined();
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

  it("lists the page counter as strictly necessary, and nothing as analytics", () => {
    // The counter sits outside the consent UI because it is not consent-gated, not because it is
    // hidden: a service under "analytics" would have to be opt-in, and this one measures no person.
    expect(servicesForCategory("analytics")).toEqual([]);
    expect(servicesForCategory("strictly-necessary").map((s) => s.id)).toEqual([
      "cloudflare-web-analytics",
    ]);
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

  it("adds the page counter's two origins from the shipped registry, and nothing else", () => {
    const merged = mergeRegistryCsp(base);
    // The tag is refused without the script host and reports nothing without the connect host, so
    // both are asserted. Every other directive keeps only its base tokens.
    expect(merged["script-src"]).toEqual(["self", "https://static.cloudflareinsights.com"]);
    expect(merged["connect-src"]).toEqual(["self", "https://cloudflareinsights.com"]);
    expect(merged["img-src"]).toEqual(["self", "data:"]);
    const external = Object.values(merged)
      .flat()
      .filter((s) => /^https?:\/\//i.test(s));
    expect([...new Set(external)].sort()).toEqual([
      "https://cloudflareinsights.com",
      "https://static.cloudflareinsights.com",
    ]);
  });

  it("appends a service's origins after the base tokens (mechanism, synthetic registry)", () => {
    const merged = mergeRegistryCsp(base, {
      services: [{ csp: { "script-src": ["https://widget.example"] } }],
    });
    expect(merged["script-src"]).toEqual(["self", "https://widget.example"]);
  });

  it("leaves directives with no registry sources untouched", () => {
    const merged = mergeRegistryCsp(base);
    expect(merged["font-src"]).toEqual(["self"]);
  });

  it("drops a base 'none' when a registry service adds a real source (mechanism, synthetic registry)", () => {
    // A future embed's frame must be able to override a locked-down frame-src: ['none'] default.
    const merged = mergeRegistryCsp(
      { "frame-src": ["none"] },
      { services: [{ csp: { "frame-src": ["https://frame.example"] } }] },
    );
    expect(merged["frame-src"]).toEqual(["https://frame.example"]);
    expect(merged["frame-src"]).not.toContain("none");
  });

  it("keeps a lone 'none' when no service contributes to that directive", () => {
    // frame-src is 'none' in the SHIPPED registry too, now that no challenge iframe exists.
    const merged = mergeRegistryCsp({ "object-src": ["none"], "frame-src": ["none"] });
    expect(merged["object-src"]).toEqual(["none"]);
    expect(merged["frame-src"]).toEqual(["none"]);
  });

  it("does not mutate the base object", () => {
    const snapshot = JSON.parse(JSON.stringify(base));
    mergeRegistryCsp(base);
    expect(base).toEqual(snapshot);
  });
});
