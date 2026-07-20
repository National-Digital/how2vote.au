import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractConsoleCalls, verdict } from "./check-forbidden-log-fields.mjs";

const FIELDS = ["ip", "cf-connecting-ip", "userAgent", "contribution", "electorate"];

describe("extractConsoleCalls", () => {
  it("captures the argument text of each console call", () => {
    const calls = extractConsoleCalls(`console.log("a", b); console.info(x)`);
    expect(calls).toEqual([`"a", b`, "x"]);
  });

  it("balances nested parentheses", () => {
    const calls = extractConsoleCalls(`console.error(fn(g(1)), h)`);
    expect(calls).toEqual(["fn(g(1)), h"]);
  });

  it("ignores non-console calls", () => {
    expect(extractConsoleCalls(`logger.log(ip)`)).toEqual([]);
  });
});

describe("verdict — forbidden fields in log calls", () => {
  it("flags a bare identifier", () => {
    const files = [{ path: "f.ts", text: "console.log(ip);" }];
    expect(verdict({ files, forbiddenFields: FIELDS }).ok).toBe(false);
  });

  it("flags a property access", () => {
    const files = [{ path: "f.ts", text: "console.warn(req.userAgent);" }];
    expect(verdict({ files, forbiddenFields: FIELDS }).ok).toBe(false);
  });

  it("flags a hyphenated header key inside a string", () => {
    const files = [
      { path: "f.ts", text: `console.error(request.headers.get("cf-connecting-ip"));` },
    ];
    expect(verdict({ files, forbiddenFields: FIELDS }).ok).toBe(false);
  });

  it("flags the raw contribution being logged", () => {
    const files = [{ path: "f.ts", text: "console.log(contribution);" }];
    const res = verdict({ files, forbiddenFields: FIELDS });
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toContain("contribution");
  });
});

describe("verdict — precision (no false positives)", () => {
  it("does not trip on the letters of a field inside an unrelated word", () => {
    // "description" contains "ip"; "recipient" contains "ip"; must not match.
    const files = [{ path: "f.ts", text: `console.log("description", recipient, script);` }];
    expect(verdict({ files, forbiddenFields: FIELDS }).ok).toBe(true);
  });

  it("does not scan outside console calls", () => {
    const files = [{ path: "f.ts", text: "const ip = req.ip; sendToServer(ip);" }];
    expect(verdict({ files, forbiddenFields: FIELDS }).ok).toBe(true);
  });

  it("mirrors the real analytics DEV log (event name + params is fine)", () => {
    const files = [{ path: "a.ts", text: `console.info("[analytics]", name, params);` }];
    expect(verdict({ files, forbiddenFields: FIELDS }).ok).toBe(true);
  });
});

describe("verdict — fail-closed inputs", () => {
  it("fails on a missing files array", () => {
    expect(verdict({ forbiddenFields: FIELDS }).ok).toBe(false);
  });
  it("fails on an empty forbidden list", () => {
    expect(verdict({ files: [], forbiddenFields: [] }).ok).toBe(false);
  });
});

describe("the real runtime source", () => {
  it("has no forbidden field in any log call", () => {
    const root = new URL("..", import.meta.url);
    const register = JSON.parse(
      readFileSync(new URL("docs/legal/security-register.json", root), "utf8"),
    );
    const listed = execFileSync("git", ["ls-files", ...register.forbiddenLogScope], {
      cwd: fileURLToPath(root),
      encoding: "utf8",
    })
      .split("\n")
      .filter((p) => /\.(ts|tsx|js|mjs|cjs|svelte)$/.test(p) && !/\.(test|spec)\./.test(p));
    const files = listed.map((rel) => ({
      path: rel,
      text: readFileSync(new URL(rel, root), "utf8"),
    }));
    const res = verdict({ files, forbiddenFields: register.forbiddenLogFields });
    expect(res.errors).toEqual([]);
  });
});
