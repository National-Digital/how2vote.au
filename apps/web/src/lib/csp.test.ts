import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import config from "../../svelte.config.js";

/**
 * CSP drift-guard. Pins only the security-critical invariants of the Content-Security-Policy so it
 * can never silently regress, while deliberately staying tolerant of *additions* (e.g. a future
 * connect-src/img-src/form-action for analytics or a form provider) — those extend the policy
 * without weakening it.
 */

const csp = config.kit?.csp;
const directives = csp?.directives ?? {};

const headers = readFileSync(
  fileURLToPath(new URL("../../static/_headers", import.meta.url)),
  "utf8",
);

describe("Content-Security-Policy (svelte.config.js)", () => {
  it("uses hash mode (no nonce/unsafe fallback)", () => {
    expect(csp?.mode).toBe("hash");
  });

  it("locks script-src to self with no unsafe-* escape hatches", () => {
    const scriptSrc = directives["script-src"] ?? [];
    expect(scriptSrc).toContain("self");
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("unsafe-eval");
  });

  it("keeps default-src self and forbids object/base-uri", () => {
    expect(directives["default-src"]).toContain("self");
    expect(directives["object-src"]).toEqual(["none"]);
    expect(directives["base-uri"]).toEqual(["none"]);
  });
});

describe("security headers (static/_headers)", () => {
  it("sets frame-ancestors 'none' (anti-clickjacking)", () => {
    expect(headers).toContain("frame-ancestors 'none'");
  });

  it("sets HSTS and nosniff", () => {
    expect(headers).toMatch(/Strict-Transport-Security:\s*max-age=\d+/);
    expect(headers).toContain("X-Content-Type-Options: nosniff");
  });
});
