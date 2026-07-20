import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { verdict } from "./check-aec-spatial.mjs";

const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));

const CTX = {
  rightsClassIds: [
    "tvfy-odbl",
    "aec-boundary-spatial",
    "aec-candidate-data",
    "how2vote-aggregates",
  ],
  rightsLicenceName: "AEC Spatial Data Download Data Licence",
};

function record(over = {}) {
  return {
    schemaVersion: 1,
    rightsClass: "aec-boundary-spatial",
    status: "provisional",
    productName: "how2vote.au",
    boundaryData: "Commonwealth Electoral Boundaries (various years)",
    licenceEvidence: "data/aec-spatial/aec-licence-capture-2026-07-15.md",
    licence: {
      name: "AEC Spatial Data Download Data Licence",
      url: "https://www.aec.gov.au/Electorates/gis/",
      pageTitle: "Data download licence",
      lastUpdated: "2013-06-25",
      capturedAt: "2026-07-15",
      copyrightYear: "2026",
      copyrightYearNote: "AEC page shows 2026 despite a 2013 update; recorded as accepted.",
    },
    notice: {
      components: [
        "This product (how2vote.au) incorporates data that is: © Commonwealth of Australia (Australian Electoral Commission) 2026",
        "The Data (Commonwealth Electoral Boundaries (various years)) has been used in how2vote.au with the permission of the Australian Electoral Commission.",
        "The Australian Electoral Commission has not evaluated the Data as altered and incorporated within how2vote.au, and therefore gives no warranty regarding its accuracy, completeness, currency or suitability for any particular purpose.",
        "You may use how2vote.au to load, display, print and reproduce views obtained from the Data, retaining this notice, for your personal use, or use within your organisation only.",
      ],
    },
    sources: [
      {
        electionId: "2025",
        title: "Commonwealth Electoral Boundaries — 2025 (national)",
        boundaryYear: 2025,
        sourceUrl: "https://www.aec.gov.au/Electorates/gis/gis_datadownload.htm",
        downloadedAt: null,
        fileName: null,
        sha256: null,
        status: "pending",
      },
    ],
    ...over,
  };
}

describe("verdict — real committed record", () => {
  it("passes the committed data/aec-spatial/source-record.json against the rights register", () => {
    const root = new URL("../", import.meta.url);
    const real = JSON.parse(
      readFileSync(new URL("data/aec-spatial/source-record.json", root), "utf8"),
    );
    const rights = JSON.parse(
      readFileSync(new URL("data/rights/rights-classes.json", root), "utf8"),
    );
    const cls = rights.rightsClasses.find((c) => c.id === real.rightsClass);
    const res = verdict(real, {
      rightsClassIds: rights.rightsClasses.map((c) => c.id),
      rightsLicenceName: cls.licence.name,
    });
    expect(res.errors).toEqual([]);
  });

  it("the committed record is NOT CC BY 4.0", () => {
    const root = new URL("../", import.meta.url);
    const real = JSON.parse(
      readFileSync(new URL("data/aec-spatial/source-record.json", root), "utf8"),
    );
    expect(real.licence.name).not.toContain("Creative Commons");
    expect(real.licence.name).toContain("AEC Spatial Data Download");
  });
});

describe("verdict — structure", () => {
  it("passes the synthetic well-formed record", () => {
    expect(verdict(record(), CTX).ok).toBe(true);
  });

  it("fails a rightsClass not in the register", () => {
    expect(hasError(verdict(record({ rightsClass: "ghost" }), CTX), "is not defined")).toBe(true);
  });

  it("fails when licence.name disagrees with the rights register", () => {
    const res = verdict(record(), {
      ...CTX,
      rightsLicenceName: "Creative Commons Attribution 4.0",
    });
    expect(hasError(res, "disagrees with the rights register")).toBe(true);
  });

  it("requires a copyrightYear note", () => {
    const r = record();
    delete r.licence.copyrightYearNote;
    expect(hasError(verdict(r, CTX), "copyrightYearNote is required")).toBe(true);
  });

  it("requires a licenceEvidence path (data + licence kept together)", () => {
    const r = record();
    delete r.licenceEvidence;
    expect(hasError(verdict(r, CTX), "missing licenceEvidence")).toBe(true);
  });
});

describe("verdict — prescribed notice", () => {
  it("fails a notice missing the no-warranty disclaimer", () => {
    const r = record();
    // Replace (keep 4 components) the warranty clause so only "no warranty" goes missing.
    r.notice.components[2] =
      "The Australian Electoral Commission has not evaluated the Data as altered.";
    expect(hasError(verdict(r, CTX), 'required phrase "no warranty"')).toBe(true);
  });

  it("fails a notice missing the 'has not evaluated' statement", () => {
    const r = record();
    r.notice.components[2] =
      "The Australian Electoral Commission gives no warranty regarding accuracy.";
    expect(hasError(verdict(r, CTX), "has not evaluated")).toBe(true);
  });

  it("fails when the notice year disagrees with the recorded copyright year", () => {
    const r = record();
    r.licence.copyrightYear = "2099";
    expect(hasError(verdict(r, CTX), "recorded copyright year (2099)")).toBe(true);
  });
});

describe("verdict — verification / fail-closed", () => {
  it("blocks status 'current' while a source is still pending", () => {
    expect(hasError(verdict(record({ status: "current" }), CTX), "requires every source")).toBe(
      true,
    );
  });

  it("requires filename + checksum + download date on a verified source", () => {
    const r = record();
    r.sources[0].status = "verified";
    const res = verdict(r, CTX);
    expect(hasError(res, "needs a fileName")).toBe(true);
    expect(hasError(res, "needs a sha256")).toBe(true);
    expect(hasError(res, "needs a valid downloadedAt")).toBe(true);
  });

  it("passes when a verified source is fully evidenced and the record is current", () => {
    const r = record({ status: "current" });
    r.sources[0] = {
      ...r.sources[0],
      status: "verified",
      fileName: "AUS-March-2025-esri.zip",
      sha256: "d".repeat(64),
      downloadedAt: "2026-07-15",
      archiveRetained: true,
      reviewer: "Ada",
      reviewedAt: "2026-07-15",
    };
    expect(verdict(r, CTX).ok).toBe(true);
  });
});
