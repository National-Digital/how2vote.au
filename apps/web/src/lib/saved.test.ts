import { describe, expect, it } from "vitest";
import { MAX_SAVED, isSavedCard, parseSaved, removeByUrl, upsert, type SavedCard } from "./saved";

const card = (url: string, savedAt = 1): SavedCard => ({
  url,
  electorate: "Bean",
  state: "ACT",
  savedAt,
});

describe("isSavedCard", () => {
  it("accepts a well-formed record and rejects malformed ones", () => {
    expect(isSavedCard(card("/card#v1.abc"))).toBe(true);
    expect(isSavedCard(null)).toBe(false);
    expect(isSavedCard({ url: "", electorate: "x", state: "y", savedAt: 1 })).toBe(false);
    expect(isSavedCard({ url: "/c", electorate: "x", state: "y", savedAt: "nope" })).toBe(false);
    expect(isSavedCard({ url: "/c", electorate: "x", state: "y", savedAt: NaN })).toBe(false);
  });
});

describe("parseSaved", () => {
  it("returns an empty list for empty/corrupt input", () => {
    expect(parseSaved(null)).toEqual([]);
    expect(parseSaved("")).toEqual([]);
    expect(parseSaved("not json")).toEqual([]);
    expect(parseSaved('{"not":"an array"}')).toEqual([]);
  });

  it("drops malformed entries and sorts newest-first", () => {
    const raw = JSON.stringify([card("/a", 10), { junk: true }, card("/b", 30), card("/c", 20)]);
    const parsed = parseSaved(raw);
    expect(parsed.map((c) => c.url)).toEqual(["/b", "/c", "/a"]);
  });
});

describe("upsert", () => {
  it("adds a new card at the front", () => {
    const result = upsert([card("/a", 1)], { url: "/b", electorate: "Bean", state: "ACT" }, 2);
    expect(result.map((c) => c.url)).toEqual(["/b", "/a"]);
    expect(result[0].savedAt).toBe(2);
  });

  it("de-duplicates by url, refreshing the timestamp and moving it to the front", () => {
    const items = [card("/a", 1), card("/b", 2)];
    const result = upsert(items, { url: "/a", electorate: "Bean", state: "ACT" }, 99);
    expect(result.map((c) => c.url)).toEqual(["/a", "/b"]);
    expect(result).toHaveLength(2); // no duplicate
    expect(result[0].savedAt).toBe(99);
  });

  it("caps the list at MAX_SAVED, dropping the oldest", () => {
    let items: SavedCard[] = [];
    for (let i = 0; i < MAX_SAVED + 5; i++) {
      items = upsert(items, { url: `/c${i}`, electorate: "Bean", state: "ACT" }, i);
    }
    expect(items).toHaveLength(MAX_SAVED);
    expect(items[0].url).toBe(`/c${MAX_SAVED + 4}`); // newest kept
    expect(items.some((c) => c.url === "/c0")).toBe(false); // oldest dropped
  });
});

describe("removeByUrl", () => {
  it("removes only the matching card", () => {
    const result = removeByUrl([card("/a"), card("/b")], "/a");
    expect(result.map((c) => c.url)).toEqual(["/b"]);
  });
});
