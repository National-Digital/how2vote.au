/**
 * Pure logic for the printed how-to-vote authorisation — National Digital authoriser model
 * (see docs/adr/0015).
 *
 * Electoral-law review concluded that the safe position is for National Digital, the operator
 * that publishes how2vote, to authorise the fixed plan template and the comparison it contains. The
 * printed how-to-vote plan therefore carries NATIONAL DIGITAL's electoral authorisation, using the
 * operator entity particulars. The voter's preference numbers are separately and clearly identified
 * as the user's own selection. This is a measured position — National Digital authorises the material
 * it publishes — not a settled legal conclusion about who authored the user's chosen order.
 *
 * Consequences:
 *   - the printed stamp no longer contains any user-entered particulars (no name, no locality);
 *   - the print step is an ACKNOWLEDGEMENT, not a form that collects the user's identity;
 *   - printing is currently SUSPENDED by the signed control plane
 *     (data/governance/control-plane.json, `printing` scope) until an electoral-law specialist signs
 *     off the authoriser determination — this logic is correct for when printing is re-enabled.
 *
 * This module is deliberately free of Svelte/DOM so the formatting and validation rules are
 * unit-tested in isolation. The in-memory-only acknowledgement state lives in the runes wrapper
 * `./print-auth.svelte.ts`.
 */
import { AUTHORISATION } from "./org";

/**
 * Hard cap on any free-text that could ever reach the printed output. A defensive bound: the printed
 * stamp is now derived from fixed operator particulars, but any free-text that reaches paper must be
 * length-bounded so it cannot overflow the reserved authorisation area.
 */
export const MAX_PRINT_FIELD_LENGTH = 120;

/**
 * The line that identifies the voter's contribution, shown separately from National Digital's
 * authorisation so the two are never conflated: National Digital authorises the template/analysis,
 * the preference order is the user's own selection.
 */
export const PREFERENCE_SOURCE_NOTICE = "Preference order selected by the user.";

/**
 * True only when a free-text value is safe to print: non-empty, within {@link MAX_PRINT_FIELD_LENGTH}
 * and free of control characters (C0/C1, including newlines and tabs, which can break the reserved
 * stamp area or smuggle layout). Used to reject any free-text before it can reach the printed output.
 */
export function isPrintableText(value: string): boolean {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_PRINT_FIELD_LENGTH) return false;
  // eslint-disable-next-line no-control-regex -- intentionally rejecting control characters
  return !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

/**
 * The on-page authorisation stamp printed on the how-to-vote plan: National Digital's entity
 * authorisation (the operator legal name + locality + State, from the operator record via
 * {@link AUTHORISATION}), followed by the notice that the preference order is the user's own
 * selection. It carries NO user-entered particulars — no name, no street address — because it is
 * National Digital's authorisation of the material it publishes, not the user's.
 */
export function formatAuthorisation(): string {
  return `${AUTHORISATION} ${PREFERENCE_SOURCE_NOTICE}`;
}
