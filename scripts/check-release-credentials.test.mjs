import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import {
  CREDENTIALS,
  MAIN_ONLY,
  excludesPullRequests,
  jobCondition,
  jobEnvironment,
  parseWorkflow,
  secretUses,
  verdict,
} from "./check-release-credentials.mjs";

const dir = new URL("../.github/workflows/", import.meta.url);
const committed = readdirSync(dir)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ path: `.github/workflows/${f}`, text: readFileSync(new URL(f, dir), "utf8") }));
const file = (name) => committed.find((w) => w.path.endsWith(name));

const wf = (body, on = "on:\n  workflow_dispatch:\n") =>
  `name: t\n${on}permissions:\n  contents: read\njobs:\n${body}`;

describe("parseWorkflow / jobEnvironment / jobCondition", () => {
  it("splits jobs by two-space headers and reads both environment forms", () => {
    const { jobs } = parseWorkflow(
      wf(
        "  a:\n    environment: play-store\n    steps: []\n" +
          "  b:\n    environment:\n      name: 'ios-build'\n      deployment: false\n    steps: []\n" +
          "  c:\n    steps: []\n",
      ),
    );
    expect(jobs.map((j) => j.id)).toEqual(["a", "b", "c"]);
    expect(jobs.map((j) => jobEnvironment(j.body))).toEqual(["play-store", "ios-build", null]);
  });

  it("reads single-line and block if conditions", () => {
    const { jobs } = parseWorkflow(
      wf("  a:\n    if: x == 1\n    steps: []\n  b:\n    if: |\n      y == 2\n    steps: []\n"),
    );
    expect(jobCondition(jobs[0].body)).toBe("x == 1");
    expect(jobCondition(jobs[1].body)).toContain("y == 2");
  });

  it("collects the on: block so pull_request triggers are visible", () => {
    expect(parseWorkflow(wf("  a:\n    steps: []\n", "on:\n  pull_request:\n")).on).toMatch(
      /pull_request/,
    );
  });
});

describe("verdict — committed workflows", () => {
  it("passes on the repository's workflows", () => {
    expect(verdict(committed)).toEqual({ ok: true, errors: [] });
  });

  it("fails when the android build job loses its environment (mutation)", () => {
    const android = file("android-release.yml");
    const mutated = android.text.replace(
      "    environment:\n      name: android-build\n      deployment: false\n    outputs:",
      "    outputs:",
    );
    expect(mutated).not.toBe(android.text);
    const r = verdict([{ path: android.path, text: mutated }]);
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(
      /job "build" reads ANDROID_UPLOAD_KEYSTORE in no environment/,
    );
  });

  it("fails when iOS submit moves to the build environment (mutation)", () => {
    const ios = file("ios-submit.yml");
    const mutated = ios.text.replace("environment: app-store", "environment: android-build");
    expect(mutated).not.toBe(ios.text);
    expect(verdict([{ path: ios.path, text: mutated }]).errors.join("\n")).toMatch(
      /job "submit" reads ASC_KEY_ID in environment "android-build"/,
    );
  });

  it("fails when live-versions stops skipping pull requests (mutation)", () => {
    const deploy = file("deploy.yml");
    const mutated = deploy.text.replace(
      "    if: github.event_name != 'pull_request' && github.ref == 'refs/heads/main'",
      "    if: github.event_name != 'pull_request' || github.ref == 'refs/heads/main'",
    );
    expect(mutated).not.toBe(deploy.text);
    expect(verdict([{ path: deploy.path, text: mutated }]).errors.join("\n")).toMatch(
      /job "live-versions" uses main-only environment "android-build" but its if: does not exclude pull_request/,
    );
  });
});

describe("verdict — rules", () => {
  it("flags a credential read with no environment", () => {
    const r = verdict([
      {
        path: "w.yml",
        text: wf("  a:\n    steps:\n      - env:\n          K: ${{ secrets.ASC_API_KEY_P8 }}\n"),
      },
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/ASC_API_KEY_P8 in no environment — allowed: ios-build, app-store/);
  });

  it("flags a credential at workflow level", () => {
    const text = `name: t\non:\n  workflow_dispatch:\nenv:\n  K: \${{ secrets.FDROID_KEYSTORE }}\njobs:\n  a:\n    steps: []\n`;
    expect(verdict([{ path: "w.yml", text }]).errors[0]).toMatch(
      /FDROID_KEYSTORE referenced outside a job/,
    );
  });

  it("flags secrets: inherit", () => {
    const text = wf(
      "  a:\n    environment: play-store\n    uses: ./.github/workflows/x.yml\n    secrets: inherit\n" +
        "  b:\n    environment: play-store\n    steps:\n      - env:\n          K: ${{ secrets.PLAY_SERVICE_ACCOUNT_JSON }}\n",
    );
    expect(verdict([{ path: "w.yml", text }]).errors.join("\n")).toMatch(/secrets: inherit/);
  });

  it("flags a main-only environment in a pull_request workflow unless the job skips PRs", () => {
    const job = (cond) =>
      `  a:\n${cond}    environment:\n      name: android-build\n      deployment: false\n    steps:\n      - env:\n          K: \${{ secrets.PLAY_SERVICE_ACCOUNT_JSON }}\n`;
    const on = "on:\n  push:\n  pull_request:\n";
    expect(verdict([{ path: "w.yml", text: wf(job(""), on) }]).ok).toBe(false);
    expect(
      verdict([
        { path: "w.yml", text: wf(job("    if: github.event_name != 'pull_request'\n"), on) },
      ]),
    ).toEqual({ ok: true, errors: [] });
  });

  it("ignores unregistered secrets and commented references", () => {
    const text = wf(
      "  a:\n    environment: play-store\n    steps:\n      # ${{ secrets.ASC_KEY_ID }}\n" +
        "      - env:\n          T: ${{ secrets.CLOUDFLARE_API_TOKEN }}\n          K: ${{ secrets.PLAY_SERVICE_ACCOUNT_JSON }}\n",
    );
    expect(verdict([{ path: "w.yml", text }])).toEqual({ ok: true, errors: [] });
  });

  it("fails closed on no workflows or no registered credential", () => {
    expect(verdict([]).ok).toBe(false);
    expect(verdict([{ path: "w.yml", text: wf("  a:\n    steps: []\n") }]).errors).toEqual([
      "no registered credential referenced by any workflow (fail-closed)",
    ]);
  });

  it("registers only main-only or play-share environments", () => {
    for (const envs of Object.values(CREDENTIALS)) {
      for (const env of envs) expect(MAIN_ONLY.has(env) || env === "play-share").toBe(true);
    }
  });
});

describe("verdict — bypass attempts", () => {
  const step = (expr) => `    steps:\n      - env:\n          K: \${{ ${expr} }}\n`;
  const job = (head, expr, id = "a") => `  ${id}:\n${head}${step(expr)}`;
  const errorsOf = (text) => verdict([{ path: "w.yml", text }]).errors.join("\n");

  it("compares secret names case-insensitively", () => {
    expect(errorsOf(wf(job("", "secrets.asc_api_key_p8")))).toMatch(
      /ASC_API_KEY_P8 in no environment/,
    );
    expect(errorsOf(wf(job("", "SECRETS.Asc_Key_Id")))).toMatch(/ASC_KEY_ID in no environment/);
  });

  it("compares environment names case-insensitively", () => {
    expect(
      verdict([
        { path: "w.yml", text: wf(job("    environment: App-Store\n", "secrets.ASC_KEY_ID")) },
      ]).ok,
    ).toBe(true);
  });

  it("reads bracket lookups", () => {
    expect(errorsOf(wf(job("", "secrets['FDROID_KEYSTORE']")))).toMatch(
      /FDROID_KEYSTORE in no environment/,
    );
    expect(errorsOf(wf(job("", 'secrets[ "R2_ACCESS_KEY_ID" ]')))).toMatch(
      /R2_ACCESS_KEY_ID in no environment/,
    );
  });

  it("fails on the whole secrets object or a computed index", () => {
    const text = wf(
      job("    environment: play-store\n", "toJSON(secrets)") +
        job("    environment: play-store\n", "secrets[format('{0}', 'ASC_KEY_ID')]", "b") +
        job("    environment: play-store\n", "secrets.PLAY_SERVICE_ACCOUNT_JSON", "c"),
    );
    const errors = errorsOf(text);
    expect(errors).toMatch(/job "a" uses secrets without a literal name: toJSON\(secrets\)/);
    expect(errors).toMatch(/job "b" uses secrets without a literal name/);
  });

  it("finds secrets in an expression split across lines and in a brace-less if:", () => {
    const multi = wf(
      `  a:\n    steps:\n      - env:\n          K: \${{\n            secrets.ASC_KEY_ID }}\n`,
    );
    expect(errorsOf(multi)).toMatch(/ASC_KEY_ID in no environment/);
    const cond = wf(
      `  a:\n    environment: play-store\n    steps:\n      - if: toJSON(secrets) != ''\n        run: x\n      - env:\n          K: \${{ secrets.PLAY_SERVICE_ACCOUNT_JSON }}\n`,
    );
    expect(errorsOf(cond)).toMatch(/without a literal name/);
  });

  it("does not mistake a property named secrets for the context", () => {
    expect(secretUses("if: steps.secrets.outputs.ready == 'true'").bare).toEqual([]);
  });

  it("accepts quoted job ids and trailing comments on headers", () => {
    const text = wf(
      `  "a": # quoted\n${step("secrets.ASC_KEY_ID")}  'b':\n    environment: app-store # gated\n${step("secrets.ASC_KEY_ID")}`,
    );
    const { jobs, problems } = parseWorkflow(text);
    expect(problems).toEqual([]);
    expect(jobs.map((j) => j.id)).toEqual(["a", "b"]);
    expect(errorsOf(text)).toMatch(/job "a" reads ASC_KEY_ID in no environment/);
    expect(errorsOf(text)).not.toMatch(/job "b"/);
  });

  it("fails closed on a jobs block it cannot read", () => {
    expect(errorsOf(wf(""))).toMatch(/jobs block yields no jobs/);
    expect(errorsOf("name: t\non: push\njobs: { a: { steps: [] } }\n")).toMatch(
      /jobs is not a block mapping/,
    );
    expect(errorsOf(wf(`   a:\n${step("secrets.ASC_KEY_ID")}`))).toMatch(
      /unrecognised indentation in jobs/,
    );
    expect(
      errorsOf(wf(`  a:\n      environment: app-store\n${step("secrets.ASC_KEY_ID")}`)),
    ).toMatch(/not indented by four/);
    expect(errorsOf(wf(`  a b:\n${step("secrets.ASC_KEY_ID")}`))).toMatch(
      /unrecognised job header/,
    );
    expect(errorsOf("name: t\non: push\n")).toMatch(/no jobs block/);
  });

  it("reads a flow-mapping environment", () => {
    expect(jobEnvironment("    environment: { name: ios-build, deployment: false }")).toBe(
      "ios-build",
    );
    expect(jobEnvironment("    environment: {deployment: false, name: 'app-store'}")).toBe(
      "app-store",
    );
    expect(jobEnvironment("    environment: { deployment: false }")).toBe("");
    expect(
      verdict([
        {
          path: "w.yml",
          text: wf(
            job("    environment: { name: ios-build, deployment: false }\n", "secrets.ASC_KEY_ID"),
          ),
        },
      ]).ok,
    ).toBe(true);
  });

  it("only accepts a pull-request exclusion that holds for the whole condition", () => {
    expect(excludesPullRequests("github.event_name != 'pull_request'")).toBe(true);
    expect(excludesPullRequests("${{ github.ref == 'refs/heads/main' && always() }}")).toBe(true);
    expect(excludesPullRequests("github.event_name != 'pull_request' || true")).toBe(false);
    expect(excludesPullRequests("(github.event_name != 'pull_request') || true")).toBe(false);
    expect(excludesPullRequests("!(github.event_name != 'pull_request' && x)")).toBe(false);
    expect(excludesPullRequests("contains('github.event_name != pull_request', x)")).toBe(false);
    expect(excludesPullRequests("x == 'github.event_name != \\'pull_request\\''")).toBe(false);
    expect(excludesPullRequests("")).toBe(false);
  });
});
