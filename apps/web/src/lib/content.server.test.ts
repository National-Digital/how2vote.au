import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ELECTIONS } from "@how2vote/data-schema";
import {
  buildElectorateHub,
  buildElectoratePage,
  buildIssueHub,
  buildIssuePage,
  buildPartyHub,
  buildPartyPage,
  buildSenatePage,
  contentPaths,
  datasetFor,
  electorateEntries,
  issueEntries,
  partyEntries,
  senateEntries,
} from "./content.server";

const CONTENT_ROUTES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../routes/[election=election]",
);

/** Every source file under the data-derived content routes. */
function routeFiles(dir = CONTENT_ROUTES): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(path));
    else if (entry.name.endsWith(".svelte") || entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

describe("content.server slugs are unique per election", () => {
  for (const { id } of ELECTIONS) {
    describe(id, () => {
      it("electorate slugs are unique", () => {
        const slugs = electorateEntries()
          .filter((e) => e.election === id)
          .map((e) => e.electorate);
        expect(new Set(slugs).size).toBe(slugs.length);
        expect(slugs.length).toBe(datasetFor(id)!.ballots.electorates.length);
      });
      it("issue slugs are unique", () => {
        const slugs = issueEntries()
          .filter((e) => e.election === id)
          .map((e) => e.issue);
        expect(new Set(slugs).size).toBe(slugs.length);
        expect(slugs.length).toBe(datasetFor(id)!.questions.questions.length);
      });
      it("party slugs are unique and non-empty", () => {
        const slugs = partyEntries()
          .filter((e) => e.election === id)
          .map((e) => e.party);
        expect(slugs.length).toBeGreaterThan(0);
        expect(new Set(slugs).size).toBe(slugs.length);
        expect(slugs.every((s) => s.length > 0)).toBe(true);
      });
    });
  }
});

describe("content.server page builders", () => {
  const id = ELECTIONS[0]!.id;

  it("returns null for an unknown election / slug", () => {
    expect(buildElectorateHub("1901")).toBeNull();
    expect(buildElectoratePage(id, "not-a-real-electorate")).toBeNull();
    expect(buildSenatePage(id, "zz")).toBeNull();
    expect(buildIssuePage(id, "not-a-real-issue")).toBeNull();
    expect(buildPartyPage(id, "not-a-real-party")).toBeNull();
  });

  it("builds every enumerated page without error", () => {
    for (const e of electorateEntries())
      expect(buildElectoratePage(e.election, e.electorate)).not.toBeNull();
    for (const e of senateEntries()) expect(buildSenatePage(e.election, e.state)).not.toBeNull();
    for (const e of issueEntries()) expect(buildIssuePage(e.election, e.issue)).not.toBeNull();
    for (const e of partyEntries()) expect(buildPartyPage(e.election, e.party)).not.toBeNull();
  });

  it("discloses party merges both ways, with resolvable names only", () => {
    // 2025: Centre Alliance absorbs Nick Xenophon Team.
    const master = buildPartyPage("2025", "centre-alliance")!;
    expect(master.merge?.role).toBe("absorbs");
    expect(master.merge?.with.map((w) => w.name)).toContain("Nick Xenophon Team");

    const merger = buildPartyPage("2025", "nick-xenophon-team")!;
    expect(merger.merge?.role).toBe("absorbed");
    expect(merger.merge?.with.map((w) => w.name)).toContain("Centre Alliance");

    // Merge entries that reference a key absent from an election's registry are dropped, never
    // surfaced as an empty/undefined name.
    for (const e of partyEntries()) {
      const merge = buildPartyPage(e.election, e.party)!.merge;
      if (merge) for (const w of merge.with) expect(w.name.length).toBeGreaterThan(0);
    }
  });

  it("gives every issue page factual FAQ pairs", () => {
    for (const e of issueEntries()) {
      const faqs = buildIssuePage(e.election, e.issue)!.faqs;
      expect(faqs.length).toBeGreaterThanOrEqual(2);
      for (const f of faqs) {
        expect(f.question.length).toBeGreaterThan(0);
        expect(f.answer.length).toBeGreaterThan(0);
      }
    }
  });

  it("issue FAQ agree/disagree lists are exactly the page's own bands (no drift)", () => {
    // The FAQ text and the visible page both derive from `bands`; this pins the two together so a
    // change to one that isn't mirrored in the other fails CI.
    for (const e of issueEntries()) {
      const page = buildIssuePage(e.election, e.issue)!;
      const namesFor = (positions: readonly number[]): string[] =>
        page.bands
          .filter((b) => positions.includes(b.position))
          .flatMap((b) => b.parties.map((p) => p.name))
          .sort((a, b) => a.localeCompare(b));
      const answerFor = (needle: string): string =>
        page.faqs.find((f) => f.question.includes(needle))!.answer;

      for (const [needle, positions] of [
        ["recorded agreeing", [5, 4]],
        ["recorded disagreeing", [2, 1]],
      ] as const) {
        const names = namesFor(positions);
        const answer = answerFor(needle);
        if (names.length === 0) expect(answer).toMatch(/^No party or independent/);
        else for (const n of names) expect(answer).toContain(n);
      }
    }
  });

  it("hubs list the same number of items the entries enumerate", () => {
    const hub = buildElectorateHub(id)!;
    const listed = hub.states.reduce((n, s) => n + s.electorates.length, 0);
    expect(listed).toBe(electorateEntries().filter((e) => e.election === id).length);
    expect(buildIssueHub(id)!.issues.length).toBe(
      issueEntries().filter((e) => e.election === id).length,
    );
    expect(buildPartyHub(id)!.parties.length).toBe(
      partyEntries().filter((e) => e.election === id).length,
    );
  });

  it("only links parties that have a generated page (no dead internal links)", () => {
    const pagePaths = new Set(contentPaths());
    // Every party href on an issue page must resolve to a generated party page.
    for (const e of issueEntries()) {
      const page = buildIssuePage(e.election, e.issue)!;
      for (const band of page.bands) {
        for (const p of band.parties) expect(pagePaths.has(p.href)).toBe(true);
      }
    }
    // Candidate party links (where present) must resolve too.
    for (const e of electorateEntries()) {
      for (const c of buildElectoratePage(e.election, e.electorate)!.candidates) {
        if (c.partyHref) expect(pagePaths.has(c.partyHref)).toBe(true);
      }
    }
  });
});

describe("content routes stay neutral (no scoring engine)", () => {
  // The data-derived pages must report recorded positions only — never a match score or a ranking
  // by valence. Guard it structurally: none of these route files may import the scoring engine.
  const banned = /generateCard|matchPercentages|evidenceFor|matchScore|from ["']\$lib\/quiz/;
  for (const file of routeFiles()) {
    it(`${file.split("/routes/")[1]} does not use the scoring engine`, () => {
      expect(banned.test(readFileSync(file, "utf8"))).toBe(false);
    });
  }
});

describe("contentPaths", () => {
  it("are unique, absolute and slash-prefixed", () => {
    const paths = contentPaths();
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.every((p) => p.startsWith("/") && !p.endsWith("/"))).toBe(true);
  });
});
