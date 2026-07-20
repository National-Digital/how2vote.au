/**
 * @fileoverview Single source of truth for error-page copy, keyed by HTTP status class.
 *
 * Both the in-app error route (`src/routes/+error.svelte`) and the build-time generator for the
 * static edge error page (`scripts/generate-error-pages.mjs`) import `errorInfo` from here. Because
 * the wording lives in exactly one place — and the static page is regenerated from it on every
 * build — the branded 404, the branded 5xx, and the CDN fallback can never drift apart.
 *
 * Plain ESM JavaScript (not TypeScript) on purpose: the static generator runs under bare Node
 * (`node scripts/*.mjs`, no TS toolchain), while the SvelteKit app imports it happily via allowJs.
 * Types are supplied by the JSDoc typedef below.
 */

/**
 * @typedef {"notfound" | "client" | "server" | "generic"} ErrorKind
 *   The broad family an error belongs to. Drives copy and whether a "Try again" affordance shows.
 */

/**
 * @typedef {object} ErrorInfo
 * @property {string} code    Short status code shown as a kicker (e.g. "404", "503", "Error").
 * @property {string} title   Heading.
 * @property {string} lede    One- or two-sentence explanation in plain language.
 * @property {ErrorKind} kind Family of the error.
 * @property {boolean} canRetry Whether reloading might plausibly help (transient server/generic).
 */

/**
 * Resolve branded copy for an HTTP-ish status. Unknown or missing statuses degrade to a calm
 * generic message; a caller-supplied `message` is only used as a last-resort lede so a raw
 * framework string never leaks past a case we have real wording for.
 *
 * @param {number | undefined | null} status
 * @param {string} [message] Optional fallback lede for the generic/other-client cases.
 * @returns {ErrorInfo}
 */
export function errorInfo(status, message) {
  const code = typeof status === "number" && status > 0 ? String(status) : "Error";

  if (status === 404) {
    return {
      code: "404",
      title: "Page not found",
      lede: "That page doesn't exist — it may have moved, or the link was mistyped.",
      kind: "notfound",
      canRetry: false,
    };
  }

  if (status === 403) {
    return {
      code: "403",
      title: "That page is off-limits",
      lede: "You don't have permission to view this page. If you followed a link here, it may be wrong.",
      kind: "client",
      canRetry: false,
    };
  }

  if (status === 429) {
    return {
      code: "429",
      title: "Too many requests",
      lede: "That's a lot of requests in a short time. Wait a moment, then try again.",
      kind: "client",
      canRetry: true,
    };
  }

  if (status === 503) {
    return {
      code: "503",
      title: "how2vote is briefly unavailable",
      lede: "The site is down for a moment — most likely a short maintenance window. Please try again shortly.",
      kind: "server",
      canRetry: true,
    };
  }

  if (typeof status === "number" && status >= 500 && status <= 599) {
    return {
      code,
      title: "Something went wrong on our end",
      lede: "This one's on us, not you — the page couldn't be served just now. Please try again in a moment.",
      kind: "server",
      canRetry: true,
    };
  }

  if (typeof status === "number" && status >= 400 && status <= 499) {
    return {
      code,
      title: "That request didn't work",
      lede: message || "Something about that request wasn't right. Check the link and try again.",
      kind: "client",
      canRetry: false,
    };
  }

  return {
    code,
    title: "Something went wrong",
    lede: message || "An unexpected error occurred. Please try again.",
    kind: "generic",
    canRetry: true,
  };
}
