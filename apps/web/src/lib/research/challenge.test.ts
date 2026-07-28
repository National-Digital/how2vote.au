import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { solveChallenge } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/web/pbkdf2";
import type { Challenge } from "altcha-lib/types";
import {
  AllowAllVerifier,
  AltchaVerifier,
  CHALLENGE_KEY_PREFIX,
  CHALLENGE_TTL_SECONDS,
  DenyAllVerifier,
  issueChallenge,
  resolveChallengeVerifier,
} from "./challenge";
import { MemoryNonceStore } from "./nonce-store";

const SECRET = "test-challenge-hmac-secret";

/** Solve a challenge for real (the same code path the browser runs) and encode the payload the
 *  server accepts. Genuine proof-of-work, so allow a generous timeout on these tests. */
async function solved(challenge: Challenge): Promise<string> {
  const solution = await solveChallenge({ challenge, deriveKey });
  if (!solution) throw new Error("test solve timed out");
  return btoa(JSON.stringify({ challenge, solution }));
}

/** Honestly derive the key for a specific counter (nonce ‖ big-endian uint32), regardless of
 *  whether it hits the prefix — used to forge a "did no work" payload. */
async function deriveAt(challenge: Challenge, counter: number): Promise<string> {
  const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((h) => parseInt(h, 16)));
  const nonce = hex(challenge.parameters.nonce);
  const password = new Uint8Array(nonce.length + 4);
  password.set(nonce, 0);
  new DataView(password.buffer).setUint32(nonce.length, counter, false);
  const { derivedKey } = await deriveKey(
    challenge.parameters,
    hex(challenge.parameters.salt),
    password,
  );
  return Array.from(derivedKey, (b) => b.toString(16).padStart(2, "0")).join("");
}

// One real research-purpose solve, shared by every test that needs a valid payload (each test uses
// its own MemoryNonceStore, so reuse across tests never trips the single-use burn).
let researchPayload: string;
beforeAll(async () => {
  researchPayload = await solved(await issueChallenge("research", SECRET));
}, 60_000);

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("resolveChallengeVerifier — self-hosted, fail-closed", () => {
  it("returns an inert pass-through when no challenge secret is set (non-production)", async () => {
    const verifier = resolveChallengeVerifier({}, "research");
    expect(verifier).toBeInstanceOf(AllowAllVerifier);
    expect(verifier.enforced).toBe(false);
    expect(await verifier.verify(null)).toBe(true);
  });

  it("returns the ALTCHA verifier when the secret is set", () => {
    const verifier = resolveChallengeVerifier({ ALTCHA_HMAC_SECRET: SECRET }, "research");
    expect(verifier).toBeInstanceOf(AltchaVerifier);
    expect(verifier.enforced).toBe(true);
  });

  it("FAILS CLOSED in production with no challenge secret (DenyAll, not a pass-through)", async () => {
    const verifier = resolveChallengeVerifier({ RESEARCH_ENVIRONMENT: "production" }, "research");
    expect(verifier).toBeInstanceOf(DenyAllVerifier);
    expect(verifier.enforced).toBe(true);
    expect(await verifier.verify("anything")).toBe(false);
  });

  it("FAILS CLOSED in production without the ATOMIC nonce store (a challenge must be single-use)", () => {
    // Secret present but no D1 store: production must not accept a replayable challenge.
    const production = { RESEARCH_ENVIRONMENT: "production", ALTCHA_HMAC_SECRET: SECRET };
    expect(resolveChallengeVerifier(production, "research")).toBeInstanceOf(DenyAllVerifier);
    // With the atomic store bound it is enforced normally.
    const db = { prepare: () => ({ bind: () => ({}) }) as never, batch: async () => [] };
    expect(
      resolveChallengeVerifier({ ...production, RESEARCH_NONCES_DB: db as never }, "research"),
    ).toBeInstanceOf(AltchaVerifier);
  });

  it("honours an explicit failClosedWhenUnset override", () => {
    expect(resolveChallengeVerifier({}, "research", true)).toBeInstanceOf(DenyAllVerifier);
    expect(
      resolveChallengeVerifier({ RESEARCH_ENVIRONMENT: "production" }, "research", false),
    ).toBeInstanceOf(AllowAllVerifier);
  });
});

describe("AltchaVerifier — issue → solve → verify, in-process", () => {
  it("accepts a genuinely solved challenge, with NO network involved", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const verifier = new AltchaVerifier(SECRET, "research", new MemoryNonceStore());
    expect(await verifier.verify(researchPayload)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("burns the challenge on use: the same solved payload is rejected on replay", async () => {
    const verifier = new AltchaVerifier(SECRET, "research", new MemoryNonceStore());
    expect(await verifier.verify(researchPayload)).toBe(true);
    expect(await verifier.verify(researchPayload)).toBe(false);
  });

  it("rejects a solution issued for a DIFFERENT purpose (purpose is signed and bound)", async () => {
    const contactPayload = await solved(await issueChallenge("contact", SECRET));
    const research = new AltchaVerifier(SECRET, "research", new MemoryNonceStore());
    expect(await research.verify(contactPayload)).toBe(false);
    // …and it is still spendable where it was issued for (the mismatch did not burn it).
    const contact = new AltchaVerifier(SECRET, "contact", new MemoryNonceStore());
    expect(await contact.verify(contactPayload)).toBe(true);
  }, 60_000);

  it("rejects a tampered payload (signature check) without burning anything", async () => {
    const store = new MemoryNonceStore();
    const verifier = new AltchaVerifier(SECRET, "research", store);
    const payload = JSON.parse(atob(researchPayload)) as {
      challenge: Challenge;
      solution: { counter: number; derivedKey: string };
    };
    // Claim a lower cost than was issued: pinned-shape check rejects it outright…
    const cheaper = structuredClone(payload);
    cheaper.challenge.parameters.cost = 1;
    expect(await verifier.verify(btoa(JSON.stringify(cheaper)))).toBe(false);
    // …and a doctored signature fails the HMAC check.
    const forged = structuredClone(payload);
    forged.challenge.signature = forged.challenge.signature!.replace(/^./, (c) =>
      c === "0" ? "1" : "0",
    );
    expect(await verifier.verify(btoa(JSON.stringify(forged)))).toBe(false);
    // Neither attempt burned the genuine payload.
    expect(await verifier.verify(researchPayload)).toBe(true);
  });

  it("REJECTS a no-work solution: valid signature + honest key for a counter that misses the prefix", async () => {
    // The core proof-of-work guard. altcha-lib's verifySolution only checks
    // derivedKey === derive(counter); it does NOT check the prefix. Without the app's own prefix
    // enforcement this payload — one honest derivation at a counter that did NOT solve — would pass
    // having done zero search. Find such a counter (any key not starting with the prefix).
    const challenge = await issueChallenge("research", SECRET);
    let counter = 0;
    let derivedKey = "";
    for (; counter < 1024; counter++) {
      derivedKey = await deriveAt(challenge, counter);
      if (!derivedKey.startsWith(CHALLENGE_KEY_PREFIX)) break;
    }
    expect(derivedKey.startsWith(CHALLENGE_KEY_PREFIX)).toBe(false); // it is genuinely NOT a solution
    const payload = btoa(JSON.stringify({ challenge, solution: { counter, derivedKey, time: 1 } }));
    const verifier = new AltchaVerifier(SECRET, "research", new MemoryNonceStore());
    expect(await verifier.verify(payload)).toBe(false);
  }, 60_000);

  it("rejects a counter outside the big-endian uint32 range", async () => {
    const base = JSON.parse(atob(researchPayload)) as {
      challenge: Challenge;
      solution: { counter: number; derivedKey: string };
    };
    for (const bad of [-1, 0.5, 4294967296, 1e30]) {
      const p = structuredClone(base);
      p.solution.counter = bad;
      const verifier = new AltchaVerifier(SECRET, "research", new MemoryNonceStore());
      expect(await verifier.verify(btoa(JSON.stringify(p)))).toBe(false);
    }
  });

  it("fails closed (false, no throw) when the single-use store errors", async () => {
    const throwingStore = {
      consume: async () => {
        throw new Error("nonce store unavailable");
      },
    };
    const verifier = new AltchaVerifier(SECRET, "research", throwingStore as never);
    expect(await verifier.verify(researchPayload)).toBe(false);
  });

  it("rejects an expired challenge", async () => {
    const verifier = new AltchaVerifier(SECRET, "research", new MemoryNonceStore());
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + (CHALLENGE_TTL_SECONDS + 60) * 1_000);
    expect(await verifier.verify(researchPayload)).toBe(false);
  });

  it("rejects a solution signed with a different secret", async () => {
    const verifier = new AltchaVerifier("some-other-secret", "research", new MemoryNonceStore());
    expect(await verifier.verify(researchPayload)).toBe(false);
  });

  it("rejects garbage without throwing (and without any network)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const verifier = new AltchaVerifier(SECRET, "research", new MemoryNonceStore());
    expect(await verifier.verify(null)).toBe(false);
    expect(await verifier.verify("")).toBe(false);
    expect(await verifier.verify("not-base64!!!")).toBe(false);
    expect(await verifier.verify(btoa("[1,2,3]"))).toBe(false);
    expect(await verifier.verify(btoa(JSON.stringify({ challenge: {}, solution: {} })))).toBe(
      false,
    );
    expect(await verifier.verify("A".repeat(9 * 1024))).toBe(false); // over the size cap
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
