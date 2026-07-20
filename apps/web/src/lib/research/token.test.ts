import { describe, expect, it } from "vitest";
import { newNonce, signToken, verifyToken, type TokenClaims } from "./token";

const SECRET = "test-signing-secret-not-real";

function claims(overrides: Partial<TokenClaims> = {}): TokenClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    electionId: "2025",
    schemaVersion: 1,
    consentVersion: "2026-07.2",
    purpose: "research",
    nonce: newNonce(),
    issuedAt: now,
    expiresAt: now + 300,
    ...overrides,
  };
}

const expect2025 = {
  electionId: "2025",
  schemaVersion: 1,
  purpose: "research" as const,
  consentVersion: "2026-07.2",
};

describe("signToken / verifyToken — signed submission token", () => {
  it("round-trips a valid token and returns the claims", async () => {
    const c = claims();
    const token = await signToken(c, SECRET);
    const result = await verifyToken(token, SECRET, expect2025);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.nonce).toBe(c.nonce);
      expect(result.claims.purpose).toBe("research");
    }
  });

  it("rejects a forged/tampered signature", async () => {
    const token = await signToken(claims(), SECRET);
    const forged = token.slice(0, -2) + (token.endsWith("aa") ? "bb" : "aa");
    expect(await verifyToken(forged, SECRET, expect2025)).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signToken(claims(), "some-other-secret");
    expect(await verifyToken(token, SECRET, expect2025)).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("rejects a tampered PAYLOAD (claims changed, signature stale)", async () => {
    const token = await signToken(claims({ electionId: "2019" }), SECRET);
    // Re-encode the payload to say 2025 but keep the 2019 signature.
    const [, sig] = token.split(".");
    const evilPayload = Buffer.from(JSON.stringify(claims({ electionId: "2025" }))).toString(
      "base64url",
    );
    expect(await verifyToken(`${evilPayload}.${sig}`, SECRET, expect2025)).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("rejects an EXPIRED token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken(claims({ issuedAt: now - 600, expiresAt: now - 300 }), SECRET);
    expect(await verifyToken(token, SECRET, expect2025)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a NOT-YET-VALID token (issued in the future beyond skew)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken(claims({ issuedAt: now + 3600, expiresAt: now + 4000 }), SECRET);
    expect(await verifyToken(token, SECRET, expect2025)).toEqual({
      ok: false,
      reason: "not-yet-valid",
    });
  });

  it("rejects a token bound to a DIFFERENT election / schema / consent / purpose", async () => {
    const token = await signToken(claims(), SECRET);
    expect((await verifyToken(token, SECRET, { ...expect2025, electionId: "2019" })).ok).toBe(
      false,
    );
    expect(await verifyToken(token, SECRET, { ...expect2025, electionId: "2019" })).toEqual({
      ok: false,
      reason: "election-mismatch",
    });
    expect(await verifyToken(token, SECRET, { ...expect2025, schemaVersion: 4 })).toEqual({
      ok: false,
      reason: "schema-mismatch",
    });
    expect(await verifyToken(token, SECRET, { ...expect2025, consentVersion: "2099-01" })).toEqual({
      ok: false,
      reason: "consent-mismatch",
    });
    expect(await verifyToken(token, SECRET, { ...expect2025, purpose: "geography" })).toEqual({
      ok: false,
      reason: "purpose-mismatch",
    });
  });

  it("ignores the consent binding when the verifier does not require it (geography)", async () => {
    const token = await signToken(claims({ purpose: "geography" }), SECRET);
    const result = await verifyToken(token, SECRET, {
      electionId: "2025",
      schemaVersion: 1,
      purpose: "geography",
    });
    expect(result.ok).toBe(true);
  });

  it("FUZZ: rejects malformed/garbage tokens without throwing", async () => {
    const garbage = [
      "",
      ".",
      "..",
      "onlyonepart",
      "a.b.c",
      "!!!.$$$",
      "x".repeat(5000),
      Buffer.from("{not json").toString("base64url") + ".sig",
    ];
    for (const g of garbage) {
      const result = await verifyToken(g, SECRET, expect2025);
      expect(result.ok, `token ${JSON.stringify(g.slice(0, 20))}`).toBe(false);
    }
    // Non-string inputs too.
    for (const g of [null, undefined, 42, {}, []]) {
      expect((await verifyToken(g, SECRET, expect2025)).ok).toBe(false);
    }
  });

  it("rejects any token when no secret is configured on the verifier", async () => {
    const token = await signToken(claims(), SECRET);
    expect(await verifyToken(token, "", expect2025)).toEqual({ ok: false, reason: "malformed" });
  });

  it("nonces are unique per issuance", () => {
    const seen = new Set(Array.from({ length: 1000 }, () => newNonce()));
    expect(seen.size).toBe(1000);
  });
});
