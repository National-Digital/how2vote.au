/**
 * The copy of /how-to-decide that depends on the current election's stage. The page renders each
 * question and answer as a heading and a paragraph, and its FAQPage JSON-LD is built from the same
 * list, so the markup cannot say anything the page does not.
 *
 * Answers are plain text: links and glossary terms belong in the page's other paragraphs.
 */
import type { Stage } from "$lib/election-stage";

export type DecideFaq = { question: string; answer: string };

type Provisional = "unannounced" | "called" | "listed" | "declared";

const PROVISIONAL_NOTE: Record<Provisional, string> = {
  unannounced:
    "The election hasn't been announced yet, so the propositions are provisional and may change.",
  called: "Candidates aren't final yet, and the propositions may change until they are.",
  listed:
    "How2Vote doesn't have the AEC's declared candidates yet, and the propositions may change until it does.",
  declared:
    "The AEC has declared the candidates for this election, but How2Vote hasn't listed them yet, and the propositions may change until it does.",
};

const UNDECLARED: Record<Provisional, string> = {
  unannounced:
    "The next federal election hasn't been announced, so there are no candidates or ballot yet: your answers are compared with the parties' recorded votes in the current Parliament, as evidence only.",
  called:
    "Candidates for this election aren't final yet, so there is no ballot yet: your answers are compared with the parties' recorded votes in the current Parliament, as evidence only.",
  listed:
    "How2Vote doesn't have the AEC's declared candidates for this election yet: your answers are compared with the parties' recorded votes, as evidence only; the candidates listed so far are on each electorate's page. The voting plan opens once How2Vote has the AEC's declared ballot order and it is verified.",
  declared:
    "How2Vote hasn't listed this election's candidates yet, so there is no ballot here yet: your answers are compared with the parties' recorded votes in the current Parliament, as evidence only.",
};

function comparisonNote(stage: Stage, electorateLess: boolean): string {
  switch (stage) {
    case "ballot":
      return "Your comparison is shown beside the candidates in official ballot order, as evidence only. If you are 18 or over, you can then build your own voting plan from a blank ballot, in the order you choose.";
    case "held":
      return electorateLess
        ? "This election has already been held and How2Vote holds no ballot for it: your answers are compared with the parties' recorded votes, as a historical comparison and evidence only."
        : "This election has already been held, so your comparison is a historical comparison, scored on the record as it stood then and shown beside the candidates in official ballot order, as evidence only. A plan built for it is a historical demonstration and cannot be used to vote.";
    default:
      return UNDECLARED[stage];
  }
}

export function decideFaqs(election: {
  label: string;
  propositions: number;
  stage: Stage;
  electorateLess: boolean;
}): DecideFaq[] {
  const { label, propositions, stage, electorateLess } = election;
  const provisional = stage === "ballot" || stage === "held" ? null : stage;
  return [
    {
      question: "How do I decide my vote?",
      answer:
        "Start with the issues you care about, then compare your views with the parties' recorded votes in federal parliament. How2Vote does not recommend a candidate or party. It puts the voting record beside your own answers, and who you put first is your decision.",
    },
    {
      question: "What are the propositions?",
      answer: provisional
        ? `For the ${label}, How2Vote asks about ${propositions} propositions: concrete policy actions the current Parliament has voted on. Each one states the action alongside the competing interest it trades off against, so agreeing and disagreeing are equally reasonable. ${PROVISIONAL_NOTE[provisional]} Choosing and wording them is an editorial judgement, and the selection is versioned and published.`
        : `For the ${label}, How2Vote asks about ${propositions} propositions: concrete policy actions that federal parliament has voted on. Each one states the action alongside the competing interest it trades off against, so agreeing and disagreeing are equally reasonable. Choosing and wording them is an editorial judgement, and the selection is versioned and published.`,
    },
    {
      question: "Where does the voting record come from?",
      answer:
        "From They Vote For You, published by the OpenAustralia Foundation. It records each division (formal vote) in the House and Senate and gives each member an agreement figure from 0 to 100 for each policy. How2Vote averages the figures of a party's members and places the party on the same five-point scale you answer on. A party's position describes its members' recorded votes, not any individual candidate's personal views.",
    },
    {
      question: "Does How2Vote recommend a candidate or party?",
      answer: `No. How2Vote does not rank parties and does not recommend a preference order. ${comparisonNote(stage, electorateLess)}`,
    },
  ];
}

/** The opening of the page's "Compare your views" paragraph. */
export function compareLead(stage: Stage, electorateLess: boolean): string {
  switch (stage) {
    case "ballot":
      return "Choose your electorate, answer the propositions on a five-point scale, and see how your answers line up with each party's recorded votes beside the candidates on your ballot.";
    case "listed":
      return "Choose your electorate, answer the propositions on a five-point scale, and see how your answers line up with each party's recorded votes.";
    case "held":
      return electorateLess
        ? "Answer the propositions on a five-point scale and see how your views compare with the parties' recorded votes, as a historical comparison."
        : "Choose an electorate, answer the propositions on a five-point scale, and see how your answers line up with each party's recorded votes beside the candidates who stood, as a historical comparison.";
    default:
      return "Answer the propositions on a five-point scale and see how your views compare with the parties' recorded votes in the current Parliament.";
  }
}
