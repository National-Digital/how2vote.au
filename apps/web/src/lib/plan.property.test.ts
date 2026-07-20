import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { moveDown, moveUp, planStatus, prefOf, setRank, unrank, type Order } from "./plan";

/**
 * Property-based encoding of methodology invariant 2 — no candidate can occupy two preference
 * positions in a voting plan. The plan order is the single source of truth: a candidate's preference
 * is its 1-based index, so any sequence of edits must keep the order a duplicate-free, contiguous
 * 1..k numbering. Where plan.test.ts pins single worked edits, this drives arbitrary edit sequences
 * over an arbitrary ballot and asserts the invariant survives every one.
 */

// A pool of distinct candidate ids (candidate name + ballot position, in production — opaque here).
const idsArb = fc.uniqueArray(fc.string({ minLength: 1, maxLength: 5 }), {
  minLength: 1,
  maxLength: 8,
});

// One edit against a candidate drawn from the ballot. setRank's `n` spans in-range, out-of-range
// (to exercise the clamp) and NaN (the cleared-input / unrank path).
const opArbFor = (ids: readonly string[]) =>
  fc.oneof(
    fc.record({
      kind: fc.constant("setRank" as const),
      id: fc.constantFrom(...ids),
      n: fc.oneof(fc.integer({ min: -5, max: ids.length + 5 }), fc.constant(Number.NaN)),
    }),
    fc.record({ kind: fc.constant("unrank" as const), id: fc.constantFrom(...ids) }),
    fc.record({ kind: fc.constant("moveUp" as const), id: fc.constantFrom(...ids) }),
    fc.record({ kind: fc.constant("moveDown" as const), id: fc.constantFrom(...ids) }),
  );

type Op =
  | { kind: "setRank"; id: string; n: number }
  | { kind: "unrank" | "moveUp" | "moveDown"; id: string };

const scenarioArb = idsArb.chain((ids) =>
  fc.record({ ids: fc.constant(ids), ops: fc.array(opArbFor(ids), { maxLength: 40 }) }),
);

function applyOp(order: Order, op: Op, size: number): string[] {
  switch (op.kind) {
    case "setRank":
      return setRank(order, op.id, op.n, size);
    case "unrank":
      return unrank(order, op.id);
    case "moveUp":
      return moveUp(order, op.id);
    case "moveDown":
      return moveDown(order, op.id);
  }
}

// The invariant, asserted after every single edit — a candidate never occupies two positions.
function assertNoDuplicatePreference(order: Order, ids: readonly string[]): void {
  const ballot = new Set(ids);
  // No candidate appears twice → no candidate holds two preference numbers.
  expect(new Set(order).size).toBe(order.length);
  // Every ranked entry is a real candidate on this ballot, and never more than the whole ballot.
  expect(order.every((id) => ballot.has(id))).toBe(true);
  expect(order.length).toBeLessThanOrEqual(ids.length);
  // Preferences are exactly the contiguous run 1..k with no gaps and no duplicates.
  const prefs = order.map((id) => prefOf(order, id)).sort((a, b) => a - b);
  expect(prefs).toEqual(Array.from({ length: order.length }, (_, i) => i + 1));
  // planStatus partitions the ballot cleanly: ranked + unranked accounts for every candidate once.
  const status = planStatus(order, ids);
  expect(status.ranked + status.unranked.length).toBe(ids.length);
  expect(status.complete).toBe(status.unranked.length === 0);
}

describe("Invariant 2 — no candidate can occupy two preference positions", () => {
  it("holds after every edit in an arbitrary sequence of plan operations", () => {
    fc.assert(
      fc.property(scenarioArb, ({ ids, ops }) => {
        let order: string[] = [];
        assertNoDuplicatePreference(order, ids);
        for (const op of ops) {
          order = applyOp(order, op, ids.length);
          assertNoDuplicatePreference(order, ids);
        }
      }),
    );
  });
});
