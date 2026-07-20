/**
 * Formspree submission helper, shared by the per-page Feedback widget and the Contact page. Both
 * post to Formspree's AJAX endpoint (https://formspree.io/f/<id>) with an `Accept: application/json`
 * header so the browser stays on the page and we can show an inline success / error / offline state
 * instead of following Formspree's redirect.
 *
 * The two form IDs come from separate PUBLIC_ env vars (see .env.example) so feedback and contact can
 * be split onto different Formspree forms later; today they resolve to the same ID. They are read via
 * SvelteKit's `$env/dynamic/public`: for the static adapter the values are captured at build time and
 * inlined, and an unset var is simply `undefined` (no build failure) so the form renders as
 * "not configured" rather than breaking the page.
 *
 * The site is an offline-first PWA. When there is no connection a POST cannot reach Formspree, so we
 * detect that up front (`navigator.onLine`) and return an "offline" result the UI explains, rather
 * than letting the request hang or surfacing a raw network error.
 *
 * Both forms are protected by Cloudflare Turnstile (see $lib/turnstile): before each POST we run the
 * cookieless, non-interactive challenge — passing a per-form action name — and send its token to
 * Formspree as `cf-turnstile-response` for server-side verification. Turnstile loads lazily on that
 * first token request, so it never runs for someone merely browsing. A failed token fetch is treated
 * like any other submit error.
 */
import { env } from "$env/dynamic/public";
import { turnstileToken } from "./turnstile";

export type SubmitResult = "ok" | "offline" | "error";

const FEEDBACK_FORM_ID = env.PUBLIC_FEEDBACK_FORM_ID;
const CONTACT_FORM_ID = env.PUBLIC_CONTACT_FORM_ID;

/** Whether each form is wired; a page can use this to hide the form when no ID is configured. */
export const feedbackConfigured = Boolean(FEEDBACK_FORM_ID);
export const contactConfigured = Boolean(CONTACT_FORM_ID);

/** Drops empty/undefined fields so optional inputs aren't posted as blank strings. */
function compact(fields: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    const trimmed = v?.trim();
    if (trimmed) out[k] = trimmed;
  }
  return out;
}

async function post(
  formId: string | undefined,
  action: string,
  fields: Record<string, string | undefined>,
): Promise<SubmitResult> {
  if (!formId) return "error";
  // Primary offline signal for a PWA: don't even attempt the request when the browser knows it's
  // offline (e.g. opening a shared card at a polling place with no signal).
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  try {
    // Cloudflare Turnstile token; undefined when no site key is configured (posts without it). A
    // load/execute failure throws here and is handled as a generic submit error below.
    const token = await turnstileToken(action);
    const body = { ...compact(fields), ...(token ? { "cf-turnstile-response": token } : {}) };
    const res = await fetch(`https://formspree.io/f/${formId}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok ? "ok" : "error";
  } catch {
    // Network failure while nominally online (dropped connection, DNS, blocked request), or a
    // Turnstile token that could not be obtained.
    return "error";
  }
}

export function submitFeedback(fields: {
  message: string;
  name?: string;
  email?: string;
  page?: string;
}): Promise<SubmitResult> {
  return post(FEEDBACK_FORM_ID, "feedback", { ...fields, _subject: "how2vote feedback" });
}

export function submitContact(fields: {
  name: string;
  email: string;
  message: string;
}): Promise<SubmitResult> {
  return post(CONTACT_FORM_ID, "contact", { ...fields, _subject: "how2vote contact" });
}
