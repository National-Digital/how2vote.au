/**
 * Strict CORS for the research ingestion endpoints, so the native shells (Capacitor iOS/Android)
 * can POST from their local WebView origin (capacitor://localhost / https://localhost).
 *
 * CORS is a browser-enforced policy, not an auth boundary — these endpoints are reachable by any
 * HTTP client regardless, and integrity is enforced server-side by the single-use signed token, the
 * proof-of-work challenge, the aggregate-only store, the no-IP/no-UA/no-log rules and the edge rate
 * limit. The rules here are therefore deliberately narrow:
 *  - reflect an Origin ONLY when it exactly matches one of the two app-shell origins — never `*`,
 *    never arbitrary reflection;
 *  - never with credentials (requests are `credentials: "omit"`, so no
 *    Access-Control-Allow-Credentials is emitted and no cookie can ride along);
 *  - `Vary: Origin` keeps any cache from serving one origin's ACAO to another.
 *
 * The web PWA is same-origin and never triggers CORS; these headers are inert for it.
 */
export const ALLOWED_SHELL_ORIGINS: readonly string[] = [
  "capacitor://localhost",
  "https://localhost",
];

/** The CORS headers for a request, or an empty object when the Origin is not an allowed shell. */
export function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !ALLOWED_SHELL_ORIGINS.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

/** Preflight (OPTIONS) response: 204 with the strict CORS headers (empty for disallowed origins). */
export function preflightResponse(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
}

/** Copy the strict CORS headers onto an existing response (no-op for the web/same-origin case). */
export function withCors(response: Response, request: Request): Response {
  for (const [k, v] of Object.entries(corsHeaders(request.headers.get("Origin")))) {
    response.headers.set(k, v);
  }
  return response;
}
