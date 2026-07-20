import type { PartyKey, Position } from "@how2vote/data-schema";

/**
 * Subsystem A — the party-position compiler.
 *
 * Converts the raw parliamentary voting records exposed by the They Vote For You API into a single
 * 1–5 "agreement" position per party per policy. Two properties matter:
 *
 *  - Each member is counted exactly once and the position is a plain mean, so the compiled position
 *    is independent of API response ordering.
 *  - Any party that participated buckets to 1–5, and only parties with no members on a policy are
 *    "no data".
 *
 * The compiler is pure and deterministic: the same API response always yields the same positions,
 * which is what lets CI rebuild and checksum the dataset.
 */

// — API response shapes (only the fields the compiler consumes) —

export type TvfyPolicySummary = {
  id: number;
  name: string;
  description: string;
};

export type TvfyPersonComparison = {
  person: {
    latest_member: {
      name: { first: string; last: string };
      house: "representatives" | "senate";
      party: string;
    };
  };
  /** TVFY's precomputed agreement percentage 0–100, as a string e.g. "58" or "0.0". */
  agreement: string;
};

export type TvfyPolicyDetail = {
  id: number;
  name: string;
  description: string;
  policy_divisions: { division: { date: string } }[];
  people_comparisons: TvfyPersonComparison[];
};

/**
 * Normalises a party string into a stable internal key: apostrophes removed
 * (straight and curly), whitespace collapsed to single underscores, lower-cased.
 * e.g. "Pauline Hanson's One Nation Party" → `pauline_hansons_one_nation_party`.
 */
export function normalisePartyKey(party: string): PartyKey {
  return party.replace(/['’]+/g, "").trim().replace(/\s+/g, "_").toLowerCase();
}

/**
 * Derives a member's party key, relabelling independents as their own single-member "party"
 * before normalisation:
 *   House independent  → "First Last MP"
 *   Senate independent → "Senator First Last"
 */
export function memberPartyKey(member: TvfyPersonComparison["person"]["latest_member"]): PartyKey {
  if (member.party === "Independent") {
    const full = `${member.name.first} ${member.name.last}`.trim();
    const label = member.house === "senate" ? `Senator ${full}` : `${full} MP`;
    return normalisePartyKey(label);
  }
  return normalisePartyKey(member.party);
}

/**
 * Maps an average agreement percentage (0–100) to a 1–5 position:
 * boundaries (ceiling) `(0,20]→1, (20,40]→2, (40,60]→3, (60,80]→4, (80,100]→5`, with an exact-zero
 * average forced into bucket 1.
 */
export function bucketAgreement(avg: number): Exclude<Position, -1> {
  if (avg <= 0) return 1;
  const bucket = Math.ceil((avg / 100) * 5);
  return Math.min(5, Math.max(1, bucket)) as Exclude<Position, -1>;
}

export type CompiledPolicy = {
  id: number;
  title: string;
  description: string;
  divisionCount: number;
  divisionFirst: string | null;
  divisionLast: string | null;
  /** Participating parties only (1–5). Absence of a key means "no data" for that party (-1). */
  positions: Record<PartyKey, Exclude<Position, -1>>;
};

/**
 * Compiles one policy's per-member agreements into per-party positions. Members are
 * grouped by derived key and averaged (each member counted exactly once); the
 * mean is bucketed to 1–5. Members whose agreement is not a finite number are ignored.
 */
export function compilePolicy(detail: TvfyPolicyDetail): CompiledPolicy {
  const sums = new Map<PartyKey, { total: number; count: number }>();

  for (const comparison of detail.people_comparisons) {
    // Skip blank/whitespace/null agreements BEFORE Number(): Number("") and Number(null) are 0 (a
    // finite value), which would otherwise be counted as 0% agreement — "strongly disagree" — and
    // drag the party mean down. Only a genuine numeric string contributes.
    const raw = comparison.agreement;
    if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
      continue;
    }
    const agreement = Number(raw);
    if (!Number.isFinite(agreement)) continue;
    const key = memberPartyKey(comparison.person.latest_member);
    const acc = sums.get(key) ?? { total: 0, count: 0 };
    acc.total += agreement;
    acc.count += 1;
    sums.set(key, acc);
  }

  const positions: Record<PartyKey, Exclude<Position, -1>> = {};
  for (const [key, { total, count }] of sums) {
    if (count === 0) continue; // no data → omit (implicitly -1)
    positions[key] = bucketAgreement(total / count);
  }

  const dates = detail.policy_divisions
    .map((d) => d.division.date)
    .filter((d): d is string => typeof d === "string" && d.length > 0)
    .sort();

  return {
    id: detail.id,
    title: detail.name,
    description: detail.description,
    divisionCount: detail.policy_divisions.length,
    divisionFirst: dates[0] ?? null,
    divisionLast: dates[dates.length - 1] ?? null,
    positions,
  };
}

export const TVFY_API_BASE = "https://theyvoteforyou.org.au/api/v1";

/** Minimal TVFY API client. Attribution and licence (ODbL) are honoured downstream. */
export class TvfyClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiKey) throw new Error("TVFY_API_KEY is required");
  }

  private async get<T>(path: string): Promise<T> {
    const sep = path.includes("?") ? "&" : "?";
    const res = await this.fetchImpl(`${TVFY_API_BASE}${path}${sep}key=${this.apiKey}`);
    if (!res.ok) throw new Error(`TVFY ${path} → HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  listPolicies(): Promise<TvfyPolicySummary[]> {
    return this.get<TvfyPolicySummary[]>("/policies.json");
  }

  getPolicy(id: number): Promise<TvfyPolicyDetail> {
    return this.get<TvfyPolicyDetail>(`/policies/${id}.json`);
  }
}
