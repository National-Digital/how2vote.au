import { describe, expect, it } from "vitest";
import { verdict } from "./check-proposition-rights.mjs";

const clone = (v) => JSON.parse(JSON.stringify(v));
const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));

/** A minimal rights register with the ODbL OpenAustralia Foundation class and a vote-positions domain. */
const RIGHTS = {
  rightsClasses: [
    {
      id: "tvfy-odbl",
      sourceOrg: "OpenAustralia Foundation",
      licence: { spdxId: "ODbL-1.0" },
    },
    {
      id: "aec-candidate-data",
      sourceOrg: "Australian Electoral Commission",
      licence: { spdxId: "CC-BY-4.0" },
    },
  ],
  domains: [{ id: "vote-positions", rightsClass: "tvfy-odbl" }],
};

/** Two committed elections, each with a locked snapshot covering every proposition. */
const SOURCES = [
  {
    id: "2019",
    questionIds: [1, 2, 3],
    activeVersion: 1,
    meta: { version: 1, locked: true, policyIds: [1, 2, 3, 9] },
  },
  {
    id: "2022",
    questionIds: [4, 5],
    activeVersion: 1,
    meta: { version: 1, locked: true, policyIds: [4, 5] },
  },
];

const MATRIX = {
  schemaVersion: 1,
  updated: "2026-07-18",
  contentRightsClass: "tvfy-odbl",
  elections: [
    {
      electionId: "2019",
      snapshotVersion: 1,
      contentRightsClass: "tvfy-odbl",
      oafContentPermission: "not-required",
      oafPermissionBasis: "ODbL factual data.",
    },
    {
      electionId: "2022",
      snapshotVersion: 1,
      contentRightsClass: "tvfy-odbl",
      oafContentPermission: "not-required",
      oafPermissionBasis: "ODbL factual data.",
    },
  ],
};

const ok = () => ({
  matrix: clone(MATRIX),
  rightsRegister: clone(RIGHTS),
  sources: clone(SOURCES),
});

describe("proposition content-rights verdict", () => {
  it("passes a well-formed matrix", () => {
    const res = verdict(ok());
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it("fails closed on non-object matrix", () => {
    expect(verdict({ matrix: null, rightsRegister: RIGHTS, sources: SOURCES }).ok).toBe(false);
  });

  it("flags a committed election with no matrix entry", () => {
    const input = ok();
    input.matrix.elections = input.matrix.elections.filter((e) => e.electionId !== "2022");
    expect(hasError(verdict(input), "no content-rights entry")).toBe(true);
  });

  it("flags a matrix entry with no committed election", () => {
    const input = ok();
    input.matrix.elections.push({
      electionId: "2099",
      snapshotVersion: 1,
      contentRightsClass: "tvfy-odbl",
      oafContentPermission: "not-required",
      oafPermissionBasis: "x",
    });
    expect(hasError(verdict(input), 'matrix entry "2099" has no committed election source')).toBe(
      true,
    );
  });

  it("flags a proposition not present in the locked snapshot policy set", () => {
    const input = ok();
    input.sources[0].questionIds = [1, 2, 3, 999];
    expect(hasError(verdict(input), "not in the locked snapshot policy set")).toBe(true);
  });

  it("flags an unlocked snapshot", () => {
    const input = ok();
    input.sources[0].meta.locked = false;
    expect(hasError(verdict(input), "is not locked")).toBe(true);
  });

  it("flags a snapshotVersion that is not the active version", () => {
    const input = ok();
    input.sources[0].activeVersion = 2;
    expect(hasError(verdict(input), "!= active version")).toBe(true);
  });

  it("flags a content class that drifts from the vote-positions domain", () => {
    const input = ok();
    input.matrix.contentRightsClass = "aec-candidate-data";
    input.matrix.elections.forEach((e) => (e.contentRightsClass = "aec-candidate-data"));
    expect(hasError(verdict(input), "vote-positions domain class")).toBe(true);
  });

  it("flags a non-ODbL / non-OAF content class", () => {
    const input = ok();
    // Point the domain + matrix at a non-OAF class so the contamination check trips.
    input.rightsRegister.domains[0].rightsClass = "aec-candidate-data";
    input.matrix.contentRightsClass = "aec-candidate-data";
    input.matrix.elections.forEach((e) => (e.contentRightsClass = "aec-candidate-data"));
    expect(hasError(verdict(input), "ODbL OpenAustralia Foundation class")).toBe(true);
  });

  it("flags an invalid OAF permission value", () => {
    const input = ok();
    input.matrix.elections[0].oafContentPermission = "maybe";
    expect(hasError(verdict(input), "oafContentPermission must be one of")).toBe(true);
  });

  it("requires an oafPermissionRef when permission is granted", () => {
    const input = ok();
    input.matrix.elections[0].oafContentPermission = "granted";
    expect(hasError(verdict(input), "needs an oafPermissionRef")).toBe(true);
  });
});
