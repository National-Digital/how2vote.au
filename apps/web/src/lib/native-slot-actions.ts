/**
 * What a native control does when pressed: exactly what the web page's own control does, through
 * the same functions (ADR 0019 D4). The native screen draws a projected slot's buttons from the
 * page and sends the action each one names; it never acts on them itself.
 *
 * Keyed by the action the page names on each button (`value`), never by a button's position, so a
 * page that reorders its answers cannot swap what they do.
 */
import { continueExploring, declareAdult, declareMinor } from "$lib/age-gate-actions";
import { clearLocalDeviceData } from "$lib/privacy/local-data";

/**
 * @param resync - re-offers the current route, for an action that changes which state it shows
 * @returns whether the action was one this knows; an unknown one does nothing
 */
export function performSlotAction(
  slot: string,
  action: string,
  navigate: (path: string) => void,
  resync: () => void,
): boolean {
  switch (`${slot}:${action}`) {
    case "clear-data:clear":
      // The same routine and the same clean reload the web control uses, which also clears the
      // durable copy the native core reads.
      void clearLocalDeviceData().then(() => window.location.assign("/"));
      return true;
    case "age-declare:adult":
      declareAdult(navigate);
      return true;
    case "age-declare:minor":
      declareMinor();
      resync();
      return true;
    case "age-continue:continue":
      continueExploring(navigate);
      return true;
    default:
      return false;
  }
}
