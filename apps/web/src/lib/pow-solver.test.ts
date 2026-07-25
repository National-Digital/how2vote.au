import { describe, expect, it } from "vitest";
import { createChallenge, verifySolution } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/web/pbkdf2";
import type { Challenge } from "altcha-lib/types";
import { solvePow, type PowChallenge } from "./pow-solver";
import { AltchaVerifier, issueChallenge } from "./research/challenge";
import { MemoryNonceStore } from "./research/nonce-store";

const SECRET = "test-challenge-hmac-secret";

describe("in-page solver ↔ altcha-lib server verification interop", () => {
  it("solves a lib-issued challenge that the lib's verifySolution then verifies", async () => {
    // Cheap cost so this interop pin is fast; the protocol (nonce ‖ uint32-BE counter, prefix
    // match) is identical at any cost.
    const challenge = await createChallenge({
      algorithm: "PBKDF2/SHA-256",
      cost: 10,
      deriveKey,
      expiresAt: new Date(Date.now() + 60_000),
      hmacSignatureSecret: SECRET,
    });
    const solution = await solvePow(challenge as PowChallenge);
    expect(solution).not.toBeNull();
    const result = await verifySolution({
      challenge: challenge as Challenge,
      solution: solution!,
      deriveKey,
      hmacSignatureSecret: SECRET,
    });
    expect(result.verified).toBe(true);
  });

  it("solves a real production-shape challenge that AltchaVerifier accepts end-to-end", async () => {
    // Full-cost pin: exactly what the browser does against exactly what the server checks.
    const challenge = await issueChallenge("research", SECRET);
    const solution = await solvePow(challenge as PowChallenge);
    expect(solution).not.toBeNull();
    const payload = btoa(JSON.stringify({ challenge, solution }));
    const verifier = new AltchaVerifier(SECRET, "research", new MemoryNonceStore());
    expect(await verifier.verify(payload)).toBe(true);
  }, 60_000);

  it("resolves null on timeout instead of hanging", async () => {
    const challenge = await createChallenge({
      algorithm: "PBKDF2/SHA-256",
      cost: 50_000,
      keyPrefix: "0000000000000000", // effectively unsolvable in the window
      deriveKey,
      hmacSignatureSecret: SECRET,
    });
    expect(await solvePow(challenge as PowChallenge, 250)).toBeNull();
  });

  it("rejects a malformed challenge in microseconds instead of spinning the timeout", async () => {
    const base = { algorithm: "PBKDF2/SHA-256", cost: 10, keyLength: 32, keyPrefix: "00" };
    const bad = [
      { nonce: "abc", salt: "00", ...base }, // odd-length nonce
      { nonce: "", salt: "", ...base, keyPrefix: "0000" }, // empty hex
      { nonce: "zz", salt: "00", ...base }, // non-hex
      { nonce: "00", salt: "00", ...base, keyPrefix: "00".repeat(33) }, // prefix longer than the key
    ];
    for (const parameters of bad) {
      const started = performance.now();
      // A long timeout would be burned entirely without the shape guard; assert it returns fast.
      expect(await solvePow({ parameters } as PowChallenge, 30_000)).toBeNull();
      expect(performance.now() - started).toBeLessThan(1_000);
    }
  });
});
