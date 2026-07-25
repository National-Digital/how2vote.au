/**
 * Minimal in-page ALTCHA v2 proof-of-work solver.
 *
 * The full altcha-lib client entry re-exports the server half too (createChallenge,
 * verifySolution, Sentinel verification …), which the browser never needs — bundling it blew the
 * gzipped JS budget. This module implements ONLY the solve loop of the documented v2 protocol —
 * password = nonce bytes ‖ big-endian uint32 counter, derive, compare against the required key
 * prefix — on top of altcha-lib's own WebCrypto PBKDF2 derivation, so the cryptography is not
 * ours and interop with the lib's server-side verifySolution is pinned by pow-solver.test.ts.
 *
 * Pure and $app-free so it is unit-testable; the browser-facing wrapper (./altcha) lazy-imports it
 * on first use. Yields to the event loop while it works, so the UI stays responsive.
 */
import { deriveKey } from "altcha-lib/algorithms/web/pbkdf2";

/** The signed challenge shape `POST /api/challenge` returns (altcha-lib's Challenge). */
export interface PowChallenge {
  parameters: {
    algorithm: string;
    nonce: string;
    salt: string;
    cost: number;
    keyLength: number;
    keyPrefix: string;
    expiresAt?: number;
    data?: Record<string, string | number | boolean | null>;
  };
  signature?: string;
}

/** The solution altcha-lib's verifySolution accepts. */
export interface PowSolution {
  counter: number;
  derivedKey: string;
  time: number;
}

function hexToBuffer(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bufferToHex(buf: Uint8Array): string {
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function startsWith(buf: Uint8Array, prefix: Uint8Array): boolean {
  for (let i = 0; i < prefix.length; i++) if (buf[i] !== prefix[i]) return false;
  return true;
}

/**
 * Brute-force the counter until the derived key carries the required prefix. Resolves null on
 * timeout (the caller treats that as a submit error rather than hanging forever).
 */
export async function solvePow(
  challenge: PowChallenge,
  timeoutMs = 30_000,
): Promise<PowSolution | null> {
  const { nonce, salt, keyPrefix } = challenge.parameters;
  const nonceBuf = hexToBuffer(nonce);
  const saltBuf = hexToBuffer(salt);
  // An even-length prefix compares as bytes; an odd-length one falls back to hex-string compare
  // (same rule as altcha-lib's solver). Our issuer always uses an even-length prefix.
  const prefixBuf = keyPrefix.length % 2 === 0 ? hexToBuffer(keyPrefix) : null;
  const password = new Uint8Array(nonceBuf.length + 4);
  password.set(nonceBuf, 0);
  const view = new DataView(password.buffer);

  const start = performance.now();
  let lastYield = start;
  for (let counter = 0; ; counter++) {
    if (counter % 10 === 0) {
      const now = performance.now();
      if (now - start > timeoutMs) return null;
      if (now - lastYield > 200) {
        // Yield so a long unlucky search never blocks rendering or input.
        await new Promise((resolve) => setTimeout(resolve, 0));
        lastYield = performance.now();
      }
    }
    view.setUint32(nonceBuf.length, counter, false); // big-endian, per the v2 protocol
    const { derivedKey } = await deriveKey(challenge.parameters, saltBuf, password);
    if (
      prefixBuf ? startsWith(derivedKey, prefixBuf) : bufferToHex(derivedKey).startsWith(keyPrefix)
    ) {
      return {
        counter,
        derivedKey: bufferToHex(derivedKey),
        time: Math.round(performance.now() - start),
      };
    }
  }
}
