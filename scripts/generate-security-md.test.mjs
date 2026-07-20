import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BEGIN, END, compose, renderBlock } from "./generate-security-md.mjs";

const REGISTER = JSON.parse(
  readFileSync(new URL("../docs/legal/security-register.json", import.meta.url), "utf8"),
);
const SECURITY_MD = readFileSync(new URL("../SECURITY.md", import.meta.url), "utf8");

describe("renderBlock", () => {
  it("wraps the content in the markers", () => {
    const block = renderBlock(REGISTER);
    expect(block.startsWith(BEGIN)).toBe(true);
    expect(block.trimEnd().endsWith(END)).toBe(true);
  });

  it("renders every control's public statement", () => {
    const block = renderBlock(REGISTER);
    for (const c of REGISTER.controls) {
      expect(block).toContain(c.title);
      expect(block).toContain(c.publicStatement);
    }
  });

  it("states the vuln-gate policy", () => {
    expect(renderBlock(REGISTER)).toContain("block deployment");
  });
});

describe("compose", () => {
  it("throws when the markers are absent", () => {
    expect(() => compose(REGISTER, "no markers here")).toThrow(/markers/);
  });

  it("preserves hand-authored text outside the block", () => {
    const out = compose(REGISTER, SECURITY_MD);
    expect(out).toContain("## Reporting a vulnerability");
    expect(out).toContain("security.txt");
  });

  it("is idempotent — the committed SECURITY.md is already in sync", () => {
    expect(compose(REGISTER, SECURITY_MD)).toBe(SECURITY_MD);
  });
});
