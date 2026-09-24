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

/** The actions the web performs for a native screen, by the name the native side sends. */
export const SCREEN_ACTIONS = [
  "saved:remove",
  "saved:clear",
  "contact:send",
  "insights:refresh",
] as const;

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

/**
 * @param value - what the action acts on: a saved card's link, or a contact message's fields
 * @param resync - re-offers the current route, so the screen shows the state the action left
 * @param reply - answers a screen waiting on the outcome: how a contact message's sending went
 * @returns whether the action was one this knows; an unknown one does nothing
 */
export function performScreenAction(
  screen: string,
  action: string,
  value: string | undefined,
  resync: () => void,
  reply: (answer: string) => void = () => undefined,
): boolean {
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
  resync: () => void,
  answer: (request: string, answer: string) => Promise<void>,
): void {
  const { request } = event;
  const reply = (outcome: string): void => {
    if (request) void answer(request, outcome).catch(() => undefined);
  };
  if (!performScreenAction(event.screen, event.action, event.value, resync, reply)) reply("");
}
