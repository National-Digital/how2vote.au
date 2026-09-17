import { describe, expect, it } from "vitest";
import { routePath } from "./native-route-path";

describe("routePath", () => {
  // The iOS shell serves the app from capacitor://localhost. `capacitor:` is a non-special scheme,
  // so the parser leaves an empty path empty instead of normalising it to "/" — and the landing,
  // the route the app opens on, stopped matching the native route table because of it.
  it("normalises the empty path of a non-special scheme to the root", () => {
    expect(new URL("capacitor://localhost").pathname).toBe("");
    expect(routePath(new URL("capacitor://localhost"))).toBe("/");
  });

  it("leaves every path the route table already matches alone", () => {
    for (const [href, expected] of [
      ["capacitor://localhost/", "/"],
      ["capacitor://localhost/quiz", "/quiz"],
      ["capacitor://localhost/ballot", "/ballot"],
      ["capacitor://localhost/2025", "/2025"],
      ["https://how2vote.au/", "/"],
      ["https://how2vote.au/review", "/review"],
    ] as const) {
      expect(routePath(new URL(href))).toBe(expected);
    }
  });

  it("keeps the query and hash out of the path", () => {
    expect(routePath(new URL("capacitor://localhost/ballot?edit=1#top"))).toBe("/ballot");
  });
});
