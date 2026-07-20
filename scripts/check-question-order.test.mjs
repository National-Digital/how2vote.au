import { describe, expect, it } from "vitest";
import { verify } from "./check-question-order.mjs";

const lock = (orders) => ({ schemaVersion: 1, orders });

describe("verify — append-only question order", () => {
  it("passes when the built order equals the lock", () => {
    expect(verify(lock({ 2025: [3, 1, 2] }), { 2025: [3, 1, 2] }).ok).toBe(true);
  });

  it("passes when new ids are appended at the end", () => {
    expect(verify(lock({ 2025: [3, 1, 2] }), { 2025: [3, 1, 2, 9, 10] }).ok).toBe(true);
  });

  it("FAILS when an existing id moves position (breaks share links)", () => {
    const res = verify(lock({ 2025: [3, 1, 2] }), { 2025: [1, 3, 2] });
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatch(/position 0 changed/);
  });

  it("FAILS when a question is dropped (shifts every later position)", () => {
    const res = verify(lock({ 2025: [3, 1, 2] }), { 2025: [3, 1] });
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatch(/dropped questions/);
  });

  it("FAILS when a locked election is absent from the build", () => {
    const res = verify(lock({ 2025: [3, 1, 2] }), {});
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatch(/absent from the built/);
  });

  it("FAILS on a malformed lock", () => {
    expect(verify({ schemaVersion: 2, orders: {} }, {}).ok).toBe(false);
  });
});
