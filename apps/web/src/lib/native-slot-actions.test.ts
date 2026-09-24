import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/age-gate-actions", () => ({
  declareAdult: vi.fn(),
  declareMinor: vi.fn(),
  continueExploring: vi.fn(),
}));
vi.mock("$lib/privacy/local-data", () => ({
  clearLocalDeviceData: vi.fn(() => new Promise(() => {})),
}));

const gate = await import("$lib/age-gate-actions");
const data = await import("$lib/privacy/local-data");
const { performSlotAction } = await import("./native-slot-actions");

describe("performSlotAction", () => {
  const navigate = vi.fn();
  const resync = vi.fn();
  beforeEach(() => vi.clearAllMocks());

  it("acts on the answer a button names, whatever its position", () => {
    performSlotAction("age-declare", "minor", navigate, resync);
    expect(gate.declareMinor).toHaveBeenCalledOnce();
    expect(gate.declareAdult).not.toHaveBeenCalled();
    expect(resync).toHaveBeenCalledOnce();

    performSlotAction("age-declare", "adult", navigate, resync);
    expect(gate.declareAdult).toHaveBeenCalledWith(navigate);
  });

  it("continues an explorer into the quiz, and clears on request", () => {
    performSlotAction("age-continue", "continue", navigate, resync);
    expect(gate.continueExploring).toHaveBeenCalledWith(navigate);
    performSlotAction("clear-data", "clear", navigate, resync);
    expect(data.clearLocalDeviceData).toHaveBeenCalledOnce();
  });

  it("does nothing for an action it does not know, or for a position", () => {
    for (const [slot, action] of [
      ["age-declare", "0"],
      ["age-declare", "1"],
      ["age-declare", "continue"],
      ["unknown", "adult"],
    ] as const) {
      expect(performSlotAction(slot, action, navigate, resync)).toBe(false);
    }
    expect(gate.declareAdult).not.toHaveBeenCalled();
    expect(gate.declareMinor).not.toHaveBeenCalled();
  });
});
