import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import {
  CREDENTIALS,
  MAIN_ONLY,
  excludesUntrustedEvents,
  jobCondition,
  jobEnvironment,
  parseWorkflow,
  passedSecrets,
  secretUses,
  verdict,
  workflowTriggers,
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
      /job "live-versions" uses main-only environment "android-build" but its if: does not exclude untrusted triggers \(pull_request\)/,
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

  it("only accepts an exclusion that holds for the whole condition", () => {
    const pr = new Set(["pull_request"]);
    expect(excludesUntrustedEvents("github.event_name != 'pull_request'", pr)).toBe(true);
    expect(excludesUntrustedEvents("${{ github.event_name == 'push' && always() }}", pr)).toBe(
      true,
    );
    expect(excludesUntrustedEvents("github.ref == 'refs/heads/main'", pr)).toBe(false);
    expect(excludesUntrustedEvents("github.event_name == 'pull_request'", pr)).toBe(false);
    expect(excludesUntrustedEvents("github.event_name != 'pull_request' || true", pr)).toBe(false);
    expect(excludesUntrustedEvents("(github.event_name != 'pull_request') || true", pr)).toBe(
      false,
    );
    expect(excludesUntrustedEvents("!(github.event_name != 'pull_request' && x)", pr)).toBe(false);
    expect(excludesUntrustedEvents("contains('github.event_name != pull_request', x)", pr)).toBe(
      false,
    );
    expect(excludesUntrustedEvents("x == 'github.event_name != \\'pull_request\\''", pr)).toBe(
      false,
    );
    expect(excludesUntrustedEvents("", pr)).toBe(false);
    const prt = new Set(["pull_request", "pull_request_target"]);
    expect(excludesUntrustedEvents("github.event_name != 'pull_request'", prt)).toBe(false);
    expect(excludesUntrustedEvents("github.event_name == 'workflow_dispatch'", prt)).toBe(true);
  });

  it("reads trigger names from every on: layout and fails closed otherwise", () => {
    const t = (on) => workflowTriggers(on) && [...workflowTriggers(on)];
    expect(t("on: push")).toEqual(["push"]);
    expect(t("on: [push, 'workflow_run']")).toEqual(["push", "workflow_run"]);
    expect(t("on:\n  - issue_comment\n  - push")).toEqual(["issue_comment", "push"]);
    expect(t("'on':\n  pull_request_target:\n    types: [opened]\n  schedule:")).toEqual([
      "pull_request_target",
      "schedule",
    ]);
    expect(t("on: { push: {} }")).toBe(null);
    expect(t("on:\n   push:")).toBe(null);
    expect(t("")).toBe(null);
    expect(
      verdict([{ path: "w.yml", text: `name: t\non: { push: {} }\njobs:\n  a:\n    steps: []\n` }])
        .errors[0],
    ).toMatch(/unrecognised on: block/);
  });
});

describe("verdict — reusable-workflow pass-through", () => {
  const callee = (head) =>
    `name: c\non:\n  workflow_call:\n    secrets:\n      ASC_KEY_ID:\n        required: false\njobs:\n  submit:\n${head}    steps:\n      - env:\n          K: \${{ secrets.ASC_KEY_ID }}\n`;
  const caller = (secrets, extra = "") =>
    wf(`  submit:\n    uses: ./.github/workflows/c.yml\n${extra}    secrets:\n${secrets}`);
  const pass = "      ASC_KEY_ID: ${{ secrets.ASC_KEY_ID }}\n";
  const run = (callerText, calleeText) =>
    verdict([
      { path: ".github/workflows/w.yml", text: callerText },
      { path: ".github/workflows/c.yml", text: calleeText },
    ]);

  it("passes the committed release and catch-up callers of ios-submit.yml", () => {
    const sub = file("ios-submit.yml");
    for (const name of ["ios-release.yml", "ios-submission-catch-up.yml"]) {
      const w = file(name);
      expect(w.text).toMatch(/uses: \.\/\.github\/workflows\/ios-submit\.yml/);
      expect(passedSecrets(w.text.split(/\n {2}submit:\n/)[1]).passed).toEqual([
        "ASC_KEY_ID",
        "ASC_ISSUER_ID",
        "ASC_API_KEY_P8",
      ]);
      expect(verdict([w, sub])).toEqual({ ok: true, errors: [] });
    }
  });

  it("fails a committed caller when ios-submit.yml is missing or loses its environment (mutation)", () => {
    const release = file("ios-release.yml");
    expect(verdict([release]).errors.join("\n")).toMatch(
      /passes ASC_KEY_ID to \.\/\.github\/workflows\/ios-submit\.yml, not a workflow in this repository/,
    );
    const sub = file("ios-submit.yml");
    const mutated = sub.text.replace("    environment: app-store\n", "");
    expect(mutated).not.toBe(sub.text);
    expect(verdict([release, { path: sub.path, text: mutated }]).errors.join("\n")).toMatch(
      /passes ASC_KEY_ID to \.github\/workflows\/ios-submit\.yml job "submit" in no environment/,
    );
  });

  it("accepts a named pass-through to a job in an allowed environment", () => {
    expect(run(caller(pass), callee("    environment: app-store\n"))).toEqual({
      ok: true,
      errors: [],
    });
  });

  it("fails a pass-through to a job with no or the wrong environment", () => {
    expect(run(caller(pass), callee("")).errors.join("\n")).toMatch(
      /passes ASC_KEY_ID to \.github\/workflows\/c\.yml job "submit" in no environment/,
    );
    expect(run(caller(pass), callee("    environment: play-store\n")).errors.join("\n")).toMatch(
      /job "submit" in environment "play-store"/,
    );
  });

  it("fails a pass-through that no called job reads, or to a workflow outside the repository", () => {
    const unread = callee("    environment: app-store\n").replace(
      "secrets.ASC_KEY_ID",
      "secrets.X",
    );
    expect(run(caller(pass), unread).errors.join("\n")).toMatch(/which no job reads/);
    const remote = wf(`  submit:\n    uses: o/r/.github/workflows/c.yml@v1\n    secrets:\n${pass}`);
    expect(run(remote, callee("    environment: app-store\n")).errors.join("\n")).toMatch(
      /not a workflow in this repository/,
    );
  });

  it("fails a renamed, computed or flow-mapped pass-through", () => {
    const ok = callee("    environment: app-store\n");
    expect(run(caller("      OTHER: ${{ secrets.ASC_KEY_ID }}\n"), ok).errors.join("\n")).toMatch(
      /secrets entry is not NAME/,
    );
    expect(
      run(caller("      ASC_KEY_ID: ${{ secrets.ASC_KEY_ID || 'x' }}\n"), ok).errors.join("\n"),
    ).toMatch(/secrets entry is not NAME/);
    const flow = wf(
      "  submit:\n    uses: ./.github/workflows/c.yml\n    secrets: { ASC_KEY_ID: ${{ secrets.ASC_KEY_ID }} }\n",
    );
    expect(run(flow, ok).errors.join("\n")).toMatch(/secrets is not a block mapping/);
  });

  it("still fails a credential passed as an input to a called workflow", () => {
    const viaInput = caller(pass, "    with:\n      key: ${{ secrets.ASC_API_KEY_P8 }}\n");
    expect(run(viaInput, callee("    environment: app-store\n")).errors.join("\n")).toMatch(
      /job "submit" reads ASC_API_KEY_P8 in no environment/,
    );
  });

  it("fails a pass-through or read under an untrusted trigger unless the job pins a safe event", () => {
    const ok = callee("    environment: ios-build\n");
    const job = (on, cond) =>
      `name: t\non:\n  ${on}:\n  workflow_dispatch:\njobs:\n  submit:\n${cond}    uses: ./.github/workflows/c.yml\n    secrets:\n${pass}`;
    for (const on of ["pull_request_target", "workflow_run", "issue_comment"]) {
      for (const cond of [
        "",
        "    if: github.event_name != 'pull_request'\n",
        "    if: github.ref == 'refs/heads/main'\n",
      ]) {
        expect(run(job(on, cond), ok).errors.join("\n")).toMatch(
          new RegExp(
            `passes credentials but its if: does not exclude untrusted triggers \\(${on}\\)`,
          ),
        );
      }
      expect(run(job(on, "    if: github.event_name == 'workflow_dispatch'\n"), ok)).toEqual({
        ok: true,
        errors: [],
      });
    }
    const read = (on, cond) =>
      wf(
        `  a:\n${cond}    environment: play-share\n    steps:\n      - env:\n          K: \${{ secrets.PLAY_SHARE_KEYSTORE }}\n`,
        `on:\n  ${on}:\n`,
      );
    expect(verdict([{ path: "w.yml", text: read("workflow_run", "") }]).errors.join("\n")).toMatch(
      /job "a" reads PLAY_SHARE_KEYSTORE but its if: does not exclude untrusted triggers \(workflow_run\)/,
    );
    expect(
      verdict([
        { path: "w.yml", text: read("issue_comment", "    if: github.event_name == 'push'\n") },
      ]),
    ).toEqual({ ok: true, errors: [] });
  });

  it("still fails secrets: inherit to an environment-gated called workflow", () => {
    const inherit = wf("  submit:\n    uses: ./.github/workflows/c.yml\n    secrets: inherit\n");
    expect(run(inherit, callee("    environment: app-store\n")).errors.join("\n")).toMatch(
      /secrets: inherit/,
    );
  });

  it("still fails a job without uses: that names the secret in a secrets: key", () => {
    const plain = wf(`  submit:\n    runs-on: x\n    secrets:\n${pass}    steps: []\n`);
    const r = run(plain, callee("    environment: app-store\n"));
    expect(r.errors.join("\n")).toMatch(/job "submit" reads ASC_KEY_ID in no environment/);
  });
});
