import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { solveChallenge } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/web/pbkdf2";
import { onRequestPost } from "./forms";
import { issueChallenge } from "../../src/lib/research/challenge";

const CHALLENGE_SECRET = "test-challenge-hmac-secret";

/** A fully provisioned production-like env (challenge + relay), minus what a test overrides. */
const RELAY_ENV = {
  ALTCHA_HMAC_SECRET: CHALLENGE_SECRET,
  EMAIL_API_TOKEN: "cf-api-token",
  EMAIL_ACCOUNT_ID: "acct-123",
  FORMS_FROM_ADDRESS: "forms@how2vote.au",
  FORMS_DELIVERY_ADDRESS: "inbox@example.org",
};

// One real, solved payload per form purpose (genuine proof-of-work — minted once for the file;
// without a nonce-store binding in the test env nothing burns them between tests).
let contactChallenge: string;
let feedbackChallenge: string;
beforeAll(async () => {
  for (const purpose of ["contact", "feedback"] as const) {
    const challenge = await issueChallenge(purpose, CHALLENGE_SECRET);
    const solution = await solveChallenge({ challenge, deriveKey });
    const payload = btoa(JSON.stringify({ challenge, solution }));
    if (purpose === "contact") contactChallenge = payload;
    else feedbackChallenge = payload;
  }
}, 120_000);

const validContact = () => ({
  kind: "contact",
  name: "A Voter",
  email: "voter@example.net",
  message: "Hello there",
  challenge: contactChallenge,
});

async function post(
  body: unknown,
  env: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Response> {
  const request = new Request("https://how2vote.au/api/forms", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return onRequestPost({ request, env } as never);
}

afterEach(() => vi.restoreAllMocks());

describe("forms endpoint — self-hosted intake, challenge-gated, relay-only", () => {
  it("rejects (400) a malformed body, unknown kind, or missing/oversized fields", async () => {
    expect((await post("not-json{", RELAY_ENV)).status).toBe(400);
    expect((await post({ ...validContact(), kind: "newsletter" }, RELAY_ENV)).status).toBe(400);
    expect((await post({ ...validContact(), message: "" }, RELAY_ENV)).status).toBe(400);
    expect((await post({ ...validContact(), message: 42 }, RELAY_ENV)).status).toBe(400);
    expect((await post({ ...validContact(), message: "x".repeat(6_000) }, RELAY_ENV)).status).toBe(
      400,
    );
    expect(
      (await post(validContact(), RELAY_ENV, { "content-length": String(32 * 1024) })).status,
    ).toBe(400);
  });

  it("enforces the challenge, purpose-bound per form kind", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    // Missing / garbage challenge → refused.
    expect((await post({ ...validContact(), challenge: null }, RELAY_ENV)).status).toBe(403);
    expect((await post({ ...validContact(), challenge: "bad" }, RELAY_ENV)).status).toBe(403);
    // A FEEDBACK-purpose solution cannot be spent on the CONTACT form.
    expect(
      (await post({ ...validContact(), challenge: feedbackChallenge }, RELAY_ENV)).status,
    ).toBe(403);
    // No relay call is ever made for a refused submission.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("relays a verified message to the inbox via api.cloudflare.com and stores nothing", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const res = await post(validContact(), RELAY_ENV);
    expect(res.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acct-123/email/sending/send");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer cf-api-token");
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent.to).toEqual(["inbox@example.org"]);
    expect(sent.from).toEqual({ address: "forms@how2vote.au", name: "how2vote.au forms" });
    expect(sent.reply_to).toBe("voter@example.net"); // header-safe sender address becomes Reply-To
    expect(sent.subject).toBe("how2vote contact");
    expect(sent.text).toContain("Hello there");
  });

  it("relays feedback with its own purpose and no Reply-To when no email was left", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const res = await post(
      { kind: "feedback", message: "Nice tool", page: "/ballot", challenge: feedbackChallenge },
      RELAY_ENV,
    );
    expect(res.status).toBe(204);
    const sent = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as Record<string, unknown>;
    expect(sent.reply_to).toBeUndefined();
    expect(sent.subject).toBe("how2vote feedback");
    expect(sent.text).toContain("/ballot");
  });

  it("never lets a crafted email address near the mail headers", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const crafted = "a@b.c\r\nBcc: everyone@example.org";
    // The crafted value fails JSON-field validation only if oversized; it IS relayed, but only in
    // the body text — the Reply-To pattern rejects anything with whitespace/CRLF.
    const res = await post({ ...validContact(), email: crafted }, RELAY_ENV);
    expect(res.status).toBe(204);
    const sent = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as Record<string, unknown>;
    expect(sent.reply_to).toBeUndefined();
  });

  it("surfaces a relay failure as 502 (never a silent drop)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    expect((await post(validContact(), RELAY_ENV)).status).toBe(502);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    expect((await post(validContact(), RELAY_ENV)).status).toBe(502);
  });

  it("accepts inertly (204, nothing sent) when the relay is unprovisioned in NON-production", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const res = await post({ ...validContact(), challenge: null }, {});
    expect(res.status).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("NEVER relays when the challenge verifier is not enforced, even with the relay provisioned", async () => {
    // Non-production with the EMAIL_* relay secrets set but NO challenge secret → AllowAll verifier
    // (verify(null) === true). Without the enforced-gate this would send unauthenticated mail from a
    // public preview URL. It must inert-accept (204) and send nothing.
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const relayButNoChallenge = {
      EMAIL_API_TOKEN: "cf-api-token",
      EMAIL_ACCOUNT_ID: "acct-123",
      FORMS_FROM_ADDRESS: "forms@send.how2vote.au",
      FORMS_DELIVERY_ADDRESS: "inbox@example.org",
    };
    const res = await post(
      { kind: "contact", message: "unauthenticated", challenge: null },
      relayButNoChallenge,
    );
    expect(res.status).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED (503) in production when the challenge or relay is unprovisioned", async () => {
    const production = { RESEARCH_ENVIRONMENT: "production" };
    expect((await post(validContact(), production)).status).toBe(503);
    // Challenge provisioned but no atomic store / no relay → still 503.
    expect(
      (await post(validContact(), { ...production, ALTCHA_HMAC_SECRET: CHALLENGE_SECRET })).status,
    ).toBe(503);
    expect(
      (
        await post(validContact(), {
          ...RELAY_ENV,
          ...production,
          EMAIL_API_TOKEN: undefined,
        })
      ).status,
    ).toBe(503);
  });
});
