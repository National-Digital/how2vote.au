import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AllowAllVerifier,
  DenyAllVerifier,
  TurnstileVerifier,
  resolveChallengeVerifier,
} from "./challenge";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveChallengeVerifier — provider-neutral, swappable", () => {
  it("returns an inert pass-through when no provider secret is set", async () => {
    const verifier = resolveChallengeVerifier({});
    expect(verifier).toBeInstanceOf(AllowAllVerifier);
    expect(verifier.enforced).toBe(false);
    expect(await verifier.verify(null)).toBe(true);
  });

  it("returns a Turnstile verifier when the secret is set", () => {
    const verifier = resolveChallengeVerifier({ TURNSTILE_RESEARCH_SECRET: "s" });
    expect(verifier).toBeInstanceOf(TurnstileVerifier);
    expect(verifier.enforced).toBe(true);
  });

  it("FAILS CLOSED in production with no provider secret (DenyAll, not a pass-through)", async () => {
    // A bound RESEARCH_DB (or an explicit production marker) means a real deployment: it must not mint
    // tokens without a challenge, so the resolver denies rather than passing through.
    const verifier = resolveChallengeVerifier({ RESEARCH_ENVIRONMENT: "production" });
    expect(verifier).toBeInstanceOf(DenyAllVerifier);
    expect(verifier.enforced).toBe(true);
    expect(await verifier.verify("anything")).toBe(false);
  });

  it("honours an explicit failClosedWhenUnset override", () => {
    expect(resolveChallengeVerifier({}, true)).toBeInstanceOf(DenyAllVerifier);
    expect(resolveChallengeVerifier({ RESEARCH_ENVIRONMENT: "production" }, false)).toBeInstanceOf(
      AllowAllVerifier,
    );
  });
});

describe("TurnstileVerifier", () => {
  it("rejects an empty solution without calling the network", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const verifier = new TurnstileVerifier("secret");
    expect(await verifier.verify(null)).toBe(false);
    expect(await verifier.verify("")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes when siteverify reports success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    expect(await new TurnstileVerifier("secret").verify("token")).toBe(true);
  });

  it("fails when siteverify reports failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: false }), { status: 200 }),
    );
    expect(await new TurnstileVerifier("secret").verify("token")).toBe(false);
  });

  it("fails closed when the verifier is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    expect(await new TurnstileVerifier("secret").verify("token")).toBe(false);
  });

  it("does NOT send the visitor IP to the provider (no remoteip)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    await new TurnstileVerifier("secret").verify("token");
    const body = fetchMock.mock.calls[0][1]?.body as URLSearchParams;
    expect(body.toString()).not.toContain("remoteip");
  });
});
