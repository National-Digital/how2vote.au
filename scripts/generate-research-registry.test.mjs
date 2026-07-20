import { describe, expect, it } from "vitest";
import {
  buildRegistryBody,
  buildRegistryFile,
  electionAllowlist,
  registryDigest,
} from "./generate-research-registry.mjs";

const dataset2025 = {
  parties: { parties: [{ key: "b_party" }, { key: "a_party" }, { key: "a_party" }] },
  questions: { questions: [{ id: 30 }, { id: 6 }, { id: 6 }, { id: -1 }, { id: 0 }] },
};

describe("electionAllowlist", () => {
  it("extracts sorted, de-duplicated party keys + positive proposition ids", () => {
    expect(electionAllowlist(dataset2025)).toEqual({
      parties: ["a_party", "b_party"],
      propositionIds: [6, 30],
    });
  });

  it("tolerates a missing/empty dataset", () => {
    expect(electionAllowlist(undefined)).toEqual({ parties: [], propositionIds: [] });
    expect(electionAllowlist({})).toEqual({ parties: [], propositionIds: [] });
  });
});

describe("buildRegistryBody + registryDigest", () => {
  const elections = [{ id: "2025" }, { id: "2019" }];
  const datasets = { 2025: dataset2025, 2019: {} };

  it("builds one entry per election id", () => {
    const body = buildRegistryBody(elections, datasets);
    expect(Object.keys(body.elections).sort()).toEqual(["2019", "2025"]);
    expect(body.elections["2025"].parties).toEqual(["a_party", "b_party"]);
  });

  it("produces a stable digest independent of key/array ordering", () => {
    const a = buildRegistryBody(elections, datasets);
    const b = buildRegistryBody([{ id: "2019" }, { id: "2025" }], datasets);
    expect(registryDigest(a)).toBe(registryDigest(b));
    expect(registryDigest(a)).toMatch(/^sha256-[0-9a-f]{64}$/);
  });

  it("the assembled file's integrity matches its own body", () => {
    const file = buildRegistryFile(elections, datasets);
    expect(file.integrity).toBe(
      registryDigest({ version: file.version, elections: file.elections }),
    );
  });
});
