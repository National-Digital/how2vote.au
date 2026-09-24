import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  has: vi.fn((url: string) => url === "/card#v1.a"),
  remove: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("$lib/saved.svelte", () => ({ saved: store }));
const forms = vi.hoisted(() => ({ submitContact: vi.fn(async () => "offline" as const) }));
vi.mock("$lib/forms", () => forms);

const { handleScreenAction, performScreenAction } = await import("./native-screen-actions");

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

  it("sends a contact message as the page's form does, and answers with how it went", async () => {
    const reply = vi.fn();
    const fields = { name: "A", email: "a@b.c", message: "Hi" };
    expect(performScreenAction("contact", "send", JSON.stringify(fields), resync, reply)).toBe(
      true,
    );
    expect(forms.submitContact).toHaveBeenCalledWith(fields);
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith("offline"));
    expect(resync).not.toHaveBeenCalled();
  });

  it("sends nothing for a message with a field missing or empty, or none at all", () => {
    for (const value of [
      JSON.stringify({ name: "A", email: "a@b.c" }),
      JSON.stringify({ name: "A", email: "a@b.c", message: "  " }),
      JSON.stringify({ name: "A", email: 1, message: "Hi" }),
      "not json",
      undefined,
    ]) {
      expect(performScreenAction("contact", "send", value, resync)).toBe(false);
    }
    expect(forms.submitContact).not.toHaveBeenCalled();
  });

  it("offers the Insights screen again when it asks, so it carries the figures now open", () => {
    expect(performScreenAction("insights", "refresh", undefined, resync)).toBe(true);
    expect(resync).toHaveBeenCalledOnce();
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

describe("handleScreenAction", () => {
  const resync = vi.fn();
  beforeEach(() => vi.clearAllMocks());

  it("answers a request it does not know empty, so the screen is never left waiting", () => {
    const answer = vi.fn(async () => undefined);
    handleScreenAction({ screen: "contact", action: "post", request: "r1" }, resync, answer);
    expect(answer).toHaveBeenCalledWith("r1", "");
    handleScreenAction(
      { screen: "contact", action: "send", value: "{}", request: "r2" },
      resync,
      answer,
    );
    expect(answer).toHaveBeenCalledWith("r2", "");
    expect(forms.submitContact).not.toHaveBeenCalled();
  });

  it("answers a sent message with the page's outcome, once", async () => {
    const answer = vi.fn(async () => undefined);
    const value = JSON.stringify({ name: "A", email: "a@b.c", message: "Hi" });
    handleScreenAction({ screen: "contact", action: "send", value, request: "r3" }, resync, answer);
    await vi.waitFor(() => expect(answer).toHaveBeenCalledWith("r3", "offline"));
    expect(answer).toHaveBeenCalledOnce();
  });

  it("answers nothing for a request no screen is waiting on", () => {
    const answer = vi.fn(async () => undefined);
    handleScreenAction({ screen: "saved", action: "clear" }, resync, answer);
    handleScreenAction({ screen: "saved", action: "wipe" }, resync, answer);
    expect(answer).not.toHaveBeenCalled();
    expect(store.clear).toHaveBeenCalledOnce();
  });
});
