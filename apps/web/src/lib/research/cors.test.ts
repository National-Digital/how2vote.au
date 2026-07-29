import { describe, expect, it } from "vitest";
import { ALLOWED_SHELL_ORIGINS, corsHeaders, preflightResponse, withCors } from "./cors";

const req = (origin: string | null): Request =>
  new Request("https://how2vote.au/api/research", {
    method: "OPTIONS",
    headers: origin ? { Origin: origin } : {},
  });

describe("research CORS (strict shell allowlist)", () => {
  it("allows exactly the two app-shell origins, echoed (never '*')", () => {
    for (const origin of ALLOWED_SHELL_ORIGINS) {
      const h = corsHeaders(origin);
      expect(h["Access-Control-Allow-Origin"]).toBe(origin);
      expect(h["Access-Control-Allow-Origin"]).not.toBe("*");
      expect(h["Access-Control-Allow-Methods"]).toContain("POST");
      expect(h["Vary"]).toBe("Origin");
    }
  });

  it("NEVER emits Allow-Credentials (requests are credentials: omit)", () => {
    for (const origin of ALLOWED_SHELL_ORIGINS) {
      expect(corsHeaders(origin)).not.toHaveProperty("Access-Control-Allow-Credentials");
    }
  });

  it("returns no CORS headers for any other origin or a missing origin", () => {
    expect(corsHeaders("https://evil.example")).toEqual({});
    expect(corsHeaders("https://how2vote.au")).toEqual({}); // web is same-origin, needs no CORS
    expect(corsHeaders("http://localhost")).toEqual({}); // scheme must match exactly
    expect(corsHeaders(null)).toEqual({});
  });

  it("preflight is a 204 carrying the allowlist headers (empty for disallowed)", () => {
    const ok = preflightResponse(req("capacitor://localhost"));
    expect(ok.status).toBe(204);
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe("capacitor://localhost");
    const denied = preflightResponse(req("https://evil.example"));
    expect(denied.status).toBe(204);
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("withCors adds the header to an allowed origin's response and leaves others untouched", () => {
    const allowed = withCors(new Response(null, { status: 204 }), req("https://localhost"));
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("https://localhost");
    const other = withCors(new Response(null, { status: 204 }), req("https://evil.example"));
    expect(other.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
