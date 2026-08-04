import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  PHASES,
  SRCLIB_REPOS,
  phaseCommands,
  shellLine,
  signingKeys,
  srclibRefs,
  subdir,
} from "./fdroid-recipe-build.mjs";

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

  it("substitutes srclib checkout paths", () => {
    const line = shellLine(["go build -C $$esbuild$$ ./cmd/esbuild"], {
      version: "1.0.0",
      code: "1",
      srclibs: { esbuild: "/srclib/esbuild" },
    });
    expect(line).toBe("go build -C /srclib/esbuild ./cmd/esbuild");
  });
});

describe("srclibs", () => {
  it("reads every pin, and each has a repo mapping mirroring fdroiddata's srclibs/", () => {
    const libs = srclibRefs(recipe);
    expect(libs.length).toBeGreaterThan(0);
    for (const { name, ref } of libs) {
      expect(SRCLIB_REPOS[name], `srclib ${name} needs a SRCLIB_REPOS entry`).toBeDefined();
      expect(ref).toMatch(/^v\d/);
    }
  });

  it("only ever references declared srclibs from phase commands", () => {
    const declared = new Set(srclibRefs(recipe).map(({ name }) => name));
    for (const phase of PHASES) {
      for (const cmd of phaseCommands(recipe, phase)) {
        for (const [, name] of cmd.matchAll(/\$\$(?!VERSION|VERCODE)([A-Za-z0-9_-]+)\$\$/g)) {
          expect(declared.has(name), `${phase}: "${cmd}" references undeclared srclib`).toBe(true);
        }
      }
    }
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
    const pnpmCmds = phaseCommands(recipe, "build").filter((cmd) => /(^|\s)pnpm\s/.test(cmd));
    expect(pnpmCmds.length).toBeGreaterThan(0);
    for (const cmd of pnpmCmds) {
      expect(cmd).toContain("pnpm -C ../../../..");
    }
  });

  // packages/*/dist is gitignored, so a fresh checkout must build workspace dependencies first —
  // then the app bundle (build:app, no website asset generators) with the source-built esbuild.
  it("builds workspace dependencies, then the app bundle with the srclib esbuild", () => {
    const build = phaseCommands(recipe, "build").join("; ");
    expect(build).toContain("--filter @how2vote/web^... build");
    expect(build).toContain("--filter @how2vote/web build:app");
    expect(build).toContain("ESBUILD_BINARY_PATH=$$esbuild$$/esbuild");
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
