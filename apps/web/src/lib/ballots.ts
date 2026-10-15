import type { Ballot } from "$lib/election-stage";

/** What an election's committed dataset holds as a ballot, baked in at build (`__BALLOTS__`). */
export const ballotFor = (electionId: string): Ballot => __BALLOTS__[electionId] ?? "none";
