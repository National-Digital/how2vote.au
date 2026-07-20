import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { verdict, verifyCommitted, verifyDeploy, isPlaceholder } from "./check-infra-config.mjs";

/** A minimal, well-formed policy mirroring the real config-policy.json shape. */
const policy = () => ({
  schemaVersion: 1,
  provider: "cloudflare",
  wranglerConfig: "apps/web/wrangler.toml",
  placeholderPatterns: ["REPLACE_WITH_", "CHANGE_ME", "PLACEHOLDER", "<", "0000000000000000"],
  requiredProductionIds: [
    {
      id: "research-d1-database",
      wranglerKey: "database_id",
      placeholder: "REPLACE_WITH_D1_DATABASE_ID",
      envVar: "CF_D1_DATABASE_ID",
    },
    {
      id: "research-kv-nonces",
      wranglerKey: "id",
      placeholder: "REPLACE_WITH_KV_NAMESPACE_ID",
      envVar: "CF_KV_RESEARCH_NONCES_ID",
    },
    {
      id: "cloudflare-account",
      wranglerKey: null,
      placeholder: null,
      envVar: "CLOUDFLARE_ACCOUNT_ID",
    },
  ],
  secretReferences: [
    { name: "CLOUDFLARE_API_TOKEN", store: "github-actions-secret" },
    { name: "RESEARCH_TOKEN_SECRET", store: "cloudflare-secret" },
  ],
  previewIsolation: {
    rules: [
      {
        resource: "research-d1-database",
        productionEnvVar: "CF_D1_DATABASE_ID",
        previewEnvVar: "CF_D1_PREVIEW_DATABASE_ID",
      },
    ],
  },
});

const CLEAN_WRANGLER = `name = "how2vote-au"
# database_id is injected at deploy from CF_D1_DATABASE_ID
[[d1_databases]]
binding = "RESEARCH_DB"
database_id = "REPLACE_WITH_D1_DATABASE_ID"

[[kv_namespaces]]
binding = "RESEARCH_NONCES"
id = "REPLACE_WITH_KV_NAMESPACE_ID"
`;

// verdict() returns { errors }, while verifyCommitted/verifyDeploy return a bare string[].
const hasError = (res, needle) =>
  (Array.isArray(res) ? res : res.errors).some((e) => e.includes(needle));

describe("isPlaceholder", () => {
  it("treats empty / placeholder values as placeholders", () => {
    const p = policy().placeholderPatterns;
    expect(isPlaceholder("", p)).toBe(true);
    expect(isPlaceholder(undefined, p)).toBe(true);
    expect(isPlaceholder("REPLACE_WITH_D1_DATABASE_ID", p)).toBe(true);
    expect(isPlaceholder("0000000000000000", p)).toBe(true);
  });
  it("treats a real id as not a placeholder", () => {
    expect(isPlaceholder("deadbeefdeadbeefdeadbeefdeadbeef", policy().placeholderPatterns)).toBe(
      false,
    );
  });
});

describe("verdict — policy structure", () => {
  it("fails a non-object policy", () => {
    expect(verdict({ policy: null }).ok).toBe(false);
  });
  it("fails when a secret reference carries a value", () => {
    const pol = policy();
    pol.secretReferences[0].value = "leak";
    expect(
      hasError(
        verdict({ policy: pol, wranglerText: CLEAN_WRANGLER }),
        'must not contain a "value"',
      ),
    ).toBe(true);
  });
});

describe("verifyCommitted — public-repo-safe config", () => {
  it("passes on a clean placeholder-only wrangler.toml", () => {
    expect(verdict({ mode: "committed", policy: policy(), wranglerText: CLEAN_WRANGLER }).ok).toBe(
      true,
    );
  });

  it("FAILS when a live 32-hex id replaced a placeholder", () => {
    const leaked = CLEAN_WRANGLER.replace(
      "REPLACE_WITH_D1_DATABASE_ID",
      "deadbeefdeadbeefdeadbeefdeadbeef",
    );
    const res = verdict({ mode: "committed", policy: policy(), wranglerText: leaked });
    expect(res.ok).toBe(false);
    // Both the placeholder-missing rule and the hex-id-leak rule should trip.
    expect(hasError(res, "no longer holds its placeholder")).toBe(true);
    expect(hasError(res, "id-shaped literal")).toBe(true);
  });

  it("FAILS when a secret is assigned a value in committed config", () => {
    const withSecret = CLEAN_WRANGLER + '\nRESEARCH_TOKEN_SECRET = "s3cr3t"\n';
    expect(hasError(verifyCommitted(policy(), withSecret), "must never be assigned a value")).toBe(
      true,
    );
  });

  it("fails closed on a missing wrangler.toml", () => {
    expect(
      hasError(
        verdict({ mode: "committed", policy: policy(), wranglerText: "" }),
        "missing or unreadable",
      ),
    ).toBe(true);
  });

  it("ignores a hex id that appears only inside a comment", () => {
    const commented = CLEAN_WRANGLER + "\n# example only: deadbeefdeadbeefdeadbeefdeadbeef\n";
    expect(verifyCommitted(policy(), commented)).toEqual([]);
  });
});

describe("verifyDeploy — fail closed on missing / placeholder ids", () => {
  const goodEnv = {
    CF_D1_DATABASE_ID: "11111111111111111111111111111111",
    CF_KV_RESEARCH_NONCES_ID: "22222222222222222222222222222222",
    CLOUDFLARE_ACCOUNT_ID: "33333333333333333333333333333333",
  };

  it("passes when every required id is a real value", () => {
    expect(verdict({ mode: "deploy", policy: policy(), env: goodEnv }).ok).toBe(true);
  });

  it("FAILS when a required id is unset", () => {
    const env = { ...goodEnv };
    delete env.CF_D1_DATABASE_ID;
    const res = verdict({ mode: "deploy", policy: policy(), env });
    expect(res.ok).toBe(false);
    expect(hasError(res, "CF_D1_DATABASE_ID")).toBe(true);
    expect(hasError(res, "refusing to deploy")).toBe(true);
  });

  it("FAILS when a required id is still a placeholder", () => {
    const env = { ...goodEnv, CF_KV_RESEARCH_NONCES_ID: "REPLACE_WITH_KV_NAMESPACE_ID" };
    expect(hasError(verifyDeploy(policy(), env), "CF_KV_RESEARCH_NONCES_ID")).toBe(true);
  });

  it("FAILS when a preview id equals its production counterpart", () => {
    const env = { ...goodEnv, CF_D1_PREVIEW_DATABASE_ID: goodEnv.CF_D1_DATABASE_ID };
    expect(hasError(verifyDeploy(policy(), env), "preview data must be isolated")).toBe(true);
  });

  it("passes when preview id differs from production", () => {
    const env = { ...goodEnv, CF_D1_PREVIEW_DATABASE_ID: "44444444444444444444444444444444" };
    expect(verifyDeploy(policy(), env)).toEqual([]);
  });
});

describe("the real committed config", () => {
  it("passes committed mode over the real config-policy + wrangler.toml", () => {
    const root = new URL("..", import.meta.url);
    const realPolicy = JSON.parse(
      readFileSync(new URL("infra/providers/cloudflare/config-policy.json", root), "utf8"),
    );
    const wranglerText = readFileSync(new URL("apps/web/wrangler.toml", root), "utf8");
    const res = verdict({ mode: "committed", policy: realPolicy, wranglerText });
    expect(res.errors).toEqual([]);
  });
});
