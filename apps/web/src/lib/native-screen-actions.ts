/**
 * What a native screen asks of the web when the state it acts on is the web's (ADR 0018 D3): the
 * same store call the web page's own control makes. The native screen draws the control and never
 * writes the state itself; after the action, the route is offered again, so the screen is redrawn
 * from what the web now holds.
 *
 * Keyed by `<screen>:<action>`, as `ScreenAction` in `NativeRouterPlugin.swift` names them.
 */
import { submitContact } from "$lib/forms";
import { saved } from "$lib/saved.svelte";
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
 *   checkbox's state, or the answer chosen
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
