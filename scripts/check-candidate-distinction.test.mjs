import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ROW_SOURCES,
  verdict,
  showsAlignment,
  withoutComments,
} from "./check-candidate-distinction.mjs";

const root = new URL("../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), "utf8");

const GOOD_ALIGN = `
export const PARTY_ALIGNMENT_QUALIFIER = "They are not evidence of an individual candidate's personal views";
export function alignmentPresentation(x) { return x; }
const s = "No party-position alignment available";
`;
// The per-candidate build row (PlanRow): no figure, no showScore, no alignmentPresentation.
const GOOD_ROW = `
let { candidate, party, pref } = $props();
<li><b>{candidate}</b> <span>{party}</span> <input value={pref} /></li>
`;
// The party-level panel: single-sources the decision, shows a figure only behind showScore, wires
// partyKey + suspended and renders the shared qualifier constant.
const GOOD_PANEL = `
import { alignmentPresentation, PARTY_ALIGNMENT_QUALIFIER } from "$lib/candidate-alignment";
let { parties } = $props();
const rows = parties.map((p) => ({ partyKey: p.partyKey, suspended: p.suspended, presentation: alignmentPresentation(p) }));
{#if rows[0].presentation.showScore}{rows[0].presentation.score}%{/if}
<p>{PARTY_ALIGNMENT_QUALIFIER}</p>
`;
const GOOD_SURFACE = {
  path: "apps/web/src/routes/card/+page.svelte",
  text: `<PartyAlignmentPanel parties={houseParties.map((r) => ({ partyKey: r.partyKey, suspended: r.suspended }))} />`,
};
const good = (over = {}) => ({
  alignModule: GOOD_ALIGN,
  planRow: GOOD_ROW,
  panel: GOOD_PANEL,
  alignmentSurfaces: [GOOD_SURFACE],
  ...over,
});
const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));

describe("verdict — real committed sources", () => {
  it("the shipped card + PlanRow + panel + alignment module wire the distinction from one source", () => {
    const res = verdict({
      alignModule: read("apps/web/src/lib/candidate-alignment.ts"),
      planRow: read("apps/web/src/lib/components/PlanRow.svelte"),
      panel: read("apps/web/src/lib/components/PartyAlignmentPanel.svelte"),
      alignmentSurfaces: [
        {
          path: "apps/web/src/routes/card/+page.svelte",
          text: read("apps/web/src/routes/card/+page.svelte"),
        },
      ],
      rowSources: ROW_SOURCES.map((source) => ({ ...source, text: read(source.path) })),
    });
    expect(res.errors).toEqual([]);
  });
});

describe("panel rows taken from the card's flow", () => {
  const PAGE = read("apps/web/src/routes/card/+page.svelte");
  const FLOW_PATH = "apps/web/src/lib/card-flow.svelte.ts";
  const FLOW = read(FLOW_PATH);
  const real = (flow = FLOW, page = PAGE) =>
    verdict({
      ...good(),
      alignmentSurfaces: [{ path: "apps/web/src/routes/card/+page.svelte", text: page }],
      rowSources: [{ ...ROW_SOURCES[0], text: flow }],
    });

  it("holds each row set the page's panels name to both props", () => {
    for (const name of ["houseParties", "senateParties"]) {
      const start = FLOW.indexOf(`${name} = $derived(`);
      const end = FLOW.indexOf("\n  );", start);
      const block = FLOW.slice(start, end);
      for (const prop of ["partyKey", "suspended"]) {
        const mutated =
          FLOW.slice(0, start) +
          block.replace(new RegExp(`\\n\\s*${prop}: r\\.${prop},`), "") +
          FLOW.slice(end);
        expect(mutated).not.toBe(FLOW);
        expect(hasError(real(mutated), `${name} never passes ${prop}`)).toBe(true);
      }
    }
  });

  it("holds the ballot-less panel's rows to both props, not to a name its code mentions", () => {
    for (const prop of ["suspended: isSusp,", "partyKey: key,"]) {
      const mutated = FLOW.replace(`\n        ${prop}`, "");
      expect(mutated).not.toBe(FLOW);
      const name = prop.split(":")[0];
      expect(hasError(real(mutated), `allPartyAlignments never passes ${name}`)).toBe(true);
    }
  });

  it("keeps a // inside a string as code", () => {
    expect(withoutComments('const u = "a//b"; // gone')).toBe('const u = "a//b"; \n');
    expect(withoutComments("const t = `x//${y}`;")).toBe("const t = `x//${y}`;");
  });

  it("does not take a prop named only in a comment", () => {
    const start = FLOW.indexOf("houseParties = $derived(");
    const end = FLOW.indexOf("\n  );", start);
    const block = FLOW.slice(start, end).replace(
      /\n\s*suspended: r\.suspended,/,
      "\n // suspended",
    );
    expect(
      hasError(
        real(FLOW.slice(0, start) + block + FLOW.slice(end)),
        "houseParties never passes suspended",
      ),
    ).toBe(true);
  });

  it("does not take a panel whose rows come from elsewhere", () => {
    const page = PAGE.replace("parties={flow.houseParties}", "parties={rows}");
    expect(page).not.toBe(PAGE);
    expect(hasError(real(FLOW, page), "never passes partyKey")).toBe(true);
  });
});

describe("showsAlignment", () => {
  it("detects a <PartyAlignmentPanel> surface", () => {
    expect(showsAlignment("<PartyAlignmentPanel parties={x} />")).toBe(true);
    expect(showsAlignment("<PlanRow party={x} />")).toBe(false);
    expect(showsAlignment("<p>nothing</p>")).toBe(false);
  });
});

describe("verdict — fail-closed wiring", () => {
  it("passes the good fixture", () => {
    expect(verdict(good()).ok).toBe(true);
  });

  it("fails if the module drops the party-not-candidate qualifier", () => {
    expect(
      hasError(
        verdict(
          good({
            alignModule:
              "export const PARTY_ALIGNMENT_QUALIFIER=1;export function alignmentPresentation(){}",
          }),
        ),
        "party-not-candidate",
      ),
    ).toBe(true);
  });

  it("fails if PlanRow renders a numeric alignment figure", () => {
    const withFigure = `let { candidate } = $props(); <b>{candidate}</b> <span>{score}%</span>`;
    expect(hasError(verdict(good({ planRow: withFigure })), "numeric alignment figure")).toBe(true);
  });

  it("fails if PlanRow uses the showScore gate (scores must be party-panel-only)", () => {
    const withGate = `let { partyKey } = $props(); {#if p.showScore}{p.badge}{/if}`;
    expect(hasError(verdict(good({ planRow: withGate })), "showScore")).toBe(true);
  });

  it("fails if the panel renders a raw figure with no showScore gate", () => {
    const noGate = `import { alignmentPresentation, PARTY_ALIGNMENT_QUALIFIER } from "$lib/candidate-alignment"; let {parties}=$props(); const r = parties.map((p)=>({partyKey:p.partyKey,suspended:p.suspended})); {PARTY_ALIGNMENT_QUALIFIER}`;
    expect(hasError(verdict(good({ panel: noGate })), "showScore gate")).toBe(true);
  });

  it("fails if the panel omits partyKey or suspended", () => {
    const noProps = `import { alignmentPresentation, PARTY_ALIGNMENT_QUALIFIER } from "$lib/candidate-alignment"; let {parties}=$props(); {#if p.showScore}{p.score}%{/if} {PARTY_ALIGNMENT_QUALIFIER}`;
    const res = verdict(good({ panel: noProps }));
    expect(hasError(res, "must reference partyKey")).toBe(true);
    expect(hasError(res, "must reference suspended")).toBe(true);
  });

  it("fails if the panel hard-copies the qualifier instead of rendering the constant", () => {
    const copied = `import { alignmentPresentation } from "$lib/candidate-alignment"; let {parties}=$props(); const r={partyKey:1,suspended:1}; {#if p.showScore}{p.score}%{/if} They are not evidence of an individual candidate's personal views`;
    expect(hasError(verdict(good({ panel: copied })), "hard-copies")).toBe(true);
  });

  it("fails a surface that omits partyKey or suspended", () => {
    const noProps = {
      path: "x.svelte",
      text: `<PartyAlignmentPanel parties={parties} />`,
    };
    const res = verdict(good({ alignmentSurfaces: [noProps] }));
    expect(hasError(res, "never passes partyKey")).toBe(true);
    expect(hasError(res, "never passes suspended")).toBe(true);
  });

  it("refuses to pass vacuously with no alignment surface", () => {
    expect(hasError(verdict(good({ alignmentSurfaces: [] })), "vacuously")).toBe(true);
  });
});
