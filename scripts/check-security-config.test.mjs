import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { verdict } from "./check-security-config.mjs";

const REQUIRED = [
  "Strict-Transport-Security",
  "X-Content-Type-Options: nosniff",
  "X-Frame-Options: DENY",
  "Referrer-Policy",
  "Cross-Origin-Opener-Policy",
  "Permissions-Policy",
  "frame-ancestors 'none'",
];

const GOOD_HEADERS = `/*
  Content-Security-Policy: frame-ancestors 'none'; upgrade-insecure-requests
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: camera=()
`;

const CODEQL = `permissions:\n  contents: read\njobs:\n  a:\n    if: github.event.repository.visibility == 'public'\n    steps:\n      - uses: github/codeql-action/analyze@abc\n`;
const DEP_REVIEW = `permissions:\n  contents: read\njobs:\n  r:\n    if: github.event.repository.visibility == 'public'\n    steps:\n      - uses: actions/dependency-review-action@abc\n        with:\n          fail-on-severity: high\n`;
const SECRETS = `permissions:\n  contents: read\njobs:\n  s:\n    steps:\n      - run: ./gitleaks detect --redact --log-opts=--all\n`;

const goodWorkflows = () => [
  { path: "codeql.yml", text: CODEQL },
  { path: "dependency-review.yml", text: DEP_REVIEW },
  { path: "ci.yml", text: SECRETS },
];

const base = () => ({
  headers: GOOD_HEADERS,
  requiredResponseHeaders: REQUIRED,
  workflows: goodWorkflows(),
});
const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));

describe("verdict — happy path", () => {
  it("passes with good headers + gated workflows", () => {
    const res = verdict(base());
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });
});

describe("verdict — response headers", () => {
  it("fails when a required header is missing", () => {
    const input = base();
    input.headers = GOOD_HEADERS.replace("X-Frame-Options: DENY", "");
    expect(hasError(verdict(input), "X-Frame-Options")).toBe(true);
  });
  it("fails when the _headers file is unreadable", () => {
    const input = base();
    input.headers = null;
    expect(hasError(verdict(input), "missing or unreadable")).toBe(true);
  });
});

describe("verdict — code scanning", () => {
  it("fails when no CodeQL workflow is committed", () => {
    const input = base();
    input.workflows = input.workflows.filter((w) => w.path !== "codeql.yml");
    expect(hasError(verdict(input), "no CodeQL")).toBe(true);
  });
  it("fails when CodeQL is not visibility-gated", () => {
    const input = base();
    input.workflows.find((w) => w.path === "codeql.yml").text = CODEQL.replace(
      "if: github.event.repository.visibility == 'public'\n",
      "",
    );
    expect(hasError(verdict(input), "visibility-gated")).toBe(true);
  });
});

describe("verdict — dependency review", () => {
  it("fails when dependency review does not fail on high/critical", () => {
    const input = base();
    input.workflows.find((w) => w.path === "dependency-review.yml").text = DEP_REVIEW.replace(
      "fail-on-severity: high",
      "fail-on-severity: low",
    );
    expect(hasError(verdict(input), "fail on high or critical")).toBe(true);
  });
});

describe("verdict — secret scan is full-history", () => {
  it("fails when gitleaks does not scan all refs", () => {
    const input = base();
    input.workflows.find((w) => w.path === "ci.yml").text = SECRETS.replace(
      " --log-opts=--all",
      "",
    );
    expect(hasError(verdict(input), "all refs")).toBe(true);
  });
});

describe("verdict — least-privilege permissions", () => {
  it("fails a workflow with no top-level permissions block", () => {
    const input = base();
    input.workflows.push({ path: "x.yml", text: "jobs:\n  a:\n    steps: []\n" });
    expect(hasError(verdict(input), "least-privilege")).toBe(true);
  });
});

describe("the real committed config", () => {
  it("passes over the real _headers + workflows", () => {
    const root = new URL("..", import.meta.url);
    const headers = readFileSync(new URL("apps/web/static/_headers", root), "utf8");
    const requiredResponseHeaders = JSON.parse(
      readFileSync(new URL("docs/legal/security-register.json", root), "utf8"),
    ).requiredResponseHeaders;
    const listed = execFileSync("git", ["ls-files", ".github/workflows"], {
      cwd: fileURLToPath(root),
      encoding: "utf8",
    })
      .split("\n")
      .filter((p) => /\.ya?ml$/.test(p));
    const workflows = listed.map((p) => ({
      path: p,
      text: readFileSync(new URL(p, root), "utf8"),
    }));
    const res = verdict({ headers, requiredResponseHeaders, workflows });
    expect(res.errors).toEqual([]);
  });
});
