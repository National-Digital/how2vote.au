import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./sha256";

/** The authoritative signer (Node crypto) — the sync implementation must never drift from it. */
const nodeSha = (s: string): string => createHash("sha256").update(s).digest("hex");

describe("sha256Hex (synchronous, dependency-free)", () => {
  it("matches known FIPS-180 vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("agrees with Node crypto across lengths, multibyte, and block boundaries", () => {
    const samples = [
      "a",
      "The quick brown fox jumps over the lazy dog",
      "élection · proposition — ⚖️ suspended",
      "x".repeat(55), // one byte under a padding boundary
      "y".repeat(56), // exactly on the boundary (forces an extra block)
      "z".repeat(64), // one full block
      "w".repeat(1000),
      JSON.stringify({ schemaVersion: 1, suspensions: [] }),
    ];
    for (const s of samples) expect(sha256Hex(s)).toBe(nodeSha(s));
  });
});
