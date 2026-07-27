/**
 * Pure logic for the user-authored voting plan (docs/adr/0006). The plan is an ORDER the voter
 * builds themselves from a blank ballot — How2Vote never pre-fills, ranks or suggests it. The order
 * is the single source of truth: a candidate's preference is its 1-based index in the array, so the
 * numbering is always contiguous 1..k with no duplicates and no gaps *by construction*. Candidates
 * not in the array are simply unranked ("missing"), which the mechanical check reports.
 *
 * Kept free of Svelte/DOM so the reducer is unit-tested in isolation. Candidate identity is an
 * opaque string key supplied by the caller (candidate name + ballot position), stable across
 * re-renders.
 */

export type Order = readonly string[];

/** 1-based preference of a candidate, or 0 when it is not yet ranked. */
export function prefOf(order: Order, id: string): number {
  return order.indexOf(id) + 1;
}

/**
 * Place `id` at 1-based rank `n` (removing any existing placement first), clamped to [1, size].
 * This is the direct number-entry path: typing "2" moves the candidate to second preference and
 * shifts the others down — never creating a duplicate.
 */
export function setRank(order: Order, id: string, n: number, size: number): string[] {
  const without = order.filter((x) => x !== id);
  if (!Number.isFinite(n)) return without; // empty / cleared → unrank
  const pos = Math.max(1, Math.min(Math.trunc(n), size)) - 1;
  without.splice(Math.min(pos, without.length), 0, id);
  return without;
}

/** Remove `id` from the order (clear its preference). */
export function unrank(order: Order, id: string): string[] {
  return order.filter((x) => x !== id);
}

/** Move `id` one step higher in preference (towards 1). An unranked candidate joins at the end. */
export function moveUp(order: Order, id: string): string[] {
  const arr = order.includes(id) ? [...order] : [...order, id];
  const i = arr.indexOf(id);
  if (i > 0) [arr[i - 1], arr[i]] = [arr[i]!, arr[i - 1]!];
  return arr;
}

/** Move `id` one step lower in preference (towards the bottom). An unranked candidate joins last. */
export function moveDown(order: Order, id: string): string[] {
  const arr = order.includes(id) ? [...order] : [...order, id];
  const i = arr.indexOf(id);
  if (i >= 0 && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i]!, arr[i + 1]!];
  return arr;
}

export type PlanStatus = {
  ranked: number;
  total: number;
  /** Candidate ids not yet given a preference, in the caller's ballot order. */
  unranked: string[];
  /** True when every candidate on the ballot has been given a preference. */
  complete: boolean;
};

/**
 * Mechanical status only — how many candidates are numbered and which are not. This is a convenience
 * prompt, NEVER a determination that the resulting ballot will be formal.
 * Duplicate/gap numbering cannot arise from the order model, so only "missing" is reported.
 */
export function planStatus(order: Order, ids: readonly string[]): PlanStatus {
  const inBallot = new Set(ids);
  const ranked = order.filter((id) => inBallot.has(id));
  const unranked = ids.filter((id) => !order.includes(id));
  return {
    ranked: ranked.length,
    total: ids.length,
    unranked,
    complete: unranked.length === 0,
  };
}
