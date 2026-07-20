import { describe, expect, it } from "vitest";
import { errorInfo } from "./errors.js";

describe("errorInfo", () => {
  it("brands 404 as not-found and never offers a retry", () => {
    const info = errorInfo(404);
    expect(info.kind).toBe("notfound");
    expect(info.code).toBe("404");
    expect(info.title).toBe("Page not found");
    expect(info.canRetry).toBe(false);
  });

  it("brands 403 and 429 as distinct client errors", () => {
    expect(errorInfo(403).title).toBe("That page is off-limits");
    expect(errorInfo(403).canRetry).toBe(false);
    expect(errorInfo(429).title).toBe("Too many requests");
    expect(errorInfo(429).canRetry).toBe(true);
  });

  it("gives 503 its own maintenance wording, separate from other 5xx", () => {
    const maintenance = errorInfo(503);
    const generic5xx = errorInfo(500);
    expect(maintenance.title).not.toBe(generic5xx.title);
    expect(maintenance.kind).toBe("server");
    expect(generic5xx.kind).toBe("server");
  });

  it("treats every 5xx as a server error the user can retry", () => {
    for (const status of [500, 502, 504, 599]) {
      const info = errorInfo(status);
      expect(info.kind).toBe("server");
      expect(info.canRetry).toBe(true);
      expect(info.code).toBe(String(status));
    }
  });

  it("classifies unlisted 4xx as a non-retryable client error", () => {
    const info = errorInfo(418);
    expect(info.kind).toBe("client");
    expect(info.code).toBe("418");
    expect(info.canRetry).toBe(false);
  });

  it("falls back to a calm generic message for missing/unknown statuses", () => {
    expect(errorInfo(undefined).kind).toBe("generic");
    expect(errorInfo(undefined).code).toBe("Error");
    expect(errorInfo(0).kind).toBe("generic");
  });

  it("uses a supplied message only for generic and other-4xx cases", () => {
    expect(errorInfo(undefined, "boom").lede).toBe("boom");
    expect(errorInfo(418, "teapot").lede).toBe("teapot");
    // Cases with real copy ignore the raw framework string.
    expect(errorInfo(404, "leaked internals").lede).not.toBe("leaked internals");
    expect(errorInfo(500, "stack trace").lede).not.toBe("stack trace");
  });
});
