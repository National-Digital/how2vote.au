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
const cards = vi.hoisted(() => ({
  cardFlow: {
    status: "ready",
    data: { shared: false } as null | { shared: boolean },
    stage: "compare",
    pendingAction: null as null | string,
    showShareWarning: false,
    showWhy: false,
    senateView: "above",
    cardUrl: "/card#v1.2025.a.b",
    houseIds: ["Jane Citizen|1", "Sam Voter|2"],
    senateAboveIds: ["A"],
    senateBelowIds: ["Alex Doe|1"],
    requestBuild: vi.fn(),
    requestShare: vi.fn(),
    confirmShare: vi.fn(() => true),
    cancelShare: vi.fn(),
    toggleSave: vi.fn(),
    startFresh: vi.fn(),
    backToCompare: vi.fn(),
    tickTerms: vi.fn(),
    acceptTerms: vi.fn(() => true),
    cancelTerms: vi.fn(),
    setRank: vi.fn(),
    moveUp: vi.fn(),
    moveDown: vi.fn(),
  },
}));
vi.mock("$lib/card-flow.svelte", () => cards);
vi.mock("$lib/seo", () => ({
  shareUrl: (path: string, hash: string) => `https://how2vote.au${path}${hash}`,
}));

const { handleScreenAction, loadCardFlow, performScreenAction } =
  await import("./native-screen-actions");

const resync = vi.fn();
const navigate = vi.fn();
const context = { resync, navigate };

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(cards.cardFlow, {
    status: "ready",
    data: { shared: false },
    stage: "compare",
    pendingAction: null,
    showShareWarning: false,
    showWhy: false,
    senateView: "above",
  });
  cards.cardFlow.confirmShare.mockImplementation(() => true);
  cards.cardFlow.acceptTerms.mockImplementation(() => true);
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

describe("the card's actions", () => {
  const card = cards.cardFlow;

  it("takes nothing before a card has been opened", async () => {
    expect(act("build")).toBe(false);
    await loadCardFlow();
    expect(act("build")).toBe(true);
  });
  const act = (action: string, value?: string, reply = vi.fn()) =>
    performScreenAction("card", action, value, { ...context, reply });

  it("takes nothing from a card that is not ready", () => {
    card.status = "loading";
    for (const action of ["build", "share", "save", "why", "terms-accept"]) {
      expect(act(action)).toBe(false);
    }
    expect(card.requestBuild).not.toHaveBeenCalled();
    expect(resync).not.toHaveBeenCalled();
  });

  it("takes the comparison's steps only on the comparison, and redraws it", () => {
    expect(act("build")).toBe(true);
    expect(card.requestBuild).toHaveBeenCalledOnce();
    expect(resync).toHaveBeenCalledOnce();
    card.stage = "build";
    for (const action of ["build", "share", "save", "why", "share-confirm"]) {
      expect(act(action)).toBe(false);
    }
    expect(card.requestShare).not.toHaveBeenCalled();
    expect(card.toggleSave).not.toHaveBeenCalled();
  });

  it("takes the plan's steps only on the plan", () => {
    const row = JSON.stringify({ ballot: "house", id: "Jane Citizen|1", n: 2 });
    for (const [action, value] of [
      ["rank", row],
      ["up", row],
      ["down", row],
      ["senate", "below"],
      ["compare", undefined],
    ] as const) {
      expect(act(action, value)).toBe(false);
    }
    card.stage = "build";
    expect(act("rank", row)).toBe(true);
    expect(card.setRank).toHaveBeenCalledWith("house", "Jane Citizen|1", 2);
    expect(act("senate", "below")).toBe(true);
    expect(card.senateView).toBe("below");
    expect(act("compare")).toBe(true);
    expect(card.backToCompare).toHaveBeenCalledOnce();
  });

  it("numbers only a row the ballot holds, with a whole number or none", () => {
    card.stage = "build";
    for (const value of [
      JSON.stringify({ ballot: "house", id: "Nobody|9", n: 1 }),
      JSON.stringify({ ballot: "above", id: "Jane Citizen|1", n: 1 }),
      JSON.stringify({ ballot: "house", id: "Jane Citizen|1", n: 1.5 }),
      JSON.stringify({ ballot: "house", id: "Jane Citizen|1", n: "1" }),
      JSON.stringify({ ballot: "lords", id: "Jane Citizen|1", n: 1 }),
      "not json",
    ]) {
      expect(act("rank", value)).toBe(false);
    }
    expect(card.setRank).not.toHaveBeenCalled();
    expect(act("rank", JSON.stringify({ ballot: "house", id: "Jane Citizen|1", n: null }))).toBe(
      true,
    );
    expect(card.setRank).toHaveBeenCalledWith("house", "Jane Citizen|1", NaN);
    expect(act("senate", "sideways")).toBe(false);
  });

  it("ticks, accepts and cancels the Terms only while the gate is showing", () => {
    for (const action of ["terms-tick", "terms-cancel"]) expect(act(action, "1")).toBe(false);
    card.pendingAction = "build";
    expect(act("terms-tick", "1")).toBe(true);
    expect(card.tickTerms).toHaveBeenCalledWith(true);
    expect(act("terms-tick", "yes")).toBe(false);
    card.acceptTerms.mockImplementation(() => false);
    expect(act("terms-accept")).toBe(false);
    card.acceptTerms.mockImplementation(() => true);
    expect(act("terms-accept")).toBe(true);
    expect(act("terms-cancel")).toBe(true);
    expect(card.cancelTerms).toHaveBeenCalledOnce();
  });

  it("answers a confirmed warning with the canonical link, and a refused one with none", () => {
    const answer = vi.fn(async () => undefined);
    handleScreenAction({ screen: "card", action: "share-confirm", request: "s1" }, context, answer);
    expect(answer).toHaveBeenCalledWith("s1", "https://how2vote.au/card#v1.2025.a.b");
    card.confirmShare.mockImplementation(() => false);
    handleScreenAction({ screen: "card", action: "share-confirm", request: "s2" }, context, answer);
    expect(answer).toHaveBeenCalledWith("s2", "");
  });

  it("starts afresh only from a shared card", () => {
    expect(act("fresh")).toBe(false);
    card.data = { shared: true };
    expect(act("fresh")).toBe(true);
    expect(card.startFresh).toHaveBeenCalledWith(navigate);
  });
});
