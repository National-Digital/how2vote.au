import { describe, expect, it } from "vitest";
import { verify } from "./verify-aec-archive.mjs";

const SHA = "bdc0393d8448477bf187ac84473978330f776b5ea2ed6343f7eb891187263a09";
const record = {
  sources: [{ fileName: "AUS-March-2025-esri.zip", sha256: SHA }],
};

describe("verify — pinned checksum comparison", () => {
  it("passes when the local file matches the pinned checksum", () => {
    const res = verify(record, { "AUS-March-2025-esri.zip": SHA });
    expect(res.ok).toBe(true);
    expect(res.results[0].status).toBe("match");
  });

  it("skips (does not fail) when the file is absent locally", () => {
    const res = verify(record, { "AUS-March-2025-esri.zip": null });
    expect(res.ok).toBe(true);
    expect(res.results[0].status).toBe("absent");
  });

  it("fails when a present file does not match the pinned checksum", () => {
    const res = verify(record, { "AUS-March-2025-esri.zip": "0".repeat(64) });
    expect(res.ok).toBe(false);
    expect(res.results[0].status).toBe("mismatch");
  });

  it("ignores sources with nothing pinned yet", () => {
    const res = verify({ sources: [{ fileName: null, sha256: null }] }, {});
    expect(res.ok).toBe(true);
    expect(res.results).toEqual([]);
  });
});
