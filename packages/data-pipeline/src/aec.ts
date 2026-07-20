import type { Electorate, HouseCandidate, SenateCandidate } from "@how2vote/data-schema";

/**
 * AEC candidate-nominations ingestion.
 *
 * The Australian Electoral Commission publishes the full list of House and Senate candidates once
 * nominations are declared, as CSV downloads on the AEC Tally Room / media-feed. This module parses
 * those CSVs into the ballot shapes the app uses. It is *ready to run* but not executed as part of
 * the current build: between elections there is no live nominations feed, so the 2025 ballots are
 * seeded from committed data (see `migrate.ts`). When the next election is called, point
 * {@link fetchAecNominations} at the published URLs and re-run.
 *
 * The candidate name is normalised to the ballot form "SURNAME, First".
 */

/** Minimal, correct CSV parser (RFC-4180-ish): quoted fields, escaped quotes, CRLF/LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, ""); // strip BOM

  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r[0] ?? "").trim().length > 0);
}

/** Turns a CSV (possibly with an AEC preamble line) into header-keyed record objects. */
export function csvToRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  // AEC files sometimes carry a one-line preamble before the header row; find the header row as the
  // first row containing a recognised column.
  const headerIndex = rows.findIndex((r) => r.some((c) => /^(StateAb|State)$/i.test(c.trim())));
  const start = headerIndex >= 0 ? headerIndex : 0;
  const header = (rows[start] ?? []).map((h) => h.trim());
  return rows.slice(start + 1).map((r) => {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => (rec[h] = (r[i] ?? "").trim()));
    return rec;
  });
}

const ballotName = (surname: string, given: string): string =>
  `${surname.trim().toUpperCase()}, ${given.trim()}`;

/** Maps AEC House nomination records to {@link HouseCandidate} rows. */
export function parseHouseNominations(text: string): HouseCandidate[] {
  return csvToRecords(text)
    .filter((r) => (r["DivisionNm"] ?? r["Division"]) && (r["Surname"] ?? r["CandidateNm"]))
    .map((r) => ({
      state: r["StateAb"] ?? r["State"] ?? "",
      division: r["DivisionNm"] ?? r["Division"] ?? "",
      candidate: r["CandidateNm"] ?? ballotName(r["Surname"] ?? "", r["GivenNm"] ?? ""),
      party: r["PartyNm"] ?? r["Party"] ?? "",
      position: Number(r["BallotPosition"] ?? r["Position"] ?? "0"),
    }));
}

/** Maps AEC Senate nomination records to {@link SenateCandidate} rows. */
export function parseSenateNominations(text: string): SenateCandidate[] {
  return csvToRecords(text)
    .filter((r) => (r["StateAb"] ?? r["State"]) && (r["Surname"] ?? r["CandidateNm"]))
    .map((r) => ({
      state: r["StateAb"] ?? r["State"] ?? "",
      group: r["Ticket"] ?? r["GroupAb"] ?? r["Group"] ?? "UG",
      candidate: r["CandidateNm"] ?? ballotName(r["Surname"] ?? "", r["GivenNm"] ?? ""),
      party: r["PartyNm"] ?? r["Party"] ?? "",
      position: Number(r["BallotPosition"] ?? r["Position"] ?? "0"),
    }));
}

/** Derives the unique State→Electorate list from House candidates. */
export function electoratesFromHouse(house: readonly HouseCandidate[]): Electorate[] {
  const seen = new Map<string, Electorate>();
  for (const c of house) {
    const key = `${c.state}/${c.division}`;
    if (!seen.has(key)) seen.set(key, { state: c.state, electorate: c.division });
  }
  return [...seen.values()].sort(
    (a, b) => a.state.localeCompare(b.state) || a.electorate.localeCompare(b.electorate),
  );
}

export type AecSources = {
  houseCsvUrl: string;
  senateCsvUrl: string;
  fetchImpl?: typeof fetch;
};

/** Downloads and parses the AEC House and Senate nominations from published CSV URLs. */
export async function fetchAecNominations(
  sources: AecSources,
): Promise<{ house: HouseCandidate[]; senate: SenateCandidate[]; electorates: Electorate[] }> {
  const impl = sources.fetchImpl ?? fetch;
  const [houseText, senateText] = await Promise.all([
    impl(sources.houseCsvUrl).then((r) => {
      if (!r.ok) throw new Error(`AEC house CSV → HTTP ${r.status}`);
      return r.text();
    }),
    impl(sources.senateCsvUrl).then((r) => {
      if (!r.ok) throw new Error(`AEC senate CSV → HTTP ${r.status}`);
      return r.text();
    }),
  ]);
  const house = parseHouseNominations(houseText);
  return {
    house,
    senate: parseSenateNominations(senateText),
    electorates: electoratesFromHouse(house),
  };
}
