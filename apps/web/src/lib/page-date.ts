import { electionById } from "@how2vote/data-schema";
import { manifestFor } from "$lib/manifest";

/** Sections whose pages show the AEC's declared candidates as well as the voting record. */
const BALLOT_SECTIONS = new Set(["electorates", "senate"]);

/**
 * The date an election's data page was last modified: its data version (the date its voting
 * record is current to), or a later date its other content depends on. Ballot pages show the
 * candidates the AEC declared; `asAt` is any other source the page shows, as at when it was read.
 */
export function dataPageModified(electionId: string, section: string, asAt?: string): string {
  const dates = [manifestFor(electionId).dataVersion];
  const declared = electionById(electionId)?.timetable?.declarationOfNominations;
  if (BALLOT_SECTIONS.has(section) && declared) dates.push(declared.slice(0, 10));
  if (asAt) dates.push(asAt);
  return dates.sort().at(-1)!;
}
