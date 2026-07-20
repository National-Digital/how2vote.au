import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CSP_DIRECTIVES,
  deriveBrowserHosts,
  deriveCsp,
  deriveInfrastructureHosts,
  deriveNetworkAllowlist,
  deriveProviders,
  hostFromSource,
  renderJson,
} from "./generate-vendor-allowlist.mjs";

const REGISTRY = JSON.parse(
  readFileSync(
    new URL("../apps/web/src/lib/privacy/third-party-services.json", import.meta.url),
    "utf8",
  ),
);
const COMMITTED = readFileSync(
  new URL("../apps/web/src/lib/privacy/vendor-allowlist.generated.json", import.meta.url),
  "utf8",
);

describe("hostFromSource", () => {
  it("extracts the authority and preserves wildcards", () => {
    expect(hostFromSource("https://challenges.cloudflare.com/turnstile/")).toBe(
      "challenges.cloudflare.com",
    );
    expect(hostFromSource("https://*.cloudflare.com")).toBe("*.cloudflare.com");
  });

  it("returns null for keyword tokens and non-strings", () => {
    expect(hostFromSource("self")).toBeNull();
    expect(hostFromSource("data:")).toBeNull();
    expect(hostFromSource(null)).toBeNull();
  });
});

describe("derivation is a pure function of the registry", () => {
  it("projects each CSP directive from the registry services", () => {
    const csp = deriveCsp(REGISTRY);
    expect(Object.keys(csp).sort()).toEqual([...CSP_DIRECTIVES].sort());
    expect(csp["connect-src"]).toContain("formspree.io");
    expect(csp["script-src"]).toContain("challenges.cloudflare.com");
  });

  it("returns sorted, de-duplicated host lists", () => {
    const hosts = deriveBrowserHosts(REGISTRY);
    expect(hosts).toEqual([...new Set(hosts)]);
    expect(hosts).toEqual(
      [...hosts].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })),
    );
  });

  it("includes infrastructure egress hosts in the network allowlist but not the browser hosts", () => {
    expect(deriveInfrastructureHosts(REGISTRY)).toContain("theyvoteforyou.org.au");
    expect(deriveBrowserHosts(REGISTRY)).not.toContain("theyvoteforyou.org.au");
    expect(deriveNetworkAllowlist(REGISTRY)).toContain("theyvoteforyou.org.au");
    expect(deriveNetworkAllowlist(REGISTRY)).toContain("formspree.io");
  });

  it("lists every vendor (browser + infrastructure) in the provider table", () => {
    const ids = deriveProviders(REGISTRY).map((p) => p.id);
    expect(ids).toContain("cloudflare");
    expect(ids).toContain("github");
    expect(ids).toContain("tvfy");
    expect(ids).toContain("formspree");
  });
});

describe("drift gate", () => {
  it("the committed generated file matches what the registry produces", () => {
    expect(renderJson(REGISTRY)).toBe(COMMITTED);
  });

  it("detects a hand-edit to the registry (would fail --check)", () => {
    const tampered = JSON.parse(JSON.stringify(REGISTRY));
    tampered.infrastructure.push({ id: "evil", egressHosts: ["evil.example.com"] });
    expect(renderJson(tampered)).not.toBe(COMMITTED);
    expect(deriveNetworkAllowlist(tampered)).toContain("evil.example.com");
  });
});
