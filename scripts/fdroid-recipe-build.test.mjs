import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { PHASES, phaseCommands, shellLine, subdir } from "./fdroid-recipe-build.mjs";

const recipe = readFileSync(new URL("../docs/fdroid/au.how2vote.app.yml", import.meta.url), "utf8");

describe("recipe phase extraction", () => {
  it("reads every phase the buildserver executes", () => {
    for (const phase of PHASES) expect(phaseCommands(recipe, phase).length).toBeGreaterThan(0);
    expect(subdir(recipe)).toBe("apps/mobile/android");
  });

  it("undoes YAML line folding so a wrapped command stays one command", () => {
    const folded = [
      "    build:",
      "      - cd ../../.. && pnpm --filter",
      "        @how2vote/web build",
      "    gradle:",
    ].join("\n");
    expect(phaseCommands(folded, "build")).toEqual([
      "cd ../../.. && pnpm --filter @how2vote/web build",
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
  // fdroidserver runs a phase as ONE shell rooted at subdir, so a bare `cd` leaks into the next
  // command. Every command that changes directory must be a subshell.
  it("wraps directory-changing commands in subshells", () => {
    for (const phase of PHASES) {
      for (const cmd of phaseCommands(recipe, phase)) {
        if (cmd.includes("cd ")) {
          expect(cmd.startsWith("("), `${phase}: "${cmd}" must be a subshell`).toBe(true);
          expect(cmd.endsWith(")")).toBe(true);
        }
      }
    }
  });

  // packages/*/dist is gitignored, so a fresh checkout must build workspace dependencies first.
  it("builds the web package with its workspace dependencies", () => {
    const build = phaseCommands(recipe, "build").join("; ");
    expect(build).toContain("--filter @how2vote/web...");
  });
});
