/**
 * What a native screen asks of the web when the state it acts on is the web's (ADR 0018 D3): the
 * same store call the web page's own control makes. The native screen draws the control and never
 * writes the state itself; after the action, the route is offered again, so the screen is redrawn
 * from what the web now holds.
 *
 * Keyed by `<screen>:<action>`, as `ScreenAction` in `NativeRouterPlugin.swift` names them.
 */
import type * as CardFlowModule from "$lib/card-flow.svelte";
import type { PlanBallot } from "$lib/card-flow.svelte";
import { submitContact } from "$lib/forms";
import { saved } from "$lib/saved.svelte";
import { shareUrl } from "$lib/seo";
import { GATE, survey } from "$lib/survey-flow.svelte";

/** The actions the web performs for a native screen, by the name the native side sends. */
export const SCREEN_ACTIONS = [
  "saved:remove",
  "saved:clear",
  "contact:send",
  "insights:refresh",
  "survey:consent",
  "survey:sensitive",
  "survey:terms",
  "survey:contribute",
  "survey:choose",
  "survey:back",
  "card:build",
  "card:compare",
  "card:share",
  "card:share-confirm",
  "card:share-cancel",
  "card:terms-tick",
  "card:terms-accept",
  "card:terms-cancel",
  "card:save",
  "card:why",
  "card:fresh",
  "card:senate",
  "card:rank",
  "card:up",
  "card:down",
] as const;

/** What an action may do beyond the state it changes. */
export type ScreenActionContext = {
  /** Re-offers the current route, so the screen shows the state the action left. */
  resync: () => void;
  /** Moves the router, as the page's own control would. */
  navigate: (path: string) => void;
  /** Answers a screen waiting on the outcome: how a contact message's sending went. */
  reply?: (answer: string) => void;
};

/** A contact message as the native form hands it over: the page's three fields. */
function contactFields(value: string | undefined): {
  name: string;
  email: string;
  message: string;
} | null {
  try {
    const fields = JSON.parse(value ?? "") as Record<string, unknown>;
    const { name, email, message } = fields;
    const filled = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
    return filled(name) && filled(email) && filled(message) ? { name, email, message } : null;
  } catch {
    return null;
  }
}

/** An answer as the app sends it: the question it answers, and the answer, empty for none. */
function answered(value: string | undefined): { key: string; answer: string } | null {
  try {
    const { key, answer } = JSON.parse(value ?? "") as Record<string, unknown>;
    return typeof key === "string" && typeof answer === "string" ? { key, answer } : null;
  } catch {
    return null;
  }
}

/** The card's flow, once a card has been opened; it loads with the card, not with every page. */
let cardModule: typeof CardFlowModule | null = null;

/** Loads the card's flow, as the card is opened. A card action before then is no action. */
export async function loadCardFlow(): Promise<typeof CardFlowModule.cardFlow> {
  cardModule ??= await import("$lib/card-flow.svelte");
  return cardModule.cardFlow;
}

/** A plan row as the app names it: its ballot, its id, and for a number typed, the number. */
function planRow(
  cardFlow: NonNullable<typeof cardModule>["cardFlow"],
  value: string | undefined,
): { ballot: PlanBallot; id: string; n: number } | null {
  try {
    const { ballot, id, n } = JSON.parse(value ?? "") as Record<string, unknown>;
    if (ballot !== "house" && ballot !== "above" && ballot !== "below") return null;
    if (typeof id !== "string") return null;
    const ids =
      ballot === "house"
        ? cardFlow.houseIds
        : ballot === "above"
          ? cardFlow.senateAboveIds
          : cardFlow.senateBelowIds;
    if (!ids.includes(id)) return null;
    // A number the box accepts, or none to clear it, as an emptied box does.
    const number = n === null || n === undefined ? NaN : n;
    if (typeof number !== "number" || (!Number.isNaN(number) && !Number.isInteger(number))) {
      return null;
    }
    return { ballot, id, n: number };
  } catch {
    return null;
  }
}

/**
 * The card's actions, each the one its page control takes, and only on the stage that control is on:
 * a request from a screen the card has since moved on from is no request at all.
 */
function cardAction(
  name: string,
  value: string | undefined,
  { resync, navigate, reply }: Required<ScreenActionContext>,
): boolean {
  const card = cardModule?.cardFlow;
  if (!card || card.status !== "ready" || !card.data) return false;
  const compare = card.stage === "compare";
  const gate = card.pendingAction !== null;
  switch (name) {
    case "card:terms-tick": {
      const on = ticked(value);
      if (on === null || !gate) return false;
      card.tickTerms(on);
      break;
    }
    case "card:terms-accept":
      if (!card.acceptTerms()) return false;
      break;
    case "card:terms-cancel":
      if (!gate) return false;
      card.cancelTerms();
      break;
    case "card:build":
      if (!compare) return false;
      card.requestBuild();
      break;
    case "card:share":
      if (!compare) return false;
      card.requestShare();
      break;
    case "card:share-confirm": {
      // The link leaves the device only once its warning is confirmed; the app shares what this
      // answers, the canonical https link, and nothing if the warning was not showing.
      if (!compare || !card.confirmShare()) return false;
      const at = card.cardUrl.indexOf("#");
      reply(shareUrl(card.cardUrl.slice(0, at), card.cardUrl.slice(at)));
      break;
    }
    case "card:share-cancel":
      if (!compare || !card.showShareWarning) return false;
      card.cancelShare();
      break;
    case "card:save":
      if (!compare) return false;
      card.toggleSave();
      break;
    case "card:why":
      if (!compare) return false;
      card.showWhy = !card.showWhy;
      break;
    case "card:fresh":
      if (!compare || !card.data.shared) return false;
      card.startFresh(navigate);
      return true;
    case "card:compare":
      if (compare) return false;
      card.backToCompare();
      break;
    case "card:senate":
      if (compare || (value !== "above" && value !== "below")) return false;
      card.senateView = value;
      break;
    case "card:rank":
    case "card:up":
    case "card:down": {
      const row = planRow(card, value);
      if (compare || !row) return false;
      if (name === "card:rank") card.setRank(row.ballot, row.id, row.n);
      else if (name === "card:up") card.moveUp(row.ballot, row.id);
      else card.moveDown(row.ballot, row.id);
      break;
    }
    default:
      return false;
  }
  resync();
  return true;
}

/** A checkbox's state as a native control sends it. */
const ticked = (value: string | undefined): boolean | null =>
  value === "1" ? true : value === "0" ? false : null;

/**
 * Takes a survey step, then shows it — unless the step left the survey, when the route it moved to
 * is the one offered. Offering the survey again as it leaves could put it back over the page it
 * left for.
 */
function stepOrLeave(
  step: (navigate: (path: string) => void) => void,
  navigate: (path: string) => void,
  resync: () => void,
): void {
  let left = false;
  step((path) => {
    left = true;
    navigate(path);
  });
  if (!left) resync();
}

/**
 * @param value - what the action acts on: a saved card's link, a contact message's fields, a
 *   checkbox's state, the answer chosen, or a plan row
 * @returns whether the action was one this knows; an unknown one does nothing
 */
export function performScreenAction(
  screen: string,
  action: string,
  value: string | undefined,
  { resync, navigate, reply = () => undefined }: ScreenActionContext,
): boolean {
  // A survey that has left for another page takes no more steps from the screen it left.
  if (screen === "survey" && survey.left) return false;
  if (screen === "card")
    return cardAction(`${screen}:${action}`, value, { resync, navigate, reply });
  switch (`${screen}:${action}`) {
    case "contact:send": {
      // The same submission the page's form makes, anti-spam check included; its outcome is the
      // page's own: sent, offline or failed.
      const fields = contactFields(value);
      if (!fields) return false;
      void submitContact(fields).then(reply);
      return true;
    }
    case "saved:remove":
      if (!value || !saved.has(value)) return false;
      saved.remove(value);
      resync();
      return true;
    case "saved:clear":
      saved.clear();
      resync();
      return true;
    case "insights:refresh":
      // The election-day close has ended on the screen's clock: offered again, the route carries
      // the figures the page would now read.
      resync();
      return true;
    // The survey's steps, each the one its page control takes. Only the gate's ticks are set here;
    // whether they allow a contribution is the survey's own rule.
    case "survey:consent":
    case "survey:sensitive":
    case "survey:terms": {
      const on = ticked(value);
      if (on === null || survey.step !== -1) return false;
      if (action === "consent") survey.consented = on;
      else if (action === "sensitive") survey.sensitiveConsented = on;
      else survey.termsChecked = on;
      resync();
      return true;
    }
    case "survey:contribute":
      if (survey.step !== -1) return false;
      survey.contribute();
      resync();
      return true;
    case "survey:choose": {
      // One of the shown question's own answers, or none for "prefer not to say" — to the question
      // the app drew, never to whichever the survey has moved on to since.
      const current = survey.current;
      const chosen = answered(value);
      if (
        !current ||
        !chosen ||
        chosen.key !== current.key ||
        (chosen.answer !== "" && !current.options.includes(chosen.answer))
      ) {
        return false;
      }
      stepOrLeave((go) => survey.choose(current.key, chosen.answer, go), navigate, resync);
      return true;
    }
    case "survey:back":
      // Back from the step the app drew: the gate, or the question it names.
      if (value !== (survey.current?.key ?? GATE)) return false;
      stepOrLeave((go) => survey.back(go), navigate, resync);
      return true;
    default:
      return false;
  }
}

/**
 * Answers a native screen's request: performs it, and — where the screen waits on the outcome —
 * always replies, so a request this does not know is answered empty, which the screen reads as a
 * failure rather than waiting on.
 *
 * @param answer - replies to the request the screen is waiting on
 */
export function handleScreenAction(
  event: { screen: string; action: string; value?: string; request?: string },
  context: Omit<ScreenActionContext, "reply">,
  answer: (request: string, answer: string) => Promise<void>,
): void {
  const { request } = event;
  const reply = (outcome: string): void => {
    if (request) void answer(request, outcome).catch(() => undefined);
  };
  if (!performScreenAction(event.screen, event.action, event.value, { ...context, reply })) {
    reply("");
  }
}
