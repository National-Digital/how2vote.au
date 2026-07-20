import { describe, expect, it } from "vitest";
import { moveDown, moveUp, planStatus, prefOf, setRank, unrank } from "./plan";

const ids = ["a", "b", "c", "d"];

describe("plan order — a blank ballot the voter fills in", () => {
  it("starts empty: nothing is ranked or pre-filled", () => {
    const order: string[] = [];
    for (const id of ids) expect(prefOf(order, id)).toBe(0);
    expect(planStatus(order, ids)).toEqual({
      ranked: 0,
      total: 4,
      unranked: ["a", "b", "c", "d"],
      complete: false,
    });
  });

  it("setRank places a candidate at a 1-based rank, shifting others — never duplicating", () => {
    let order: string[] = [];
    order = setRank(order, "c", 1, 4); // c first
    order = setRank(order, "a", 2, 4); // a second
    expect(order).toEqual(["c", "a"]);
    expect(prefOf(order, "c")).toBe(1);
    expect(prefOf(order, "a")).toBe(2);
    // Re-placing c at 2 moves it, leaving a valid contiguous order (no dup 2s).
    order = setRank(order, "c", 2, 4);
    expect(order).toEqual(["a", "c"]);
  });

  it("clamps an out-of-range rank into the ballot", () => {
    let order: string[] = [];
    order = setRank(order, "a", 99, 4);
    expect(prefOf(order, "a")).toBe(1);
  });

  it("unrank / empty entry removes a preference", () => {
    let order = ["a", "b"];
    order = unrank(order, "a");
    expect(order).toEqual(["b"]);
    order = setRank(order, "b", NaN, 4); // cleared input
    expect(order).toEqual([]);
  });

  it("moveUp/moveDown swap adjacent preferences; an unranked candidate joins at the end", () => {
    let order = ["a", "b", "c"];
    order = moveUp(order, "c"); // c above b
    expect(order).toEqual(["a", "c", "b"]);
    order = moveDown(order, "a"); // a below c
    expect(order).toEqual(["c", "a", "b"]);
    order = moveUp(order, "d"); // d was unranked → joins last, then steps up
    expect(order).toEqual(["c", "a", "d", "b"]);
  });

  it("reports completion once every candidate is ranked", () => {
    const order = ["b", "d", "a", "c"];
    expect(planStatus(order, ids)).toEqual({
      ranked: 4,
      total: 4,
      unranked: [],
      complete: true,
    });
  });

  it("ignores stray ids not on this ballot when counting", () => {
    const order = ["a", "zzz", "b"];
    const status = planStatus(order, ids);
    expect(status.ranked).toBe(2);
    expect(status.unranked).toEqual(["c", "d"]);
  });
});
