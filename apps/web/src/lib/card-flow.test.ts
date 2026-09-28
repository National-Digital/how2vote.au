import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { NativeCard } from "./card-flow.svelte";

const row = (name: string, figure: string | null) => ({
  name,
  kind: figure ? ("aligned" as const) : ("independent" as const),
  showScore: figure !== null,
  figure,
  badge: figure ? "alignment" : "No party alignment",
  spoken: `${name}: … evidence only, not a recommended preference.`,
});

const ready = {
  status: "ready" as const,
  stageLabel: "Your comparison",
  heading: "Bean",
  stateSuffix: " · Australian Capital Territory",
  shared: false,
  canVote: true,
  archived: true,
  electorateLess: false,
  correction: false,
  electorate: "Bean",
  label: "2025 federal election",
  year: "2025",
  vintage: "1 Apr 2025",
  withdrawn: 1,
  panels: [
    {
      title: "House of Representatives",
      subtitle: "Green ballot paper · your local member",
      caption: "Party voting-record alignment (House parties)",
      ballotOrdered: true,
      blocks: [
        { kind: "single" as const, row: row("Australian Labor Party", "62%") },
        {
          kind: "group" as const,
          label: "Coalition",
          note: "Registered Coalition parties — shown together, each with its own record. Not ranked.",
          rows: [row("Liberal", "41%"), row("The Nationals (Qld)", "38%")],
        },
      ],
    },
  ],
  plansEnabled: true,
  build: "Build a demonstration plan",
  saveable: true,
  saved: false,
  terms: { shown: true, ticked: false },
  shareWarning: false,
  why: true,
  evidence: [
    {
      key: "alp",
      summary: "Australian Labor Party — 62% party alignment",
      lines: [
        {
          id: 1,
          question: "Increase the Newstart rate",
          agreement: "aligned",
          href: "https://theyvoteforyou.org.au/policies/1",
          label:
            "See the parliamentary voting record for “Increase the Newstart rate” on They Vote For You",
        },
      ],
    },
  ],
};

/**
 * A card of each kind, as `cardFlow.nativeCard()` hands it to the iOS app. Typed as the web's own
 * card, so a change to what the web hands over fails the typecheck here until the fixture — and the
 * app's decoder, which `DocumentLogic` holds to it — follows.
 */
const CARDS: NativeCard[] = [
  { ...ready, stage: "compare", plan: null },
  {
    ...ready,
    stage: "build",
    stageLabel: "Historical demonstration plan",
    terms: { shown: false, ticked: false },
    why: false,
    evidence: [],
    plan: {
      house: {
        title: "House of Representatives",
        subtitle: "Green ballot paper · number every box",
        rows: [
          {
            id: "Jane Citizen|1",
            candidate: "Jane Citizen",
            party: "Independent",
            name: "Jane Citizen, Independent",
            pref: 1,
          },
          {
            id: "Sam Voter|2",
            candidate: "Sam Voter",
            party: "Example Party",
            name: "Sam Voter, Example Party",
            pref: 0,
          },
        ],
        status: "1 of 2 numbered — number every box for a formal House vote.",
      },
      senate: {
        title: "Senate",
        subtitle: "White ballot paper · Australian Capital Territory",
        view: "below",
        above: [
          {
            id: "A",
            candidate: "Example Party",
            party: "Column A · 2 candidates",
            name: "Example Party, Column A · 2 candidates",
            pref: 0,
          },
        ],
        aboveStatus: "0 numbered.",
        below: [
          {
            label: "Column A",
            rows: [
              {
                id: "Alex Doe|1",
                candidate: "Alex Doe",
                party: "Example Party",
                name: "Alex Doe, Example Party",
                pref: 2,
              },
            ],
          },
        ],
        belowStatus: "1 numbered.",
      },
      built: "28 Sept 2026",
      dataVersion: "2025-04-01",
      version: "1.0.0",
      attribution: "They Vote For You",
    },
  },
  { status: "unavailable" },
];

describe("the cards the app draws", () => {
  // Regenerate with UPDATE_CARD_FIXTURE=1.
  it("match the fixture the app's decoder is held to", () => {
    const path = new URL("../../../mobile/ios/Parity/card-model.json", import.meta.url);
    const json = JSON.stringify(CARDS, null, 2) + "\n";
    if (process.env["UPDATE_CARD_FIXTURE"]) writeFileSync(path, json);
    expect(readFileSync(path, "utf8")).toBe(json);
  });
});
