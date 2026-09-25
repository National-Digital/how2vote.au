import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  has: vi.fn((url: string) => url === "/card#v1.a"),
  remove: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("$lib/saved.svelte", () => ({ saved: store }));
const forms = vi.hoisted(() => ({ submitContact: vi.fn(async () => "offline" as const) }));
vi.mock("$lib/forms", () => forms);
const flow = vi.hoisted(() => ({
  survey: {
    step: -1,
    consented: false,
    sensitiveConsented: false,
    termsChecked: false,
    left: false,
    current: undefined as undefined | { key: string; options: string[] },
    contribute: vi.fn(),
    choose: vi.fn(),
    back: vi.fn(),
  },
}));
vi.mock("$lib/survey-flow.svelte", () => ({ ...flow, GATE: "gate" }));

const { handleScreenAction, performScreenAction } = await import("./native-screen-actions");

const resync = vi.fn();
const navigate = vi.fn();
const context = { resync, navigate };

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(flow.survey, {
    step: -1,
    consented: false,
    sensitiveConsented: false,
    termsChecked: false,
    left: false,
    current: undefined,
  });
});

describe("performScreenAction", () => {
  it("deletes the saved card named, then redraws the screen", () => {
    expect(performScreenAction("saved", "remove", "/card#v1.a", context)).toBe(true);
    expect(store.remove).toHaveBeenCalledWith("/card#v1.a");
    expect(resync).toHaveBeenCalledOnce();
  });

  it("clears every saved card, then redraws the screen", () => {
    expect(performScreenAction("saved", "clear", undefined, context)).toBe(true);
    expect(store.clear).toHaveBeenCalledOnce();
    expect(resync).toHaveBeenCalledOnce();
  });

  it("deletes nothing for a card it does not hold, or none named", () => {
    expect(performScreenAction("saved", "remove", "/card#v1.b", context)).toBe(false);
    expect(performScreenAction("saved", "remove", undefined, context)).toBe(false);
    expect(store.remove).not.toHaveBeenCalled();
    expect(resync).not.toHaveBeenCalled();
  });

  it("sends a contact message as the page's form does, and answers with how it went", async () => {
    const reply = vi.fn();
    const fields = { name: "A", email: "a@b.c", message: "Hi" };
    expect(
      performScreenAction("contact", "send", JSON.stringify(fields), { ...context, reply }),
    ).toBe(true);
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
      expect(performScreenAction("contact", "send", value, context)).toBe(false);
    }
    expect(forms.submitContact).not.toHaveBeenCalled();
  });

  it("offers the Insights screen again when it asks, so it carries the figures now open", () => {
    expect(performScreenAction("insights", "refresh", undefined, context)).toBe(true);
    expect(resync).toHaveBeenCalledOnce();
  });

  it("does nothing for an action it does not know", () => {
    for (const [screen, action] of [
      ["saved", "wipe"],
      ["review", "clear"],
      ["", ""],
    ] as const) {
      expect(performScreenAction(screen, action, "/card#v1.a", context)).toBe(false);
    }
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.clear).not.toHaveBeenCalled();
  });
});

describe("the survey's steps", () => {
  it("sets each of the gate's ticks as sent, and redraws the gate", () => {
    expect(performScreenAction("survey", "consent", "1", context)).toBe(true);
    expect(performScreenAction("survey", "sensitive", "1", context)).toBe(true);
    expect(performScreenAction("survey", "terms", "1", context)).toBe(true);
    expect(flow.survey).toMatchObject({
      consented: true,
      sensitiveConsented: true,
      termsChecked: true,
    });
    expect(performScreenAction("survey", "sensitive", "0", context)).toBe(true);
    expect(flow.survey.sensitiveConsented).toBe(false);
    expect(resync).toHaveBeenCalledTimes(4);
  });

  it("sets no tick from a state it cannot read, or once the questions have begun", () => {
    expect(performScreenAction("survey", "consent", "yes", context)).toBe(false);
    flow.survey.step = 0;
    expect(performScreenAction("survey", "consent", "1", context)).toBe(false);
    expect(performScreenAction("survey", "contribute", undefined, context)).toBe(false);
    expect(flow.survey.consented).toBe(false);
    expect(flow.survey.contribute).not.toHaveBeenCalled();
  });

  it("asks the survey to contribute, whose own rule decides whether it may", () => {
    expect(performScreenAction("survey", "contribute", undefined, context)).toBe(true);
    expect(flow.survey.contribute).toHaveBeenCalledOnce();
  });

  it("records one of the question's own answers, or none, and nothing else", () => {
    flow.survey.step = 0;
    flow.survey.current = { key: "age", options: ["18–24", "25–34"] };
    const choose = (key: string, answer: string) => JSON.stringify({ key, answer });
    expect(performScreenAction("survey", "choose", choose("age", "25–34"), context)).toBe(true);
    expect(performScreenAction("survey", "choose", choose("age", ""), context)).toBe(true);
    expect(performScreenAction("survey", "choose", choose("age", "99"), context)).toBe(false);
    expect(performScreenAction("survey", "choose", "25–34", context)).toBe(false);
    expect(performScreenAction("survey", "choose", undefined, context)).toBe(false);
    expect(flow.survey.choose.mock.calls.map((c) => c.slice(0, 2))).toEqual([
      ["age", "25–34"],
      ["age", ""],
    ]);
    expect(resync).toHaveBeenCalledTimes(2);
  });

  // A second tap sent before the app has drawn the next question names the question it was drawn
  // for: it must not answer the one the survey has moved on to, sensitive or not.
  it("refuses an answer or a step back made from a question no longer shown", () => {
    flow.survey.step = 4;
    flow.survey.current = { key: "indigenous", options: ["No", "Yes"] };
    const stale = JSON.stringify({ key: "language", answer: "No" });
    expect(performScreenAction("survey", "choose", stale, context)).toBe(false);
    expect(performScreenAction("survey", "back", "language", context)).toBe(false);
    expect(performScreenAction("survey", "back", "gate", context)).toBe(false);
    expect(flow.survey.choose).not.toHaveBeenCalled();
    expect(flow.survey.back).not.toHaveBeenCalled();
    expect(performScreenAction("survey", "back", "indigenous", context)).toBe(true);
    flow.survey.step = -1;
    flow.survey.current = undefined;
    expect(performScreenAction("survey", "back", "indigenous", context)).toBe(false);
    expect(performScreenAction("survey", "back", "gate", context)).toBe(true);
  });

  it("takes no step once the survey has left, from a tap sent before the app redrew", () => {
    flow.survey.step = 3;
    flow.survey.current = { key: "age", options: ["18–24"] };
    flow.survey.left = true;
    expect(
      performScreenAction(
        "survey",
        "choose",
        JSON.stringify({ key: "age", answer: "18–24" }),
        context,
      ),
    ).toBe(false);
    expect(performScreenAction("survey", "back", "age", context)).toBe(false);
    expect(flow.survey.choose).not.toHaveBeenCalled();
    expect(flow.survey.back).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("offers the route it leaves for, never the survey again, when a step leaves it", () => {
    flow.survey.step = 3;
    flow.survey.current = { key: "age", options: ["18–24"] };
    flow.survey.choose.mockImplementationOnce((_k: string, _v: string, go: (p: string) => void) =>
      go("/card"),
    );
    expect(
      performScreenAction(
        "survey",
        "choose",
        JSON.stringify({ key: "age", answer: "18–24" }),
        context,
      ),
    ).toBe(true);
    expect(navigate).toHaveBeenCalledWith("/card");
    flow.survey.back.mockImplementationOnce((go: (p: string) => void) => go("/review"));
    expect(performScreenAction("survey", "back", "age", context)).toBe(true);
    expect(navigate).toHaveBeenCalledWith("/review");
    expect(resync).not.toHaveBeenCalled();
  });
});

describe("handleScreenAction", () => {
  it("answers a request it does not know empty, so the screen is never left waiting", () => {
    const answer = vi.fn(async () => undefined);
    handleScreenAction({ screen: "contact", action: "post", request: "r1" }, context, answer);
    expect(answer).toHaveBeenCalledWith("r1", "");
    handleScreenAction(
      { screen: "contact", action: "send", value: "{}", request: "r2" },
      context,
      answer,
    );
    expect(answer).toHaveBeenCalledWith("r2", "");
    expect(forms.submitContact).not.toHaveBeenCalled();
  });

  it("answers a sent message with the page's outcome, once", async () => {
    const answer = vi.fn(async () => undefined);
    const value = JSON.stringify({ name: "A", email: "a@b.c", message: "Hi" });
    handleScreenAction(
      { screen: "contact", action: "send", value, request: "r3" },
      context,
      answer,
    );
    await vi.waitFor(() => expect(answer).toHaveBeenCalledWith("r3", "offline"));
    expect(answer).toHaveBeenCalledOnce();
  });

  it("answers nothing for a request no screen is waiting on", () => {
    const answer = vi.fn(async () => undefined);
    handleScreenAction({ screen: "saved", action: "clear" }, context, answer);
    handleScreenAction({ screen: "saved", action: "wipe" }, context, answer);
    expect(answer).not.toHaveBeenCalled();
    expect(store.clear).toHaveBeenCalledOnce();
  });
});
