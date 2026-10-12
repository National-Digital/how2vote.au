import { describe, expect, it, vi } from "vitest";
import { contentPaths } from "./content.server";
import {
  AEC_ELECTORATE_FINDER,
  buildPostcodeHub,
  buildPostcodePage,
  postcodeElections,
  postcodeEntries,
  postcodePaths,
  postcodesFor,
} from "./postcodes.server";

describe("postcode pages: one electorate", () => {
  it("names the electorate, its state and the election, and links its page", () => {
    const page = buildPostcodePage("2025", "3000")!;
    expect(page.split).toBe(false);
    expect(page.intro).toBe(
      "Postcode 3000 falls in the federal electorate of Melbourne, Victoria. This applies to the 2025 federal election, on the electorate boundaries used at that election.",
    );
    expect(page.electorates).toEqual([
      {
        name: "Melbourne",
        stateName: "Victoria",
        href: "/2025/electorates/melbourne",
        linkYear: null,
      },
    ]);
    expect(page.partly).toEqual([]);
    expect(page.checkAddress).toBe(false);
    expect(page.seo.title).toBe("Postcode 3000 federal electorate — 2025 — How2Vote");
    expect(page.seo.description).toBe(
      "Postcode 3000 falls in the federal electorate of Melbourne for the 2025 federal election.",
    );
    expect(page.sources.map((s) => s.title)).toContain(
      "ASGS Geographic Correspondences (2021) Edition 3",
    );
  });

  it("for the next election, links the 2025 candidates and says so", () => {
    const page = buildPostcodePage("next", "3000")!;
    expect(page.intro).toContain(
      "the next federal election, using the electorate boundaries of the 2025 election, which were unchanged for this postcode as at 12 October 2026",
    );
    expect(page.electorates[0]).toMatchObject({
      href: "/2025/electorates/melbourne",
      linkYear: 2025,
    });
    expect(page.seo.description).toBe(
      "Postcode 3000 falls in the federal electorate of Melbourne for the next federal election (2025 boundaries, as at 12 October 2026).",
    );
  });

  it("takes the 2025 Northern Territory change into account, by population", () => {
    for (const pc of ["0830", "0832"]) {
      const page = buildPostcodePage("2025", pc)!;
      expect(page.electorates.map((e) => e.name)).toEqual(["Solomon"]);
      expect(page.partly).toEqual([]);
      expect(page.checkAddress).toBe(false);
    }
  });
});

describe("postcode pages: more than one electorate", () => {
  it("lists every electorate and sends the reader to the AEC finder", () => {
    const page = buildPostcodePage("2025", "0872")!;
    expect(page.split).toBe(true);
    expect(page.checkAddress).toBe(true);
    expect(page.intro).toBe(
      "Postcode 0872 spans more than one federal electorate. This applies to the 2025 federal election, on the electorate boundaries used at that election.",
    );
    expect(page.electorates.map((e) => [e.name, e.stateName])).toEqual([
      ["Durack", "Western Australia"],
      ["Grey", "South Australia"],
      ["Lingiari", "Northern Territory"],
      ["O'Connor", "Western Australia"],
    ]);
    expect(page.electorates.every((e) => e.href?.startsWith("/2025/electorates/"))).toBe(true);
    expect(page.finderUrl).toBe(AEC_ELECTORATE_FINDER);
    expect(page.seo.description).toContain("Check your address with the AEC");
  });

  it("says a postcode falls mainly in one electorate when the rest is below the minimum share", () => {
    const page = buildPostcodePage("2025", "2000")!;
    expect(page.split).toBe(false);
    expect(page.checkAddress).toBe(true);
    expect(page.electorates.map((e) => e.name)).toEqual(["Sydney"]);
    expect(page.partly.map((e) => e.name)).toEqual(["Wentworth"]);
    expect(page.intro).toBe(
      "Postcode 2000 falls mainly in the federal electorate of Sydney, New South Wales; a small part may be in Wentworth. This applies to the 2025 federal election, on the electorate boundaries used at that election.",
    );
    expect(page.seo.description).toBe(
      "Postcode 2000 falls mainly in Sydney for the 2025 federal election; a small part may be in Wentworth. Check your address with the AEC.",
    );
  });
});

describe("postcode pages: more than one electorate and a small part of another", () => {
  it("names only the full electorates as the split, and the small part apart", () => {
    const page = buildPostcodePage("2025", "2122")!;
    expect(page.split).toBe(true);
    expect(page.electorates.map((e) => e.name)).toEqual(["Bennelong", "Parramatta"]);
    expect(page.partlyText).toBe("Berowra");
    expect(page.seo.description).toBe(
      "Postcode 2122 spans more than one federal electorate (Bennelong, Parramatta) for the 2025 federal election; a small part may be in Berowra. Check your address with the AEC.",
    );
  });

  it("joins two or more small-part electorates with 'or'", () => {
    const page = buildPostcodePage("2025", "2330")!;
    expect(page.partlyText).toBe("Macquarie or New England");
    expect(page.intro).toContain("a small part may be in Macquarie or New England.");
  });
});

describe("postcode coverage", () => {
  it("publishes only for elections on the matching boundaries", () => {
    expect(postcodeElections()).toEqual(["next", "2025"]);
    expect(postcodesFor("2022")).toEqual([]);
    expect(buildPostcodePage("2022", "3000")).toBeNull();
    expect(buildPostcodeHub("2019")).toBeNull();
  });

  it("covers every postcode for 2025", () => {
    expect(postcodesFor("2025")).toHaveLength(2642);
    expect(postcodesFor("2025")).toEqual(expect.arrayContaining(["0800", "2600", "5000", "7000"]));
  });

  it("leaves out, for the next election, postcodes in the redrawn states", () => {
    const next = postcodesFor("next");
    for (const pc of ["5000", "7000", "2600", "2620", "0872", "2540"])
      expect(next).not.toContain(pc);
    for (const pc of ["3000", "2000", "4000", "6000", "0800"]) expect(next).toContain(pc);
    expect(buildPostcodePage("next", "5000")).toBeNull();
    expect(buildPostcodeHub("next")!.notListed).toBe(
      "Postcodes that fall in an electorate in South Australia, Tasmania or the Australian Capital Territory are not listed. Those electorates were redrawn on 8 October 2026, and the postcode data used here describes the earlier boundaries.",
    );
    expect(buildPostcodeHub("2025")!.notListed).toBeNull();
  });

  it("links every electorate to a generated electorate page", () => {
    const pages = new Set(contentPaths());
    for (const { election, postcode } of postcodeEntries()) {
      const page = buildPostcodePage(election, postcode)!;
      for (const e of [...page.electorates, ...page.partly]) expect(pages.has(e.href!)).toBe(true);
    }
  });

  it("indexes every postcode page under at least one state, and lists each path once", () => {
    for (const election of postcodeElections()) {
      const hub = buildPostcodeHub(election)!;
      const listed = new Set(hub.states.flatMap((s) => s.postcodes.map((p) => p.postcode)));
      expect([...listed].sort()).toEqual(postcodesFor(election));
    }
    const paths = postcodePaths();
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain("/2025/postcodes/3000");
  });
});

describe("app channels", () => {
  it("build and link no postcode pages", async () => {
    vi.resetModules();
    vi.doMock("./channel", () => ({ isNativeShell: true }));
    const app = await import("./postcodes.server");
    expect(app.postcodeElections()).toEqual([]);
    expect(app.postcodeEntries()).toEqual([]);
    expect(app.postcodePaths()).toEqual([]);
    expect(app.buildPostcodePage("2025", "3000")).toBeNull();
    vi.doUnmock("./channel");
    vi.resetModules();
  });
});
