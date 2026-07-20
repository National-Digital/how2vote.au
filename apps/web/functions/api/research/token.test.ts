import { afterEach, describe, expect, it, vi } from "vitest";

// Pin an explicitly un-suspended control plane so these token-issue-logic tests are independent of
// the live kill-switch state (research intake is currently live after the 2026-07-19 sign-off; a
// future re-suspension must not turn these logic tests red). The fail-closed closed-intake behaviour
// is asserted in src/lib/research/registry.test.ts.
vi.mock("../../../../../data/governance/control-plane.json", () => ({
  default: {
    schemaVersion: 1,
    suspensions: [],
    integrity: "sha256-284295c891854ce87d99ec3e98e66f48d542cba2008375a321497ac11d21b8ce",
  },
}));
import { onRequestPost } from "./token";
import { verifyToken } from "../../../src/lib/research/token";
import { RESEARCH_CONSENT_VERSION } from "../../../src/lib/research/consent";

const SECRET = "test-token-secret";

const validBody = () => ({
  schemaVersion: 1,
  electionId: "2025",
  consentVersion: RESEARCH_CONSENT_VERSION,
  challenge: null,
});

async function post(body: unknown, env: Record<string, unknown>): Promise<Response> {
  const request = new Request("https://how2vote.au/api/research/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return onRequestPost({ request, env } as never);
}

afterEach(() => vi.restoreAllMocks());

describe("token issue endpoint — server-enforced consent gate", () => {
  it("is inert (204, no tokens) when no signing secret is configured", async () => {
    const res = await post(validBody(), {});
    expect(res.status).toBe(204);
  });

  it("issues two purpose-scoped, verifiable tokens when configured", async () => {
    const res = await post(validBody(), { RESEARCH_TOKEN_SECRET: SECRET });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tokens: { research: string; geography: string } };
    const r = await verifyToken(body.tokens.research, SECRET, {
      electionId: "2025",
      schemaVersion: 1,
      purpose: "research",
      consentVersion: RESEARCH_CONSENT_VERSION,
    });
    const g = await verifyToken(body.tokens.geography, SECRET, {
      electionId: "2025",
      schemaVersion: 1,
      purpose: "geography",
    });
    expect(r.ok).toBe(true);
    expect(g.ok).toBe(true);
    // Independent nonces keep the two requests unlinkable.
    if (r.ok && g.ok) expect(r.claims.nonce).not.toBe(g.claims.nonce);
  });

  it("sets a no-store cache header and never a cookie", async () => {
    const res = await post(validBody(), { RESEARCH_TOKEN_SECRET: SECRET });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("refuses (403) an unknown election, wrong schema, or unaccepted consent version", async () => {
    const env = { RESEARCH_TOKEN_SECRET: SECRET };
    expect((await post({ ...validBody(), electionId: "1901" }, env)).status).toBe(403);
    expect((await post({ ...validBody(), schemaVersion: 4 }, env)).status).toBe(403);
    expect((await post({ ...validBody(), consentVersion: "2099-01" }, env)).status).toBe(403);
    expect((await post({ ...validBody(), consentVersion: "2026-07" }, env)).status).toBe(403); // stale
  });

  it("refuses (403) a malformed body or an over-large body", async () => {
    const env = { RESEARCH_TOKEN_SECRET: SECRET };
    expect((await post("not-an-object", env)).status).toBe(403);
    const request = new Request("https://how2vote.au/api/research/token", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(8 * 1024) },
      body: JSON.stringify(validBody()),
    });
    expect((await onRequestPost({ request, env } as never)).status).toBe(403);
  });

  it("enforces the challenge when a provider secret is configured", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: false }), { status: 200 }),
    );
    const env = { RESEARCH_TOKEN_SECRET: SECRET, TURNSTILE_RESEARCH_SECRET: "cf" };
    // No/failed challenge solution → refused.
    expect((await post({ ...validBody(), challenge: "bad" }, env)).status).toBe(403);
  });

  it("issues tokens once the challenge passes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    const env = { RESEARCH_TOKEN_SECRET: SECRET, TURNSTILE_RESEARCH_SECRET: "cf" };
    expect((await post({ ...validBody(), challenge: "good" }, env)).status).toBe(200);
  });

  it("FAILS CLOSED in production when no Turnstile secret is configured (no AllowAll fallback)", async () => {
    // In production the challenge must be enforced: with no provider secret the resolver denies, so no
    // token is minted (403) rather than passing through. Non-production keeps the inert pass-through.
    const env = { RESEARCH_TOKEN_SECRET: SECRET, RESEARCH_ENVIRONMENT: "production" };
    expect((await post({ ...validBody(), challenge: null }, env)).status).toBe(403);
  });
});
