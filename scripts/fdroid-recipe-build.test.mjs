import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { PHASES, phaseCommands, shellLine, signingKeys, subdir } from "./fdroid-recipe-build.mjs";

const recipe = readFileSync(new URL("../docs/fdroid/au.how2vote.app.yml", import.meta.url), "utf8");

describe("recipe phase extraction", () => {
  it("reads every phase the buildserver executes", () => {
    for (const phase of PHASES) expect(phaseCommands(recipe, phase).length).toBeGreaterThan(0);
    expect(subdir(recipe)).toBe("apps/mobile/android/app");
  });

  it("undoes YAML line folding so a wrapped command stays one command", () => {
    const folded = [
      "    build:",
      "      - pnpm -C ../../.. --filter",
      "        @how2vote/web build",
      "    gradle:",
    ].join("\n");
    expect(phaseCommands(folded, "build")).toEqual([
      "pnpm -C ../../.. --filter @how2vote/web build",
    ]);
  });

  it("skips comments", () => {
    const withComment = ["    build:", "      # note", "      - true", "    gradle:"].join("\n");
    expect(phaseCommands(withComment, "build")).toEqual(["true"]);
  });

  it("substitutes the version pair placeholders", () => {
    const line = shellLine(["echo $$VERSION$$ $$VERCODE$$ $$VERSION$$"], {
      version: "1.2.3",
      code: "10203000",
    });
    expect(line).toBe("echo 1.2.3 10203000 1.2.3");
  });

  it("joins commands with '; ', as fdroidserver does", () => {
    expect(shellLine(["a", "b"], { version: "1.0.0", code: "1" })).toBe("a; b");
  });
});

describe("recipe command hygiene", () => {
  // fdroidserver joins a phase's list with "; " and runs it as ONE shell rooted at subdir. Each
  // item is a single command: a chain hides which one failed in the build log, and a `cd` would
  // leak into every command after it. The workspace root is reached with `pnpm -C`.
  it("keeps every phase command a single command that stays in subdir", () => {
    for (const phase of PHASES) {
      const cmds = phaseCommands(recipe, phase);
      expect(cmds.length).toBeGreaterThan(0);
      for (const cmd of cmds) {
        expect(/&&|\|\||;/.test(cmd), `${phase}: "${cmd}" must not chain commands`).toBe(false);
        expect(/^\(|(^|\s)cd[ \t]/.test(cmd), `${phase}: "${cmd}" must not cd`).toBe(false);
      }
    }
  });

  // The web bundle is built from the workspace root while the shell stays in subdir.
  it("reaches the workspace root with pnpm -C", () => {
    for (const cmd of phaseCommands(recipe, "build")) {
      expect(cmd).toContain("pnpm -C ../../../..");
    }
  });

  // packages/*/dist is gitignored, so a fresh checkout must build workspace dependencies first.
  it("builds the web package with its workspace dependencies", () => {
    const build = phaseCommands(recipe, "build").join("; ");
    expect(build).toContain("--filter @how2vote/web...");
  });
});

describe("phase argument handling", () => {
  it("treats the phase as a literal, so regex metacharacters cannot match", () => {
    const recipe = ["    build:", "      - true", "    gradle:"].join("\n");
    expect(phaseCommands(recipe, "buil.")).toEqual([]);
    expect(phaseCommands(recipe, "(build)")).toEqual([]);
    expect(phaseCommands(recipe, ".*")).toEqual([]);
    expect(phaseCommands(recipe, "build")).toEqual(["true"]);
  });
});

describe("pinned signer", () => {
  it("reads the digests the recipe pins", () => {
    const keys = signingKeys(recipe);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stops at the end of the list", () => {
    const doc = [
      "AllowedAPKSigningKeys:",
      "  - " + "a".repeat(64),
      "CurrentVersion: 1.0.0",
      "  - " + "b".repeat(64),
    ].join("\n");
    expect(signingKeys(doc)).toEqual(["a".repeat(64)]);
  });

  it("reads the canonical scalar form fdroidserver emits for one key", () => {
    const k = "c".repeat(64);
    expect(signingKeys(`AllowedAPKSigningKeys: ${k}\n`)).toEqual([k]);
    expect(signingKeys(`AllowedAPKSigningKeys:\n  - ${k}\n`)).toEqual([k]);
  });

  it("lower-cases whichever form it reads", () => {
    const k = "A".repeat(64);
    expect(signingKeys(`AllowedAPKSigningKeys: ${k}\n`)).toEqual(["a".repeat(64)]);
  });

  it("returns nothing when the field is absent", () => {
    expect(signingKeys("Categories:\n  - Science & Education\n")).toEqual([]);
  });
});
