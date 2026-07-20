import { z } from "zod";

/**
 * The 1–5 position scale is the shared contract between the party-position compiler
 * and the matching engine. It is deliberately the same scale the
 * user answers on, which is what makes the Manhattan distance meaningful.
 *
 *   1 strongly disagree · 2 disagree · 3 equal merits · 4 agree · 5 strongly agree
 *  -1 no data (the party had no members recorded on this issue)
 */
export const NO_DATA = -1 as const;

export const positionSchema = z.union([
  z.literal(NO_DATA),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
export type Position = z.infer<typeof positionSchema>;

/** Internal snake_case identifier for a party, independent, or procedural office. */
export const partyKeySchema = z
  .string()
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, "party key must be lower snake_case");
export type PartyKey = z.infer<typeof partyKeySchema>;

/**
 * How an entity in the party registry relates to a ballot:
 *  - `party`       a named political party
 *  - `independent` a single sitting member scored as their own "party"
 *  - `office`      a procedural office (President, Speaker, …) — never appears on a ballot
 */
export const partyKindSchema = z.enum(["party", "independent", "office"]);
export type PartyKind = z.infer<typeof partyKindSchema>;

/**
 * One entity in the party registry. Consolidates the two original join tables
 * (`manualMatchCandidates`, `manualSplitParties`) into a single, forward-keyed record.
 */
export const partySchema = z
  .object({
    /** Stable internal key used throughout the dataset and engine. */
    key: partyKeySchema,
    /** Human-readable display name shown in the UI. */
    displayName: z.string().min(1),
    /**
     * Canonical AEC ballot name (parties) or "SURNAME, First" (independents) used to resolve a
     * candidate's `party` string back to this key. `null` for procedural offices, which never
     * appear on a ballot.
     */
    aecName: z.string().min(1).nullable(),
    /** Additional AEC name variants (regional/original branches, abbreviations) that resolve here. */
    aliases: z.array(z.string().min(1)).default([]),
    kind: partyKindSchema,
    /**
     * Display label of the parliamentary bloc this party belongs to (e.g. "Coalition"). Parties
     * sharing the same label are a registered family — distinct parties with their own voting
     * records, presented together in the ballot-less party panel so a voter reads them as one
     * political force expressed under several state registrations. It is a factual, register-derived
     * grouping only: it never pools scores and never ranks — every member keeps its own figure.
     */
    federalGroup: z.string().min(1).optional(),
    /**
     * Short state/territory label for a state-specific branch (e.g. "Qld" for the LNP, "NT" for the
     * CLP), shown as a muted suffix so the branch's jurisdiction is legible. Omitted for parties that
     * contest nationally under one name.
     */
    region: z.string().min(1).optional(),
  })
  .strict();
export type Party = z.infer<typeof partySchema>;

/**
 * A pair of party keys to merge after scoring. Data that changes each
 * election cycle. The merge is applied before final ranking; it
 * merges raw scores, not already-rounded percentages, and ignores no-data sentinels.
 */
export const mergeSchema = z
  .object({
    master: partyKeySchema,
    merger: partyKeySchema,
  })
  .strict();
export type Merge = z.infer<typeof mergeSchema>;

/**
 * A party that still carries a compiled voting record but is **no longer on the AEC Register of
 * political parties** (deregistered, renamed, or wound up), so it cannot contest and must not be
 * shown as an option for a ballot-less UPCOMING election. Its key stays in {@link partySchema} so the
 * historical record and provenance remain intact and auditable; this list is the sibling of
 * {@link mergeSchema} — merges fold a predecessor's record into its successor, this removes a party
 * that has no successor to fold into. It is a curated, AEC-backed decision, so each entry records the
 * reason (which cites the AEC register). It has no effect on an election with a ballot, where the
 * candidate list already bounds which parties appear.
 */
export const deregisteredPartySchema = z
  .object({
    key: partyKeySchema,
    /** Why it is off the register — cites the AEC decision/date so the removal is auditable. */
    reason: z.string().min(1),
  })
  .strict();
export type DeregisteredParty = z.infer<typeof deregisteredPartySchema>;

export const partyRegistrySchema = z
  .object({
    parties: z.array(partySchema).min(1),
    merges: z.array(mergeSchema).default([]),
    /**
     * AEC party/candidate names explicitly acknowledged to have **no** parliamentary voting record
     * (e.g. brand-new micro-parties). Such candidates legitimately score -1.
     * Listing them here keeps "no data" intentional and auditable: the validation gate fails the
     * build for any ballot name that neither resolves to a party key nor appears here, so a name we
     * simply forgot to map can never silently score -1 in production (dataset gate).
     */
    noRecord: z.array(z.string().min(1)).default([]),
    /**
     * Parties with a compiled record that are no longer on the AEC register (see
     * {@link deregisteredPartySchema}). Excluded from the party-alignment panel and the per-election
     * party/issue pages so a ballot-less upcoming election never offers a party that cannot contest.
     * Optional / default empty: an election with a ballot needs none (its candidate list bounds this).
     */
    deregistered: z.array(deregisteredPartySchema).default([]),
    /** The AEC source the {@link deregistered} decisions were verified against (URL + retrieval note). */
    deregisteredSource: z.string().min(1).optional(),
  })
  .strict();
export type PartyRegistry = z.infer<typeof partyRegistrySchema>;

/**
 * A single proposition. `id` is the stable They Vote For You policy id, which both keys the
 * curated wording and links the proposition to its parliamentary divisions (the evidence the UI
 * surfaces). `positions` maps every scored entity key to its compiled 1–5 position (or -1).
 */
export const questionSchema = z
  .object({
    id: z.number().int().positive(),
    text: z.string().min(1),
    /** Earliest / latest division dates behind this policy (ISO date), for the data-vintage display. */
    divisionFirst: z.string().date().optional(),
    divisionLast: z.string().date().optional(),
    divisionCount: z.number().int().nonnegative().optional(),
    positions: z.record(partyKeySchema, positionSchema),
    /**
     * Set when a critical data error in this question cannot be corrected immediately: the
     * question is a DISABLED OUTPUT (ADR 0005) — hidden from the quiz, card and issues pages,
     * excluded from published stats, exempt from the snapshot-consistency gate, and listed on the
     * public /corrections page until a corrected snapshot version replaces it.
     */
    withdrawn: z
      .object({
        date: z.string().date(),
        reason: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();
export type Question = z.infer<typeof questionSchema>;

export const questionSetSchema = z
  .object({
    schemaVersion: z.literal(1),
    /** Data vintage — ISO date of the latest division the positions are compiled from. */
    dataVersion: z.string().date(),
    attribution: z.string().min(1),
    questions: z.array(questionSchema).min(1),
  })
  .strict();
export type QuestionSet = z.infer<typeof questionSetSchema>;

/**
 * The questions that may be presented and scored — everything not withdrawn (ADR 0005). The share
 * codec deliberately does NOT use this: it stays positional over the full question list so links
 * shared before a withdrawal still decode correctly; withdrawn answers are inert because scoring
 * and presentation both go through this filter.
 */
export const activeQuestions = (questions: QuestionSet): Question[] =>
  questions.questions.filter((q) => q.withdrawn === undefined);

const ballotBase = {
  state: z.string().min(1),
  /** Candidate as printed: "SURNAME, First". */
  candidate: z.string().min(1),
  /** AEC ballot party name; may be empty for ungrouped independents. */
  party: z.string(),
  /** Integer ballot order. */
  position: z.number().int().positive(),
};

export const houseCandidateSchema = z
  .object({ ...ballotBase, division: z.string().min(1) })
  .strict();
export type HouseCandidate = z.infer<typeof houseCandidateSchema>;

export const senateCandidateSchema = z.object({ ...ballotBase, group: z.string().min(1) }).strict();
export type SenateCandidate = z.infer<typeof senateCandidateSchema>;

export const electorateSchema = z
  .object({ state: z.string().min(1), electorate: z.string().min(1) })
  .strict();
export type Electorate = z.infer<typeof electorateSchema>;

/**
 * Where a ballot sits on the AEC nomination lifecycle. This is the SINGLE fact that decides whether a
 * candidate's `position` is authoritative, and therefore how the engine may order candidates:
 *  - `drawn`       the ballot draw has been declared (declaration of nominations): `position` is the
 *                  OFFICIAL printed order, and the engine renders candidates strictly in it — never
 *                  ranked by score (Commonwealth Electoral Act 1918 s 351; docs/adr/0006). This is the
 *                  default, so an omitted field can only ever mean the strict, official-order behaviour.
 *  - `provisional` candidates are known but the draw has NOT been declared, so no official order yet
 *                  exists: the engine renders them in a neutral, per-session RANDOM order to avoid the
 *                  systematic bias an alphabetical / incumbency order would introduce — still never
 *                  ranked by score (docs/adr/0013).
 *  - `pending`     no candidates yet (before nominations): the ballot arrays are empty and the card
 *                  shows the party voting-record alignment only.
 */
export const ballotStatusSchema = z.enum(["pending", "provisional", "drawn"]);
export type BallotStatus = z.infer<typeof ballotStatusSchema>;

export const ballotsSchema = z
  .object({
    schemaVersion: z.literal(1),
    dataVersion: z.string().date(),
    source: z.string().min(1),
    /**
     * Optional so the committed historical datasets (which predate this field and are read by a
     * runtime cast that never applies Zod defaults) are treated as `drawn` — the strict, official-order
     * default — by both the validator and the engine.
     */
    ballotStatus: ballotStatusSchema.optional(),
    house: z.array(houseCandidateSchema),
    senate: z.array(senateCandidateSchema),
    electorates: z.array(electorateSchema),
  })
  .strict()
  .superRefine((b, ctx) => {
    const status = b.ballotStatus ?? "drawn";
    if (status === "pending") {
      // A pending ballot asserts there are no candidates yet; a stray candidate would contradict the
      // status and could leak an unordered name into a surface that assumes an official order.
      for (const field of ["house", "senate"] as const) {
        if (b[field].length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} must be empty when ballotStatus is "pending"`,
          });
        }
      }
      return;
    }
    // A ballot that claims candidates exist (drawn or provisional) must actually carry them: this
    // preserves the original min(1) guarantee for every real election, so only an explicitly
    // `pending` (pre-nomination) dataset may ship with empty ballots.
    for (const field of ["house", "senate", "electorates"] as const) {
      if (b[field].length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} must be non-empty unless ballotStatus is "pending"`,
        });
      }
    }
  });
export type Ballots = z.infer<typeof ballotsSchema>;

/** The full build-ready dataset the application imports. */
export const datasetSchema = z
  .object({
    questions: questionSetSchema,
    parties: partyRegistrySchema,
    ballots: ballotsSchema,
  })
  .strict();
export type Dataset = z.infer<typeof datasetSchema>;
