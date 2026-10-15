/**
 * The wording each surface gives an election's stage (`$lib/election-stage`). The components render
 * it as given, so the words are held here, beside the rule that picks them.
 */
import type { ElectionMeta, ElectionPhase } from "@how2vote/data-schema";
import { stageOfPhase, type Ballot, type Stage } from "$lib/election-stage";

const PROVISIONAL_LEAD = (count: number) =>
  `Answer ${count} real questions the current Parliament has voted on and see how your views compare with the parties' recorded votes.`;

/** The landing's lede: a sentence, and a muted note after it. */
export function landingLede(
  stage: Stage,
  { count, year, electorateLess }: { count: number; year: number; electorateLess: boolean },
): { lead: string; note?: string } {
  const ballotLead = electorateLess
    ? `Answer ${count} real questions parliament has voted on and see how your views compare with the parties' recorded votes.`
    : `Answer ${count} real questions parliament has voted on and see how your views compare with the parties' recorded votes, for your ${year} ballot — House and Senate.`;
  switch (stage) {
    case "unannounced":
      return {
        lead: PROVISIONAL_LEAD(count),
        note: "The next federal election hasn't been announced yet, so this is a provisional comparison against the current Parliament — the questions may change, and there are no candidates or printable how-to-vote plan yet.",
      };
    case "called":
      return {
        lead: PROVISIONAL_LEAD(count),
        note: "Candidates for this election aren't final yet, so this is a provisional comparison against the current Parliament — the questions may change, and there is no ballot or printable how-to-vote plan yet.",
      };
    case "listed":
      return {
        lead: PROVISIONAL_LEAD(count),
        note: "How2Vote doesn't have the AEC's declared candidates and ballot order yet, so this is a provisional comparison — the questions may change, and there is no printable how-to-vote plan yet.",
      };
    case "declared":
      return {
        lead: PROVISIONAL_LEAD(count),
        note: "The AEC has declared the candidates for this election, but How2Vote hasn't listed them yet, so this is a provisional comparison against the current Parliament — the questions may change until it does, and there is no printable how-to-vote plan here yet.",
      };
    case "ballot":
      return { lead: ballotLead };
    case "held":
      return {
        lead: ballotLead,
        note: "This election has already been held — what follows is a historical comparison, scored on the record as it stood then.",
      };
  }
}

/** The landing's step rail: an election without electorates has no ballot step. */
export function landingSteps(
  stage: Stage,
  { count, electorateLess }: { count: number; electorateLess: boolean },
): { n: string; d: string }[] {
  const compare = stage === "held" ? "Review the record" : "See how you compare";
  return electorateLess
    ? [
        { n: "1 · Answer", d: `${count} questions, ~5 min` },
        { n: "2 · Compare", d: compare },
      ]
    : [
        { n: "1 · Ballot", d: "Find your electorate" },
        { n: "2 · Answer", d: `${count} questions, ~5 min` },
        { n: "3 · Compare", d: compare },
      ];
}

/** The landing's stage-dependent parts for one election at one phase. */
export function landingCopy(election: {
  meta: ElectionMeta;
  phase: ElectionPhase;
  ballot: Ballot;
  count: number;
}) {
  const { meta, phase, ballot, count } = election;
  const stage = stageOfPhase(meta, phase, ballot);
  const electorateLess = ballot === "none";
  return {
    stage,
    lede: landingLede(stage, { count, year: meta.year, electorateLess }),
    steps: landingSteps(stage, { count, electorateLess }),
  };
}

/**
 * The card's note where its plan builder would be, when the stage, not a suspension, keeps it
 * closed: a held election without a drawn ballot has no plan to build. Otherwise null, and the card
 * shows its general closed-plan note.
 */
export function cardPlanNote(stage: Stage, ballot: Ballot): string | null {
  return stage === "held" && ballot !== "drawn"
    ? "How2Vote holds no declared ballot for this election, so there is no plan to build."
    : null;
}

/** A run of the card's hint; `bold` runs are emphasised. */
export type HintRun = { text: string; bold?: true };

const PARTIES_LEAD = (where: string): HintRun[] => [
  { text: "This shows how often the " },
  { text: "parties'", bold: true },
  { text: ` recorded votes${where} align with your answers — as ` },
  { text: "evidence only", bold: true },
];

const CHAMBERS_LEAD = (close: string): HintRun[] => [
  { text: "For each chamber, this shows how often the " },
  { text: "parties'", bold: true },
  { text: " recorded votes align with your answers — as " },
  { text: "evidence only", bold: true },
  {
    text: `. Nothing here is ranked or recommended: How2Vote does not tell you who to put first. ${close}`,
  },
];

const BALLOT_HINT = CHAMBERS_LEAD("When you're ready, you build your own order.");

/** The card's hint above its panels. */
export function cardHint(stage: Stage, electorateLess: boolean): HintRun[] {
  switch (stage) {
    case "unannounced":
      return [
        ...PARTIES_LEAD(" in the current Parliament"),
        {
          text: ". The next election hasn't been announced, so there are no candidates or ballot yet; this is a provisional comparison against the parties, not a recommendation.",
        },
      ];
    case "called":
      return [
        ...PARTIES_LEAD(" in the current Parliament"),
        {
          text: ". Candidates for this election aren't final yet, so there is no ballot yet; this is a provisional comparison against the parties, not a recommendation.",
        },
      ];
    case "listed":
      return CHAMBERS_LEAD(
        "How2Vote doesn't have the AEC's declared candidates and ballot order yet, so there is no voting plan to build yet.",
      );
    case "declared":
      return [
        ...PARTIES_LEAD(" in the current Parliament"),
        {
          text: ". How2Vote hasn't listed this election's candidates yet; this is a provisional comparison against the parties, not a recommendation.",
        },
      ];
    case "ballot":
      return BALLOT_HINT;
    case "held":
      return electorateLess
        ? [
            ...PARTIES_LEAD(""),
            {
              text: ". This election has already been held and How2Vote holds no ballot for it; this is a historical comparison against the parties, not a recommendation.",
            },
          ]
        : BALLOT_HINT;
  }
}

/**
 * The electorate list's wording: its introduction, its search description, and whether it says
 * the candidates will be listed once the AEC declares nominations.
 */
export function electorateHubCopy(
  stage: Stage,
  { count, label, year }: { count: number; label: string; year: number },
): { intro: string; description: string; awaitsNominations: boolean; senateLink: string } {
  if (stage === "listed") {
    return {
      senateLink: "Senate candidates",
      intro: `Choose your federal electorate to see the candidates listed so far, or open your state's Senate candidates. How2Vote doesn't have the AEC's declared list and ballot order yet. ${year} election.`,
      description: `The candidates listed so far in all ${count} federal House electorates at the ${label}, by state, plus each state's Senate candidates; How2Vote doesn't have the AEC's declared list and ballot order yet.`,
      awaitsNominations: false,
    };
  }
  if (stage === "ballot" || count > 0) {
    return {
      senateLink: "Senate ballot",
      intro: `Choose your federal electorate to see every candidate on the House ballot, or open your state's Senate ballot. ${year} election.`,
      description: `Every candidate standing in all ${count} federal House electorates at the ${label}, by state, plus each state's Senate ballot.`,
      awaitsNominations: false,
    };
  }
  const none = (intro: string, description: string, awaitsNominations = false) => ({
    senateLink: "Senate ballot",
    intro,
    description,
    awaitsNominations,
  });
  switch (stage) {
    case "unannounced":
      return none(
        "The next federal election hasn't been announced yet, so no electorates or candidates have been drawn.",
        `Electorates and candidates for the ${label}. The election hasn't been announced yet, so no electorates or candidates have been drawn.`,
        true,
      );
    case "called":
      return none(
        "Candidates for this election aren't final yet, so no electorates or candidates are listed yet.",
        `Electorates and candidates for the ${label}. Candidates aren't final yet, so no electorates or candidates are listed yet.`,
        true,
      );
    case "declared":
      return none(
        "How2Vote hasn't listed this election's electorates and candidates yet.",
        `Electorates and candidates for the ${label}. How2Vote hasn't listed this election's electorates and candidates yet.`,
      );
    case "held":
      return none(
        "How2Vote holds no electorates or candidates for this election.",
        `How2Vote holds no electorates or candidates for the ${label}.`,
      );
  }
}
