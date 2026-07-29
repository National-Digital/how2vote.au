import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  hashPropositionManifest,
  normalisePageText,
  propositionManifest,
  scanCopy,
  stripComments,
  verdict,
} from "./check-neutrality-claims.mjs";

const REGISTER = JSON.parse(
  readFileSync(new URL("../docs/legal/neutrality-claims.json", import.meta.url), "utf8"),
);
const PAGE = readFileSync(
  new URL("../apps/web/src/lib/content/MethodologyContent.svelte", import.meta.url),
  "utf8",
);

const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));

// Datasets whose proposition manifest hashes to the register's bound hash, so the "real" verdict
// tests exercise the happy path without reading the ~330 KB committed datasets.
const DATASETS_OK = [
  { id: "2019", questions: [{ id: 2, text: "Two" }] },
  { id: "2022", questions: [{ id: 1, text: "One" }] },
];
const HASH_OK = hashPropositionManifest(DATASETS_OK);

const baseInput = () => ({
  register: REGISTER,
  sources: [],
  methodologyText: PAGE,
  propositionsHash: REGISTER.propositionSelection.boundManifestHash,
  methodologyVersion: REGISTER.propositionSelection.methodologyVersion,
});

describe("verdict — real committed register + methodology page", () => {
  it("passes on the real register bound to the real page and its declared hash/version", () => {
    const res = verdict(baseInput());
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });
});

describe("scanCopy — banned assertive constructions", () => {
  const cases = [
    ["absolute neutrality", "How2Vote is completely neutral."],
    ["absolute neutrality (100%)", "Our tool is 100% objective."],
    ["absolute accuracy", "Your results are always accurate."],
    ["recommendation verb", "We recommend voting for the Greens."],
    ["you-should-vote", "You should vote for Labor first."],
    ["vote 1", "Just vote 1 Liberal on the ballot."],
    ["recommended preference", "This is our recommended preference order."],
    ["best party for you", "The best party for you is at the top."],
    ["preselected rank", "Candidates are pre-filled for you."],
    ["default ranking", "The ballot uses a default ranking."],
    ["suggested order", "Shown in a suggested order."],
  ];
  for (const [name, text] of cases) {
    it(`flags ${name}`, () => {
      expect(scanCopy([{ path: "x.svelte", text }]).length).toBeGreaterThan(0);
    });
  }
});

describe("scanCopy — precision (negated / interrogative / factual copy is clean)", () => {
  const clean = [
    "Nothing is pre-filled and How2Vote never suggests who to put first.",
    "This is not a recommended preference.",
    "no preference is recommended.",
    "Who should I vote for?",
    "Which party would you currently be most likely to vote for?",
    "candidates are never ranked by score.",
    "factual and neutral by construction",
    "How2Vote never pre-fills, ranks or suggests it.",
    "nothing is ranked, nothing is crowned.",
    "At the last federal election, who did you vote for?",
  ];
  for (const text of clean) {
    it(`does not flag: ${text.slice(0, 40)}`, () => {
      expect(scanCopy([{ path: "x.svelte", text }])).toEqual([]);
    });
  }

  it("catches an assertive violation even when a far-away negation exists in the same blob", () => {
    const text = "We never talk politics. Anyway, you should vote 1 for our favourite party.";
    expect(scanCopy([{ path: "x.svelte", text }]).length).toBeGreaterThan(0);
  });

  it("does not scan code/markup comments (they legitimately discuss the banned phrases)", () => {
    const svelte = "// so the display never implies a winner or a suggested order\n<p>ok</p>";
    const block = "/* we do not show a recommended preference here */\nconst x = 1;";
    expect(scanCopy([{ path: "a.svelte", text: svelte }])).toEqual([]);
    expect(scanCopy([{ path: "b.ts", text: block }])).toEqual([]);
  });

  it("still catches a violation in a comment-adjacent code string", () => {
    const text = 'const banner = "You should vote 1 for the best party for you";';
    expect(scanCopy([{ path: "a.ts", text }]).length).toBeGreaterThan(0);
  });
});

describe("stripComments", () => {
  it("removes // line, /* block */ and <!-- html --> comments but keeps URL schemes", () => {
    expect(stripComments("a // gone\nb").trim()).toBe("a \nb".trim());
    expect(stripComments("x /* gone */ y")).toContain("x");
    expect(stripComments("x /* gone */ y")).not.toContain("gone");
    expect(stripComments("<!-- gone -->text")).not.toContain("gone");
    expect(stripComments('const u = "https://theyvoteforyou.org.au";')).toContain("theyvoteforyou");
  });
});

describe("verdict — banned copy fails the whole check", () => {
  it("fails when a scanned source contains a recommendation verb", () => {
    const res = verdict({
      ...baseInput(),
      sources: [{ path: "apps/web/src/routes/x/+page.svelte", text: "We recommend the Greens." }],
    });
    expect(res.ok).toBe(false);
    expect(hasError(res, "recommendation")).toBe(true);
  });
});

describe("verdict — methodology binding (register/page drift)", () => {
  it("fails when a claim wording is absent from the page", () => {
    const register = JSON.parse(JSON.stringify(REGISTER));
    register.claims[0].wording = "this exact sentence is not on the methodology page anywhere";
    expect(hasError(verdict({ ...baseInput(), register }), "drift")).toBe(true);
  });

  it("fails when a proposition-selection pageWording is absent from the page", () => {
    const register = JSON.parse(JSON.stringify(REGISTER));
    register.propositionSelection.pageWording = ["proposition selection v999"];
    expect(hasError(verdict({ ...baseInput(), register }), "drift")).toBe(true);
  });

  it("fails when the version is bumped but not surfaced on the page", () => {
    const register = JSON.parse(JSON.stringify(REGISTER));
    // A version the methodology page does not surface ("proposition selection v999" appears nowhere),
    // so the register/page binding must fail — independent of whatever the current shipped version is.
    register.propositionSelection.version = "999";
    expect(
      hasError(verdict({ ...baseInput(), register }), "not reflected on the public page"),
    ).toBe(true);
  });
});

describe("verdict — proposition-hash binding (unexplained changes)", () => {
  it("fails when the built propositions no longer match the bound hash", () => {
    const res = verdict({ ...baseInput(), propositionsHash: "deadbeef".repeat(8) });
    expect(res.ok).toBe(false);
    expect(hasError(res, "unexplained proposition change")).toBe(true);
  });

  it("passes when the recomputed hash matches the register", () => {
    const register = JSON.parse(JSON.stringify(REGISTER));
    register.propositionSelection.boundManifestHash = HASH_OK;
    expect(verdict({ ...baseInput(), register, propositionsHash: HASH_OK }).ok).toBe(true);
  });
});

describe("verdict — method-version binding", () => {
  it("fails when the register method version lags data-schema", () => {
    const res = verdict({ ...baseInput(), methodologyVersion: "9999.1" });
    expect(res.ok).toBe(false);
    expect(hasError(res, "lags a method bump")).toBe(true);
  });
});

describe("verdict — register structure + approval freshness", () => {
  it("fails on a non-object register", () => {
    expect(verdict({ register: null }).ok).toBe(false);
  });

  it("fails when a claim approval has expired (fail-closed)", () => {
    const register = JSON.parse(JSON.stringify(REGISTER));
    register.claims[0].expiresAt = "2020-01-01";
    expect(hasError(verdict({ ...baseInput(), register }), "expired")).toBe(true);
  });

  it("fails when a claim is missing an approver", () => {
    const register = JSON.parse(JSON.stringify(REGISTER));
    delete register.claims[0].approver;
    expect(hasError(verdict({ ...baseInput(), register }), "approver")).toBe(true);
  });

  it("fails when the proposition-selection record is missing", () => {
    const register = JSON.parse(JSON.stringify(REGISTER));
    delete register.propositionSelection;
    expect(hasError(verdict({ ...baseInput(), register }), "propositionSelection")).toBe(true);
  });
});

describe("propositionManifest / hashPropositionManifest", () => {
  it("is order-independent across elections and questions", () => {
    const a = [
      {
        id: "2022",
        questions: [
          { id: 2, text: "b" },
          { id: 1, text: "a" },
        ],
      },
      { id: "2019", questions: [{ id: 3, text: "c" }] },
    ];
    const b = [
      { id: "2019", questions: [{ id: 3, text: "c" }] },
      {
        id: "2022",
        questions: [
          { id: 1, text: "a" },
          { id: 2, text: "b" },
        ],
      },
    ];
    expect(hashPropositionManifest(a)).toBe(hashPropositionManifest(b));
  });

  it("changes when a proposition's wording changes", () => {
    const before = [{ id: "2025", questions: [{ id: 1, text: "original" }] }];
    const after = [{ id: "2025", questions: [{ id: 1, text: "reworded" }] }];
    expect(hashPropositionManifest(before)).not.toBe(hashPropositionManifest(after));
  });

  it("excludes position figures from the manifest (data refresh is not a selection change)", () => {
    const m = propositionManifest([
      { id: "2025", questions: [{ id: 1, text: "t", positions: { a: 1 } }] },
    ]);
    expect(m[0].propositions[0]).toEqual({ id: 1, text: "t" });
  });
});

describe("normalisePageText", () => {
  it("strips tags, entities and collapses whitespace", () => {
    expect(normalisePageText("<p>a\n  &amp;   <strong>b</strong>&nbsp;c</p>")).toBe("a & b c");
  });
});
