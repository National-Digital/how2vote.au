import { describe, it, expect } from "vitest";
import { authHeaders, selectDeploymentsToDelete } from "./cleanup-cloudflare-preview.mjs";

describe("selectDeploymentsToDelete", () => {
  const deployments = [
    { id: "a", deployment_trigger: { metadata: { branch: "pr-123" } } },
    { id: "b", deployment_trigger: { metadata: { branch: "main" } } },
    { id: "c", deployment_trigger: { metadata: { branch: "pr-123" } } },
    { id: "d", deployment_trigger: { metadata: { branch: "pr-9" } } },
    { id: "e" }, // malformed record — no trigger metadata
  ];

  it("returns only the ids on the target branch", () => {
    expect(selectDeploymentsToDelete(deployments, "pr-123")).toEqual(["a", "c"]);
  });

  it("never matches the production branch when targeting a preview", () => {
    expect(selectDeploymentsToDelete(deployments, "pr-123")).not.toContain("b");
  });

  it("returns an empty list when nothing matches", () => {
    expect(selectDeploymentsToDelete(deployments, "pr-404")).toEqual([]);
  });

  it("tolerates records missing deployment_trigger", () => {
    expect(() => selectDeploymentsToDelete(deployments, "pr-9")).not.toThrow();
    expect(selectDeploymentsToDelete(deployments, "pr-9")).toEqual(["d"]);
  });
});

describe("authHeaders", () => {
  it("uses a bearer token when CLOUDFLARE_API_TOKEN is set", () => {
    expect(authHeaders({ CLOUDFLARE_API_TOKEN: "tok" })).toEqual({
      Authorization: "Bearer tok",
    });
  });

  it("throws when no credentials are present", () => {
    expect(() => authHeaders({})).toThrow(/CLOUDFLARE_API_TOKEN/);
  });
});
