import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { errorInfo } from "../src/lib/errors.js";
import { extractTokens, renderErrorPage } from "./generate-error-pages.mjs";

const css = readFileSync(fileURLToPath(new URL("../src/app.css", import.meta.url)), "utf8");
const tokens = extractTokens(css);
const html = renderErrorPage(errorInfo(500), tokens);

describe("static edge error page", () => {
  it("extracts both light and dark design tokens from app.css", () => {
    expect(tokens.light).toContain("--paper");
    expect(tokens.light).toContain("--ink");
    // The dark scheme genuinely differs from the light one (proves the media block was captured).
    expect(tokens.dark).not.toBe(tokens.light);
    expect(tokens.dark).toContain("--paper");
  });

  it("renders the shared 5xx copy, so it can never drift from the in-app page", () => {
    const info = errorInfo(500);
    expect(html).toContain(info.title);
    expect(html).toContain(info.lede);
    expect(html).toContain("how"); // the wordmark
  });

  it("is fully self-contained — safe to serve when the origin is unreachable", () => {
    // No external resource references of any kind: an origin-down page must fetch nothing.
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/\bsrc=/i);
    expect(html).not.toMatch(/url\(/i);
  });

  it("carries the design tokens inline rather than linking a stylesheet", () => {
    expect(html).toContain(":root {");
    expect(html).toContain("prefers-color-scheme: dark");
  });
});
