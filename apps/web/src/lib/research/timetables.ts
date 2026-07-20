/**
 * Server-side authoritative election timetables for cohort classification.
 *
 * The research ingestion endpoint classifies WHEN a contribution was collected (pre-declaration /
 * live / post-election / historical) by comparing the server clock against the election's AEC
 * timetable boundaries. Those boundaries MUST come from the committed election registry keyed by the
 * election id — never from the request body: a hostile client that supplied its own boundaries could
 * otherwise stamp poison into any cohort it chose. This module is the single server-side source.
 *
 * Imported via a relative path (not the $data alias) so it resolves in the Pages Functions bundle,
 * matching the pattern in research/registry.ts.
 */
import elections from "../../../../../data/dist/elections.json";

/** The three boundary instants the cohort classifier needs. */
export type ResearchTimetable = {
  declarationOfNominations: string;
  pollsCloseAt: string;
  returnOfWrits: string;
};

type ElectionRecord = {
  id?: unknown;
  timetable?: Partial<ResearchTimetable> | null;
  provisionalStage?: unknown;
};

/** The lifecycle stage of a placeholder election that has no AEC timetable (see the election registry). */
export type ProvisionalStage = "pending" | "provisional" | "drawn";
const PROVISIONAL_STAGES = new Set<ProvisionalStage>(["pending", "provisional", "drawn"]);

const BY_ID = new Map<string, ResearchTimetable>();
const STAGE_BY_ID = new Map<string, ProvisionalStage>();
for (const e of elections as ElectionRecord[]) {
  if (typeof e?.id !== "string") continue;
  const t = e?.timetable;
  if (
    typeof t?.declarationOfNominations === "string" &&
    typeof t?.pollsCloseAt === "string" &&
    typeof t?.returnOfWrits === "string"
  ) {
    BY_ID.set(e.id, {
      declarationOfNominations: t.declarationOfNominations,
      pollsCloseAt: t.pollsCloseAt,
      returnOfWrits: t.returnOfWrits,
    });
  }
  if (
    typeof e.provisionalStage === "string" &&
    PROVISIONAL_STAGES.has(e.provisionalStage as ProvisionalStage)
  ) {
    STAGE_BY_ID.set(e.id, e.provisionalStage as ProvisionalStage);
  }
}

/**
 * The authoritative AEC timetable boundaries for an election id, or null when the id is unknown or
 * its timetable is incomplete (the classifier then returns "unknown" rather than guessing).
 */
export function timetableFor(electionId: string): ResearchTimetable | null {
  return BY_ID.get(electionId) ?? null;
}

/**
 * The provisional lifecycle stage for a placeholder election that has no AEC timetable, or null. It
 * is the research collection cohort for such an election, so a `pending` wave (questions in flight) is
 * never mixed with a `provisional` one (questions locked) — a deliberate series break.
 */
export function provisionalStageFor(electionId: string): ProvisionalStage | null {
  return STAGE_BY_ID.get(electionId) ?? null;
}
