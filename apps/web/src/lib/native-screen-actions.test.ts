import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  has: vi.fn((url: string) => url === "/card#v1.a"),
  remove: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("$lib/saved.svelte", () => ({ saved: store }));

const { performScreenAction } = await import("./native-screen-actions");

describe("performScreenAction", () => {
  const resync = vi.fn();
  beforeEach(() => vi.clearAllMocks());

  it("deletes the saved card named, then redraws the screen", () => {
    expect(performScreenAction("saved", "remove", "/card#v1.a", resync)).toBe(true);
    expect(store.remove).toHaveBeenCalledWith("/card#v1.a");
    expect(resync).toHaveBeenCalledOnce();
  });

  it("clears every saved card, then redraws the screen", () => {
    expect(performScreenAction("saved", "clear", undefined, resync)).toBe(true);
    expect(store.clear).toHaveBeenCalledOnce();
    expect(resync).toHaveBeenCalledOnce();
  });

  it("deletes nothing for a card it does not hold, or none named", () => {
    expect(performScreenAction("saved", "remove", "/card#v1.b", resync)).toBe(false);
    expect(performScreenAction("saved", "remove", undefined, resync)).toBe(false);
    expect(store.remove).not.toHaveBeenCalled();
    expect(resync).not.toHaveBeenCalled();
  });

  it("does nothing for an action it does not know", () => {
    for (const [screen, action] of [
      ["saved", "wipe"],
      ["review", "clear"],
      ["", ""],
    ] as const) {
      expect(performScreenAction(screen, action, "/card#v1.a", resync)).toBe(false);
    }
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.clear).not.toHaveBeenCalled();
  });
});
