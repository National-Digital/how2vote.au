import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderPublic } from "./generate-signatories-public.mjs";

const REGISTRY = JSON.parse(
  readFileSync(new URL("../docs/legal/signatories.json", import.meta.url), "utf8"),
);
const GENERATED = JSON.parse(
  readFileSync(
    new URL("../apps/web/src/lib/governance/signatories.public.generated.json", import.meta.url),
    "utf8",
  ),
);

describe("renderPublic", () => {
  it("projects only publicProfile signatories and only public fields", () => {
    const out = renderPublic(REGISTRY);
    const publicIds = REGISTRY.signatories.filter((s) => s.publicProfile).map((s) => s.id);
    expect(out.signatories.map((s) => s.id)).toEqual(publicIds);
    for (const s of out.signatories) {
      // Public fields only — no email or bare githubHandle leaked (sameAs carries the public links).
      expect(Object.keys(s).sort()).toEqual(["id", "jobTitle", "legalName", "org", "sameAs"]);
      expect(s).not.toHaveProperty("email");
      expect(s).not.toHaveProperty("githubHandle");
    }
  });

  it("excludes a signatory whose publicProfile is false", () => {
    const reg = JSON.parse(JSON.stringify(REGISTRY));
    reg.signatories[0].publicProfile = false;
    const out = renderPublic(reg);
    expect(out.signatories.map((s) => s.id)).not.toContain(REGISTRY.signatories[0].id);
  });

  it("matches the committed generated projection (drift gate)", () => {
    expect(renderPublic(REGISTRY)).toEqual({
      generatedFrom: GENERATED.generatedFrom,
      note: GENERATED.note,
      signatories: GENERATED.signatories,
    });
  });
});
