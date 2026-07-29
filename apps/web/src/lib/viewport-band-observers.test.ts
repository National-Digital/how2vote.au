import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every ResizeObserver in this app measures a band that other layout reserves room for: the sticky
 * app chrome (--chrome-h), the consent banner (--consent-banner-h) and the plan's authorisation
 * band (--plan-auth-h). All three carry a safe-area inset in their OWN padding, because they sit
 * against a viewport edge on an edge-to-edge device.
 *
 * That makes the default content-box observation wrong in a way that is invisible on a desktop
 * browser, where every inset is 0. A content-box observer never fires when only the padding
 * changes, so the published height stays short by exactly the inset — and the reservation derived
 * from it under-reserves by exactly the amount that is covering content (WCAG 2.2 SC 2.4.11).
 *
 * The bug is silent and identical every time. Hence a source-level invariant rather than three
 * separate behavioural tests: the next component to publish a height is the one this is really
 * for.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(svelte|ts)$/.test(entry) && !entry.endsWith(".test.ts") ? [path] : [];
  });
}

const observers = sourceFiles(SRC)
  .map((path) => ({ path, source: readFileSync(path, "utf8") }))
  .filter(({ source }) => source.includes("new ResizeObserver"));

describe("ResizeObserver box option", () => {
  it("finds the components that publish a measured height", () => {
    // Guards the guard: a rename or a refactor that moved these out from under the scan would
    // otherwise turn every assertion below into a vacuous pass over an empty list.
    expect(observers.map((o) => o.path.slice(SRC.length + 1)).sort()).toEqual([
      "lib/components/ConsentBanner.svelte",
      "lib/components/PlanAuthorisationBand.svelte",
      "routes/+layout.svelte",
    ]);
  });

  for (const { path, source } of observers) {
    const name = path.slice(SRC.length + 1);
    it(`${name} observes the border box`, () => {
      const calls = source.match(/\.observe\([^)]*\)/g) ?? [];
      expect(calls.length, "expected at least one observe() call").toBeGreaterThan(0);
      for (const call of calls) {
        expect(call, `${name}: ${call} must pass { box: "border-box" }`).toMatch(
          /box:\s*["']border-box["']/,
        );
      }
    });
  }
});
