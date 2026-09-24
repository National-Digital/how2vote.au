/**
 * Handing a route to the native core (ADR 0018 D1/D4a).
 *
 * The web app keeps the flow and the routing on every channel. On iOS, where part of the core is
 * built natively, the LAYOUT reports each navigation here and this module offers the route to the
 * shell; everywhere else — the web, Android, and iOS whenever the native core declines — nothing
 * happens and pages render exactly as they always have.
 *
 * One caller, not one per page. Two callers would race on the same cover: a page asking to be
 * presented while the layout was asking for the previous route to be dismissed can only be resolved
 * by whichever bridge call happens to land second. It also puts the dismissal somewhere: a native
 * screen must come down when the voter reaches a route the native core does not serve, and a page
 * that never renders is not there to notice.
 */
import { browser } from "$app/environment";
import { routePath } from "$lib/native-route-path";
import { afterNavigate } from "$app/navigation";
import { onDestroy, onMount } from "svelte";
import { ageGate } from "$lib/age.svelte";
import { nativeRouterPlugin, storeListingUrl } from "$lib/channel";
import { CURRENT_ELECTION_ID, ELECTIONS, ELECTION_IDS } from "@how2vote/data-schema";
import { STATES } from "$lib/data";
import { isMapAvailable } from "$lib/governance";
import { backupToNative, restoreFromNative } from "$lib/native-storage";
import { performSlotAction } from "$lib/native-slot-actions";
import { election as activeElection, savedElectionId } from "$lib/election.svelte";
import { now } from "$lib/now.svelte";
import { quiz, type Persisted } from "$lib/quiz.svelte";
import { saved } from "$lib/saved.svelte";
import { AUTHORISATION, FEEDBACK_LINK, footerCredit, footerLinks } from "$lib/site-chrome";
import { staleDismissal, staleMessage } from "$lib/stale-notice.svelte";
import { assessStaleness } from "$lib/staleness";
import { theme } from "$lib/theme.svelte";

/**
 * The prerendered documents the native core draws from their projection
 * (`scripts/build-native-documents.mjs`). Each one's hydrated text must equal its prerendered text,
 * which `e2e/native-documents.spec.ts` holds it to; a page whose text depends on the voter's state
 * does not belong here.
 */
export const NATIVE_DOCUMENTS = [
  "accessibility",
  "corrections",
  "glossary",
  "methodology",
  "privacy",
  "research",
  "terms",
] as const;

/**
 * The routes the native core can serve, by path.
 *
 * A list, rather than asking the shell about every route, so a page can tell whether it is even a
 * candidate without a bridge round trip — and so this file is the one place that says what is
 * native, next to the layout's other route-capability sets.
 */
const NATIVE_ROUTES = new Set([
  "/",
  "/ballot",
  "/quiz",
  "/review",
  // The landing renders for a past election too (`/2019`, `/2022`), and the election toggle moves
  // between them. Without these the toggle would drop out of the native surface mid-tap.
  ...ELECTION_IDS.map((id) => `/${id}`),
  ...NATIVE_DOCUMENTS.map((name) => `/${name}`),
]);

/**
 * Documents whose text reports the selected election, so they are prerendered — and projected — for
 * the current one only. They are offered to the native core only while that election is selected;
 * with any other, the WebView renders them.
 */
export const CURRENT_ELECTION_DOCUMENTS = ["about"] as const;

/**
 * The age gate's two states (ADR 0011/0012): the question at `/start`, and the explore-only
 * explainer an under-18 sees after answering, rendered at build time as `states/start`. The native
 * gate draws whichever applies and asks the web to act on each answer (`nativeSlotAction`).
 */
export const AGE_GATE_DOCUMENTS = ["start", "states/start"] as const;

/**
 * Pages of states the build would not otherwise render (ADR 0019 D4b): the native screen they
 * belong to draws the state that applies from them.
 */
export const STATE_DOCUMENTS = ["states/landing"] as const;

/**
 * The landing's own page for an election: `index` for the current one, else the election's id.
 * Drawn with `states/landing`, from which the native landing takes the stage, call to action and
 * theme label that apply.
 */
export function landingDocument(electionId: string): string {
  return electionId === CURRENT_ELECTION_ID ? "index" : electionId;
}

/**
 * The election data sections the native core draws the same way: each section's index and every
 * page under it, for every election (`/2025/issues`, `/next/parties/greens`, …). Every one is held
 * to its hydrated text by the same spec as the documents.
 */
export const NATIVE_DATA_SECTIONS = ["issues", "parties", "electorates", "senate"] as const;

const DOCUMENT_PATHS = new Set<string>(NATIVE_DOCUMENTS.map((name) => `/${name}`));

/** The projected page a path names, or null when it is not one the native core draws. */
function documentName(path: string, electionId: string): string | null {
  if (DOCUMENT_PATHS.has(path)) return path.slice(1);
  // A declared adult is sent on by the page itself; drawing the question first would flash it.
  if (path === "/start" && !ageGate.confirmed) return ageGate.minor ? "states/start" : "start";
  // The current election by the store, once it holds the visitor's choice; before then — a direct
  // load, when the router first asks — by the stored choice it has yet to restore.
  const chosen = activeElection.settled ? electionId : (savedElectionId() ?? electionId);
  if (
    electionId === CURRENT_ELECTION_ID &&
    chosen === CURRENT_ELECTION_ID &&
    (CURRENT_ELECTION_DOCUMENTS as readonly string[]).includes(path.slice(1))
  ) {
    return path.slice(1);
  }
  const [, election, section, ...rest] = path.split("/");
  const isData =
    ELECTION_IDS.includes(election ?? "") &&
    (NATIVE_DATA_SECTIONS as readonly string[]).includes(section ?? "") &&
    rest.length <= 1 &&
    rest.every((segment) => /^[a-z0-9-]+$/.test(segment));
  return isData ? path.slice(1) : null;
}

/**
 * The shell's name for a path.
 *
 * The landing serves several paths — `/` and one per election — and they are one screen, told which
 * election to show through `electionId`. The documents are one screen too, told which page to
 * draw through `document`. Everything else is its path without the slash.
 */
function routeName(path: string, electionId: string): string {
  if (path === "/" || ELECTION_IDS.some((id) => path === `/${id}`)) return "landing";
  if (documentName(path, electionId) !== null) return "document";
  return path.replace(/^\//, "");
}

/** The election a landing path names, read from the path rather than the store it updates. */
function landingElection(path: string): string | undefined {
  if (path === "/") return CURRENT_ELECTION_ID;
  return ELECTION_IDS.find((id) => path === `/${id}`);
}

/**
 * The boundary maps the emergency levers currently allow, as `<election>/<STATE>` ids.
 *
 * Resolved HERE, by the same `isMapAvailable` every other surface uses, and handed to the native
 * core rather than re-evaluated there (ADR 0018 D10a). The control plane is the mechanism that
 * withdraws a map mid-campaign, and a second implementation of it could disagree with the first —
 * the way it would disagree being that iOS kept drawing what every other channel had withdrawn.
 * Nothing is listed unless it is allowed, so a handover that fails leaves every map withheld.
 */
function allowedMapIds(electionId: string): string[] {
  return STATES.map((s) => `${electionId}/${s.code}`).filter(isMapAvailable);
}

/**
 * The layout chrome a native screen covers and must render itself: the footer's links, credit and
 * authorisation, and the stale-data notice when it applies. The shell declines a route without it.
 */
function siteChrome(): string {
  now.start();
  const verdict = assessStaleness(ELECTIONS, now.current);
  const stale =
    verdict.level !== "none" && verdict.dataVersion !== staleDismissal.version
      ? {
          message: staleMessage(verdict),
          dataVersion: verdict.dataVersion,
          prominent: verdict.level === "prominent",
          updateUrl: storeListingUrl(),
        }
      : null;
  return JSON.stringify({
    authorisation: AUTHORISATION,
    credit: footerCredit(__BUILD_YEAR__),
    links: [FEEDBACK_LINK, ...footerLinks(saved.hydrated ? saved.count : 0)],
    stale,
  });
}

/** An under-18 explorer's in-memory quiz, which is never persisted, or undefined for anyone else. */
function explorerSession(electionId: string): string | undefined {
  if (ageGate.confirmed) return undefined;
  const record = quiz.snapshot(electionId);
  return record ? JSON.stringify(record) : undefined;
}

/**
 * The fragment a navigation names, decoded. A malformed escape (`#%E0`) is kept as written rather
 * than thrown: a throw here would read as "no native core" for the rest of the session.
 */
function fragment(url: URL): string {
  const raw = url.hash.slice(1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Who is rendering the current route. */
export type Renderer = "deciding" | "native" | "web";

class NativeRoute {
  /**
   * Starts at "web": on every channel but iOS that is the final answer, and a page must never be
   * left waiting for a handover that is not coming.
   */
  #renderer = $state<Renderer>("web");
  /** Guards against a second handover for a navigation already in flight. */
  #pending: string | null = null;
  /**
   * Set once the shell has proved it is not there.
   *
   * A plugin proxy exists on every native platform whether or not that platform implements it, so
   * "is it there" is answered by calling. Remembering the answer is what keeps Android — which has
   * no native core — from making a bridge call on every navigation that can only fail.
   */
  #absent = false;
  /** Whether a native screen is currently covering the WebView, so a route with none knows whether
   *  there is anything to take down — one bridge call per navigation is cheap, but not free. */
  #covered = false;

  get renderer(): Renderer {
    return this.#renderer;
  }

  /** True while the native core is covering the WebView with this route's screen. */
  get isNative(): boolean {
    return this.#renderer === "native";
  }

  /**
   * True once the page may render and, crucially, may WRITE. A route served natively is one whose
   * state the native core owns (ADR 0018 D3), so a WebView-served page must not persist anything
   * while the answer is outstanding.
   */
  get isWeb(): boolean {
    return this.#renderer === "web";
  }

  /**
   * Reports a navigation. Offers the route to the native core, or takes the cover down.
   *
   * @param path - the pathname just navigated to
   * @param electionId - the election the flow is running for
   */
  async sync(url: URL, electionId: string): Promise<void> {
    const router = nativeRouterPlugin();
    if (!router || this.#absent) {
      this.#renderer = "web";
      return;
    }

    const path = routePath(url);
    const document = documentName(path, electionId);
    if (!NATIVE_ROUTES.has(path) && document === null) {
      this.#renderer = "web";
      this.#pending = null;
      if (this.#covered) {
        this.#covered = false;
        await router.dismiss().catch(() => undefined);
      }
      return;
    }

    // A document opened at a fragment, or the gate in its other state, is a different request.
    const request = `${path}${url.hash}|${document ?? ""}`;
    if (this.#pending === request) return;
    this.#pending = request;
    this.#renderer = "deciding";
    const id = landingElection(path) ?? electionId;

    try {
      // The durable copy is the only thing the native core can read: it holds no localStorage.
      // Backing up first is what makes a voter's in-progress answers visible to the screen about to
      // open.
      await backupToNative();
      const { presented } = await router.present({
        // From the document decided above, not a second reading of the stores after the await.
        route: document !== null ? "document" : routeName(path, electionId),
        electionId: id,
        // From the navigation's own URL, not `location`: a queued sync would otherwise read
        // whatever the address bar happens to hold when it finally runs.
        editing: url.searchParams.has("edit"),
        // The 18+ declaration is the WebView's (ADR 0011) and is deliberately absent from the
        // durable mirror, so it is handed over per session rather than read. `confirmed`, not
        // `canExplore`: an under-18 explorer may take the quiz and may NOT have it persisted, which
        // is exactly the rule the web's own persist() applies.
        eligible: ageGate.confirmed,
        // May enter the quiz: an adult, or an under-18 exploring this session. Distinct from
        // `eligible`, which is the declaration that gates persistence and a printable plan.
        canExplore: ageGate.canExplore,
        allowedMapIds: allowedMapIds(id),
        chrome: siteChrome(),
        theme: theme.pref,
        // An explorer's quiz lives only in memory (ADR 0012), so the native core is handed it.
        session: explorerSession(id),
        ...(document !== null
          ? { document, anchor: fragment(url) }
          : routeName(path, electionId) === "landing"
            ? { document: landingDocument(id) }
            : {}),
      });
      // A later navigation may have overtaken this call; its answer, not this one, is current.
      if (this.#pending !== request) return;
      this.#covered = presented;
      this.#renderer = presented ? "native" : "web";
    } catch {
      // A rejected bridge call must not strand the voter on a page that will not render. It also
      // answers the only question that matters about this platform, so it is not asked again.
      this.#absent = true;
      if (this.#pending === request) this.#renderer = "web";
    }
  }
}

export const nativeRoute = new NativeRoute();

/**
 * Wires the layout to the shell: reports every navigation, and listens for the voter leaving a
 * native screen.
 *
 * Call during component initialisation — `afterNavigate` requires it, and it fires for the initial
 * load too, so there is no separate first sync to make.
 *
 * The native core wrote its answers to the durable store, which this side has not read since the
 * app launched, so restoring and re-reading has to happen BEFORE the router moves — otherwise the
 * next screen renders the state as it was when the native screen opened.
 *
 * @param electionId - a getter, since the active election can change under a long-lived listener
 * @param navigate - how to move the router
 */
export function wireNativeRouter(electionId: () => string, navigate: (path: string) => void): void {
  // Registered unconditionally, and the plugin looked up LATER.
  //
  // Capacitor's bridge defines `window.Capacitor` from a script of its own, and at component
  // initialisation it is not there yet — the app's other plugin accessors never noticed because they
  // are all called from event handlers and effects, long after mount. Looking the router up here
  // found nothing, returned early, and left the native core unreachable for the whole session while
  // every static check passed. The lookup now happens on the first navigation, by which time the
  // bridge exists.
  // Browser only. This module initialises during prerendering too, where the marker means nothing
  // and lands in the build log once per route — 27 lines that look exactly like device output and
  // were, once, read as device output.
  if (browser) console.info("How2Vote: web wiring — init reached");

  // The first route is offered from `onMount`, NOT from the navigation hook.
  //
  // `afterNavigate` is documented as firing for the initial load, and on the web it does. In the
  // shell the app is a prerendered bundle loaded straight from `capacitor://localhost`, and the
  // callback registered here was never reached — so the plugin was never looked up and the native
  // core sat unreachable for the whole session. `onMount` runs once, after the document is up and
  // after the bridge has defined `window.Capacitor`, which is the only thing the deferred lookup
  // actually needed. Should the navigation hook fire for the initial load as well, `sync` sees the
  // path already in flight and returns.
  onMount(() => {
    console.info("How2Vote: web wiring — mount reached");
    offer(new URL(window.location.href), electionId, navigate);
  });

  afterNavigate(({ to }) => {
    console.info(
      `How2Vote: web wiring — navigation reached, to=${to ? routePath(to.url) : "none"}`,
    );
    if (!to) return;
    offer(to.url, electionId, navigate);
  });

  // Registered HERE, at initialisation, which is the only place Svelte allows it — `attach` runs
  // from a navigation and would throw. It tears down whatever that attachment later created.
  onDestroy(() => {
    for (const teardown of teardowns.splice(0)) teardown();
  });
}

/**
 * Tells the native core the theme this side now holds. For a change the native side did not ask
 * for — the restore at launch, which can bring back a theme WebKit's storage had lost.
 */
export function syncNativeTheme(): void {
  void nativeRouterPlugin()
    ?.themeChanged({ theme: theme.pref })
    .catch(() => undefined);
}

/** Teardowns for whatever `attach` registered, released by the layout's own destruction. */
const teardowns: Array<() => void> = [];

/** Attaches the listeners if the shell is there, then offers the route to it. */
function offer(url: URL, electionId: () => string, navigate: (path: string) => void): void {
  attach(navigate, electionId);
  void nativeRoute.sync(url, electionId());
}

/** Listeners are attached once, the first time the shell is actually there to attach them to. */
let attached = false;

function attach(navigate: (path: string) => void, electionId: () => string): void {
  if (attached) return;
  const router = nativeRouterPlugin();

  // Reported either way, and with what the bridge is offering. A marker that only fires on success
  // makes its own absence ambiguous — "not found" and "never ran" look identical — which is the
  // mistake this diagnostic exists to stop. Capacitor forwards the WebView's console to the native
  // log, so it lands beside the shell's own markers.
  const bridge = (
    globalThis as {
      Capacitor?: {
        registerPlugin?: unknown;
        Plugins?: Record<string, unknown>;
        PluginHeaders?: { name: string }[];
      };
    }
  ).Capacitor;
  console.info(
    `How2Vote: web wiring — native router ${router ? "found" : "missing"}; ` +
      `bridge=${bridge ? "yes" : "no"} registerPlugin=${typeof bridge?.registerPlugin} ` +
      `plugins=[${Object.keys(bridge?.Plugins ?? {}).join(",")}] ` +
      `headers=[${(bridge?.PluginHeaders ?? []).map((h) => h.name).join(",")}]`,
  );

  if (!router) return;
  attached = true;

  const exit = router.addListener("nativeRouteExit", ({ route, session, electionId }) => {
    if (session && electionId) {
      try {
        if (quiz.adopt(electionId, JSON.parse(session) as Persisted)) {
          navigate(route);
          return;
        }
      } catch {
        // An unreadable record falls through to the durable copy rather than stranding the voter.
      }
      // As does one for an election this side has not loaded.
    }
    void restoreFromNative().then(() => {
      quiz.rehydrate();
      navigate(route);
    });
  });

  const staleDismiss = router.addListener("nativeStaleDismiss", ({ dataVersion }) => {
    staleDismissal.remember(dataVersion);
    void backupToNative();
  });

  // A native screen asks; this side writes. The theme preference is the WebView's key (ADR 0018 D3),
  // so the durable write stays here and the answer is reported back — the native screen updates from
  // what was actually written, not from what it assumed it would be.
  const themeChange = router.addListener("nativeThemeRequest", () => {
    theme.toggle();
    void router.themeChanged({ theme: theme.pref }).catch(() => undefined);
    // Keeps the durable mirror in step immediately, rather than at the next visibility change: the
    // native side re-reads it on launch, and a preference that survived only in memory would be
    // gone the next time the app started.
    void backupToNative();
  });

  // A native control was pressed. The native side draws a slot's buttons from the page and, but for
  // the landing's (ADR 0019 D4c), never acts on them itself; this side does what the web page's own
  // control does.
  const slotAction = router.addListener("nativeSlotAction", ({ slot, action }) => {
    performSlotAction(
      slot,
      action,
      navigate,
      () => void nativeRoute.sync(new URL(window.location.href), electionId()),
    );
  });

  teardowns.push(() => {
    void Promise.resolve(slotAction).then((r) => r.remove());
    void Promise.resolve(exit).then((r) => r.remove());
    void Promise.resolve(themeChange).then((r) => r.remove());
    void Promise.resolve(staleDismiss).then((r) => r.remove());
  });
}
