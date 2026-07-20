/**
 * Cloudflare Turnstile bridge.
 *
 * Turnstile is the cookieless, first-party-to-Cloudflare replacement for Google reCAPTCHA v3. Each
 * widget is rendered in its non-interactive / invisible mode (the widget type is chosen in the
 * Cloudflare dashboard — Non-Interactive or Invisible, never Managed), so it presents no puzzle for
 * the user to solve and imposes no accessibility barrier. On submit we run the challenge on demand
 * (`turnstile.execute`) to obtain a short-lived token.
 *
 * TWO independent widgets, each with its own site key + secret, so the research/survey
 * challenge shares no configuration or per-widget analytics with the contact/feedback
 * forms:
 *   - the FORMS widget (`PUBLIC_TURNSTILE_SITE_KEY`) — token sent to Formspree as
 *     `cf-turnstile-response`; Formspree verifies it server-side with the matching secret.
 *   - the RESEARCH widget (`PUBLIC_TURNSTILE_RESEARCH_SITE_KEY`) — token sent to
 *     `/api/research/token` as the `challenge`; the Pages Function verifies it server-side against
 *     `TURNSTILE_RESEARCH_SECRET` (a SEPARATE Cloudflare secret from the Formspree one).
 * Both site keys are public (they ship in the client) and come from `$env/dynamic/public`; an unset
 * key makes that widget's `configured` false and its `token()` resolve to undefined, so the build
 * posts without a token rather than breaking (Formspree only enforces when enabled on the form; the
 * research endpoint's verifier is inert unless its secret is set).
 *
 * Loaded LAZILY — api.js is injected only the first time any token is requested (i.e. when someone
 * actually submits), never on page load. So Cloudflare's challenge endpoint is not contacted just for
 * browsing the site, no cookie is set (Turnstile is cookieless regardless), and nothing competes with
 * hydration on the LCP path. This is why the service is declared "strictly necessary" in the
 * third-party registry: it runs only on submission, as anti-spam / anti-abuse protection.
 *
 * Offline PWA note: api.js is cross-origin, so the service worker (same-origin only) never touches
 * it and it is never precached. Callers short-circuit to "offline" before a token is requested, so a
 * missing connection never reaches this module.
 */
import { browser } from "$app/environment";
import { env } from "$env/dynamic/public";

interface TurnstileRenderParams {
  sitekey: string;
  action?: string;
  size?: "normal" | "flexible" | "compact" | "invisible";
  appearance?: "always" | "execute" | "interaction-only";
  execution?: "render" | "execute";
  callback?: (token: string) => void;
  "error-callback"?: () => void;
  "expired-callback"?: () => void;
}

interface Turnstile {
  ready(cb: () => void): void;
  render(container: HTMLElement, params: TurnstileRenderParams): string;
  execute(widgetId: string, opts?: { action?: string }): void;
  reset(widgetId: string): void;
}

interface TurnstileWindow extends Window {
  turnstile?: Turnstile;
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * Inject api.js exactly once, regardless of how many widgets exist, and resolve with the global
 * `turnstile` object (or undefined if it never appears). A failed load nulls the cache so the next
 * submit retries rather than caching the rejection forever.
 */
let apiPromise: Promise<Turnstile | undefined> | null = null;
function loadApi(): Promise<Turnstile | undefined> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<Turnstile | undefined>((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = SCRIPT_SRC;
    script.onload = () => {
      const turnstile = (window as TurnstileWindow).turnstile;
      if (!turnstile) {
        resolve(undefined);
        return;
      }
      turnstile.ready(() => resolve(turnstile));
    };
    script.onerror = () => {
      apiPromise = null;
      reject(new Error("Failed to load Turnstile"));
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}

/** One invisible, execute-on-demand Turnstile widget bound to a single site key. */
export interface TurnstileInstance {
  /** Whether this widget is wired for this build (its site key is present). */
  readonly configured: boolean;
  /**
   * Obtain a token for a named action, rendering the invisible widget on first use. Returns
   * undefined when not configured or not in the browser (so the caller can post without a token);
   * rejects only if the challenge is online-but-unreachable/failed.
   */
  token(action: string): Promise<string | undefined>;
}

function createTurnstile(siteKey: string | undefined): TurnstileInstance {
  /** Resolves once this widget has been rendered and is ready to execute. */
  let widgetReady: Promise<string | undefined> | null = null;
  /** This widget's one outstanding token request; its resolver is the render success callback. */
  let pending: { resolve: (token: string) => void; reject: (reason: Error) => void } | null = null;

  function settleError(reason: Error): void {
    const p = pending;
    pending = null;
    p?.reject(reason);
  }

  function ensureWidget(): Promise<string | undefined> {
    if (widgetReady) return widgetReady;
    widgetReady = loadApi()
      .then((turnstile) => {
        if (!turnstile) return undefined;
        const container = document.createElement("div");
        // Off-screen, not display:none — an invisible widget must remain layout-attached to run.
        container.style.position = "absolute";
        container.style.width = "0";
        container.style.height = "0";
        container.style.overflow = "hidden";
        document.body.appendChild(container);
        return turnstile.render(container, {
          sitekey: siteKey as string,
          size: "invisible",
          execution: "execute",
          appearance: "interaction-only",
          callback: (token: string) => {
            const p = pending;
            pending = null;
            p?.resolve(token);
          },
          "error-callback": () => settleError(new Error("Turnstile challenge failed")),
          "expired-callback": () => settleError(new Error("Turnstile token expired")),
        });
      })
      .catch((err: unknown) => {
        // Let the next submit retry a failed load/render rather than caching the rejection forever.
        widgetReady = null;
        throw err instanceof Error ? err : new Error("Turnstile render failed");
      });
    return widgetReady;
  }

  return {
    configured: Boolean(siteKey),
    async token(action: string): Promise<string | undefined> {
      if (!browser || !siteKey) return undefined;
      const widgetId = await ensureWidget();
      const turnstile = (window as TurnstileWindow).turnstile;
      if (!turnstile || widgetId === undefined) return undefined;
      return new Promise<string>((resolve, reject) => {
        pending = { resolve, reject };
        // Clear any prior (single-use) token so execute yields a fresh one, then run the challenge.
        turnstile.reset(widgetId);
        turnstile.execute(widgetId, { action });
      });
    },
  };
}

/** The Formspree forms widget (feedback + contact). */
const forms = createTurnstile(env.PUBLIC_TURNSTILE_SITE_KEY);
/** Whether the Formspree Turnstile widget is wired for this build (site key present). */
export const turnstileConfigured = forms.configured;
/** Obtain a Formspree Turnstile token for a named action (e.g. "feedback", "contact"). */
export const turnstileToken = (action: string): Promise<string | undefined> => forms.token(action);

/** The research/survey widget — a SEPARATE Cloudflare Turnstile widget/secret from the forms one. */
const research = createTurnstile(env.PUBLIC_TURNSTILE_RESEARCH_SITE_KEY);
/** Whether the research Turnstile widget is wired for this build (research site key present). */
export const researchTurnstileConfigured = research.configured;
/** Obtain a research Turnstile token (the `challenge` sent to `/api/research/token`). */
export const researchTurnstileToken = (action: string): Promise<string | undefined> =>
  research.token(action);
