import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { verdict } from "./check-rights-domain.mjs";

const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));

/** A minimal well-formed register: one ODbL vote domain + the two required AEC domains. */
function register(over = {}) {
  return {
    schemaVersion: 1,
    updated: "2026-07-15",
    noticeVersion: "2026.1",
    rightsClasses: [
      {
        id: "tvfy-odbl",
        name: "TVFY",
        source: "They Vote For You",
        sourceOrg: "OpenAustralia Foundation",
        sourceUrl: "https://theyvoteforyou.org.au/api/v1",
        licence: { spdxId: "ODbL-1.0", name: "ODbL v1.0", url: "https://odbl" },
        copyright: "© OAF",
        attribution: "Vote data © TVFY, ODbL",
        redistribution: "permitted",
        modification: "permitted",
        shareAlike: true,
        attributionRequired: true,
        licenceStatus: "current",
      },
      {
        id: "aec-boundary-spatial",
        name: "AEC boundary",
        source: "AEC GIS",
        sourceOrg: "Australian Electoral Commission",
        sourceUrl: "https://aec",
        licence: { spdxId: "CC-BY-4.0", name: "CC BY 4.0", url: "https://cc" },
        copyright: "© AEC",
        attribution: "Boundaries © AEC",
        redistribution: "permitted",
        modification: "permitted",
        shareAlike: false,
        attributionRequired: true,
        licenceStatus: "current",
        evidenceId: "EV-AEC-SPATIAL-LICENCE",
      },
      {
        id: "aec-candidate-data",
        name: "AEC candidates",
        source: "AEC publications",
        sourceOrg: "Australian Electoral Commission",
        sourceUrl: "https://aec",
        licence: { spdxId: "CC-BY-4.0", name: "CC BY 4.0", url: "https://cc" },
        copyright: "© AEC",
        attribution: "Candidate data © AEC",
        redistribution: "permitted",
        modification: "permitted",
        shareAlike: false,
        attributionRequired: true,
        licenceStatus: "current",
        evidenceId: "EV-AEC-SOURCE-RECORDS",
      },
    ],
    domains: [
      {
        id: "vote-positions",
        description: "votes",
        rightsClass: "tvfy-odbl",
        sources: ["s"],
        outputs: ["o"],
      },
      {
        id: "candidate-ballots",
        description: "ballots",
        rightsClass: "aec-candidate-data",
        sources: ["s"],
        outputs: ["o"],
      },
      {
        id: "boundary-geometry",
        description: "maps",
        rightsClass: "aec-boundary-spatial",
        sources: ["s"],
        outputs: ["o"],
      },
    ],
    odblDomains: ["vote-positions"],
    ...over,
  };
}

describe("verdict — the real committed register", () => {
  it("passes the committed data/rights/rights-classes.json", () => {
    const root = new URL("../", import.meta.url);
    const real = JSON.parse(readFileSync(new URL("data/rights/rights-classes.json", root), "utf8"));
    expect(verdict(real).errors).toEqual([]);
  });
});

describe("verdict — structure", () => {
  it("passes the synthetic well-formed register", () => {
    expect(verdict(register()).ok).toBe(true);
  });

  it("fails a domain with no rights class", () => {
    const r = register();
    delete r.domains[0].rightsClass;
    expect(hasError(verdict(r), "missing rightsClass")).toBe(true);
  });

  it("fails a domain referencing an undefined rights class", () => {
    const r = register();
    r.domains[0].rightsClass = "ghost";
    expect(hasError(verdict(r), 'rightsClass "ghost" is not defined')).toBe(true);
  });

  it("fails an unused (orphan) rights class", () => {
    const r = register();
    r.rightsClasses.push({
      id: "unused",
      name: "u",
      source: "s",
      sourceOrg: "o",
      sourceUrl: "u",
      licence: { spdxId: "MIT", name: "MIT" },
      copyright: "c",
      attribution: "a",
      redistribution: "permitted",
      modification: "permitted",
      shareAlike: false,
      attributionRequired: false,
      licenceStatus: "current",
    });
    expect(hasError(verdict(r), "no domain uses it")).toBe(true);
  });

  it("fails a missing required domain", () => {
    const r = register();
    r.domains = r.domains.filter((d) => d.id !== "boundary-geometry");
    expect(hasError(verdict(r), 'required domain "boundary-geometry" is missing')).toBe(true);
  });

  it("fails a provisional licence without an evidenceId", () => {
    const r = register();
    r.rightsClasses[1].licenceStatus = "provisional";
    delete r.rightsClasses[1].evidenceId;
    expect(hasError(verdict(r), "provisional licence must cite an evidenceId")).toBe(true);
  });

  it("does not let a provisional licence ship — even with an evidenceId (must be signed-off/current)", () => {
    const r = register();
    r.rightsClasses[1].licenceStatus = "provisional";
    r.rightsClasses[1].evidenceId = "EV-AEC-SPATIAL-LICENCE";
    const res = verdict(r);
    expect(res.ok).toBe(false);
    expect(hasError(res, "not signed-off")).toBe(true);
  });

  it("does not let an under-review licence ship", () => {
    const r = register();
    r.rightsClasses[1].licenceStatus = "under-review";
    expect(hasError(verdict(r), "not signed-off")).toBe(true);
  });

  it("fails a rights class missing sourceUrl (would ship 'undefined' in the notice)", () => {
    const r = register();
    delete r.rightsClasses[0].sourceUrl;
    expect(hasError(verdict(r), "missing sourceUrl")).toBe(true);
  });

  it("fails a register missing the top-level updated date", () => {
    const r = register();
    delete r.updated;
    expect(hasError(verdict(r), "missing updated")).toBe(true);
  });
});

describe("verdict — contamination proof", () => {
  it("rejects ODbL asserted over a non-OpenAustralia-Foundation source", () => {
    const r = register();
    r.rightsClasses[1].licence.spdxId = "ODbL-1.0"; // AEC boundary claimed as ODbL
    expect(hasError(verdict(r), "rights contamination")).toBe(true);
  });

  it("rejects an AEC domain listed as an ODbL export", () => {
    const r = register();
    r.odblDomains = ["vote-positions", "boundary-geometry"];
    expect(hasError(verdict(r), 'AEC domain "boundary-geometry" must not be an ODbL export')).toBe(
      true,
    );
  });

  it("rejects an ODbL domain missing from the export allowlist", () => {
    const r = register();
    r.odblDomains = [];
    expect(hasError(verdict(r), 'ODbL domain "vote-positions" is missing')).toBe(true);
  });
});
