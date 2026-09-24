/**
 * What a native screen asks of the web when the state it acts on is the web's (ADR 0018 D3): the
 * same store call the web page's own control makes. The native screen draws the control and never
 * writes the state itself; after the action, the route is offered again, so the screen is redrawn
 * from what the web now holds.
 *
 * Keyed by `<screen>:<action>`, as `ScreenAction` in `NativeRouterPlugin.swift` names them.
 */
import { saved } from "$lib/saved.svelte";

/** The actions the web performs for a native screen, by the name the native side sends. */
export const SCREEN_ACTIONS = ["saved:remove", "saved:clear"] as const;

/**
 * @param value - what the action acts on, where it acts on one thing: a saved card's link
 * @param resync - re-offers the current route, so the screen shows the state the action left
 * @returns whether the action was one this knows; an unknown one does nothing
 */
export function performScreenAction(
  screen: string,
  action: string,
  value: string | undefined,
  resync: () => void,
): boolean {
  switch (`${screen}:${action}`) {
    case "saved:remove":
      if (!value || !saved.has(value)) return false;
      saved.remove(value);
      resync();
      return true;
    case "saved:clear":
      saved.clear();
      resync();
      return true;
    default:
      return false;
  }
}
