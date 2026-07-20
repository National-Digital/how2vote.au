import type { HouseCandidate, Party, PartyKey, SenateCandidate } from "./schemas.js";

/**
 * Resolves a ballot candidate to an internal party key.
 *
 * A candidate's AEC `party` string (and, for independents, their printed `candidate` name) is
 * matched against the party registry by value → key: first the canonical `aecName`, then any
 * `alias` (regional/original branch names, abbreviations). Procedural offices (`aecName === null`)
 * are never resolution targets and so never land on a ballot.
 *
 * Matching is exact but case- and whitespace-insensitive, which tolerates incidental formatting
 * drift in upstream AEC data without silently mapping genuinely different names together.
 */
export type PartyResolver = {
  /** Returns the resolved party key, or `null` when nothing in the registry matches. */
  resolve: (
    candidate: Pick<HouseCandidate | SenateCandidate, "party" | "candidate">,
  ) => PartyKey | null;
};

const norm = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();

export function buildPartyResolver(parties: readonly Party[]): PartyResolver {
  const byName = new Map<string, PartyKey>();

  const add = (name: string | null, key: PartyKey): void => {
    if (name === null) return;
    const n = norm(name);
    if (n.length === 0) return;
    // First registration wins; the party registry is authored to be unambiguous, and the
    // validation gate reports any name that maps to more than one key.
    if (!byName.has(n)) byName.set(n, key);
  };

  for (const party of parties) {
    add(party.aecName, party.key);
    for (const alias of party.aliases) add(alias, party.key);
  }

  return {
    resolve(candidate) {
      const party = candidate.party.trim();
      // A named party (anything other than blank or "Independent") MUST resolve on its own. It never
      // falls through to name-matching: an unmapped new party whose candidate name happened to match a
      // registry name/alias would otherwise resolve to the WRONG party record and slip past the
      // unresolved-candidate build gate. An unmapped named party returns null so the gate catches it.
      if (party.length > 0 && norm(party) !== "independent") {
        return byName.get(norm(party)) ?? null;
      }
      // Independents (blank or "Independent" party string) are matched by their printed name.
      const name = candidate.candidate.trim();
      if (name.length > 0) {
        const hit = byName.get(norm(name));
        if (hit !== undefined) return hit;
      }
      return null;
    },
  };
}

/** Detects registry names (aecName/alias) that resolve to more than one party key. */
export function findAmbiguousNames(
  parties: readonly Party[],
): { name: string; keys: PartyKey[] }[] {
  const byName = new Map<string, Set<PartyKey>>();
  const record = (name: string | null, key: PartyKey): void => {
    if (name === null) return;
    const n = norm(name);
    if (n.length === 0) return;
    const set = byName.get(n) ?? new Set<PartyKey>();
    set.add(key);
    byName.set(n, set);
  };
  for (const party of parties) {
    record(party.aecName, party.key);
    for (const alias of party.aliases) record(alias, party.key);
  }
  const out: { name: string; keys: PartyKey[] }[] = [];
  for (const [name, keys] of byName) {
    if (keys.size > 1) out.push({ name, keys: [...keys] });
  }
  return out;
}
