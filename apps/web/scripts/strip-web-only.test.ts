import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stripWebOnly } from "./strip-web-only.mjs";

const builds: string[] = [];
afterEach(() => builds.splice(0).forEach((b) => rmSync(b, { recursive: true, force: true })));

/** A build holding the data files and a page. */
function build(): string {
  const dir = mkdtempSync(join(tmpdir(), "strip-web-only-"));
  builds.push(dir);
  mkdirSync(join(dir, "data", "2025"), { recursive: true });
  writeFileSync(join(dir, "data", "index.json"), "{}");
  writeFileSync(join(dir, "data", "2025", "candidates.json"), "{}");
  writeFileSync(join(dir, "index.html"), "<!doctype html>");
  return dir;
}

describe("stripWebOnly", () => {
  it.each(["ios", "android"])("removes the data files from the %s build", (channel) => {
    const dir = build();
    stripWebOnly(dir, channel);
    expect(existsSync(join(dir, "data"))).toBe(false);
    expect(existsSync(join(dir, "index.html"))).toBe(true);
  });

  it.each(["web", undefined])("keeps them in the %s build", (channel) => {
    const dir = build();
    stripWebOnly(dir, channel);
    expect(existsSync(join(dir, "data", "index.json"))).toBe(true);
  });

  it("runs after vite in both builds", () => {
    const scripts = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ).scripts;
    for (const name of ["build", "build:app"]) {
      const steps = (scripts[name] as string).split(" && ");
      expect(steps.indexOf("node scripts/strip-web-only.mjs"), name).toBeGreaterThan(
        steps.indexOf("vite build"),
      );
    }
  });
});
