import { describe, expect, it } from "vitest";
import { onRequestPost } from "./challenge";
import {
  CHALLENGE_ALGORITHM,
  CHALLENGE_COST,
  CHALLENGE_TTL_SECONDS,
} from "../../src/lib/research/challenge";
import type { ChallengeParameters } from "altcha-lib/types";

const SECRET = "test-challenge-hmac-secret";

async function post(
  body: unknown,
  env: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Response> {
  const request = new Request("https://how2vote.au/api/challenge", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return onRequestPost({ request, env } as never);
}

describe("challenge issue endpoint — one issuer for every purpose and channel", () => {
  it("is inert (204) when no challenge secret is configured", async () => {
    expect((await post({ purpose: "research" }, {})).status).toBe(204);
  });

  it("issues a signed challenge of the pinned shape, purpose-bound, expiring, no-store", async () => {
    const res = await post({ purpose: "research" }, { ALTCHA_HMAC_SECRET: SECRET });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
    const body = (await res.json()) as {
      challenge: { parameters: ChallengeParameters; signature?: string };
    };
    const p = body.challenge.parameters;
    expect(body.challenge.signature).toBeTruthy();
    expect(p.algorithm).toBe(CHALLENGE_ALGORITHM);
    expect(p.cost).toBe(CHALLENGE_COST);
    expect(p.data?.purpose).toBe("research");
    expect(p.nonce).toMatch(/^[0-9a-f]{32}$/);
    const now = Math.floor(Date.now() / 1_000);
    expect(p.expiresAt).toBeGreaterThan(now);
    expect(p.expiresAt).toBeLessThanOrEqual(now + CHALLENGE_TTL_SECONDS + 5);
  });

  it("issues for each declared purpose and refuses (403) anything else", async () => {
    const env = { ALTCHA_HMAC_SECRET: SECRET };
    for (const purpose of ["research", "contact", "feedback"]) {
      expect((await post({ purpose }, env)).status).toBe(200);
    }
    expect((await post({ purpose: "admin" }, env)).status).toBe(403);
    expect((await post({}, env)).status).toBe(403);
    expect((await post("not-json{", env)).status).toBe(403);
  });

  it("refuses an over-large body", async () => {
    const env = { ALTCHA_HMAC_SECRET: SECRET };
    expect(
      (await post({ purpose: "research" }, env, { "content-length": String(8 * 1024) })).status,
    ).toBe(403);
    expect((await post({ purpose: "research", pad: "x".repeat(2 * 1024) }, env)).status).toBe(403);
  });

  it("emits no CORS header (same-origin only; the native shells' allowlist arrives with them)", async () => {
    const res = await post({ purpose: "research" }, { ALTCHA_HMAC_SECRET: SECRET });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
