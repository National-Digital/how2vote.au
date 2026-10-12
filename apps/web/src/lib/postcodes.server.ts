/**
 * Build-time model for the postcode pages: the federal electorates each postcode falls in, from the
 * ABS correspondence compiled into data/postcodes/postcode-electorates.json. Pages exist only for
 * the elections data/postcodes/source-record.json lists, i.e. those fought on the boundary edition
 * the correspondence describes.
 */
import { electionById, ELECTIONS } from "@how2vote/data-schema";
import { slugify } from "@how2vote/engine";
import compiled from "$data/postcodes/postcode-electorates.json";
import record from "$data/postcodes/source-record.json";
import { isNativeShell } from "./channel";
import { datasetFor, type Seo } from "./content.server";
import { STATES, stateName } from "./data";
import { POSTCODE_ATTRIBUTION, POSTCODE_LICENCE_URL } from "./postcodeLicence";

export const AEC_ELECTORATE_FINDER = "https://electorate.aec.gov.au/";

type Membership = { in: string[]; partly?: string[] };
type ElectionScope = {
  electionId: string;
  states?: string;
  excludeStates?: string[];
  checkedAt?: string;
  boundaryChanges?: { state: string; determinedAt: string; url: string }[];
};

const POSTCODES: Record<string, Membership> = Object.fromEntries(
  (compiled.postcodes as ({ postcode: string } & Membership)[]).map(({ postcode, ...m }) => [
    postcode,
    m,
  ]),
);

/** The ABS datasets the correspondence is compiled from, as the compiled file cites them. */
export const POSTCODE_SOURCES: { title: string; url: string }[] = compiled.source;
const SCOPES = record.elections as ElectionScope[];
const BOUNDARY_ELECTION: string = record.boundaryElection;

/** Electorate name → state code, from the election fought on these boundaries. */
const STATE_OF: Map<string, string> = new Map(
  (datasetFor(BOUNDARY_ELECTION)?.ballots.electorates ?? []).map((e) => [
    e.electorate,
    e.state.toUpperCase(),
  ]),
);

/** Postcode pages are web-only: the app channels neither build nor link them. */
const scopeFor = (electionId: string): ElectionScope | undefined =>
  !isNativeShell && ELECTIONS.some((e) => e.id === electionId)
    ? SCOPES.find((s) => s.electionId === electionId)
    : undefined;

const statesOf = (m: Membership): string[] =>
  [...new Set([...m.in, ...(m.partly ?? [])].map((n) => STATE_OF.get(n) ?? ""))].filter(Boolean);

const PUBLISHED = new Map<string, string[]>();

/** Postcodes published for an election, in ascending order. */
export function postcodesFor(electionId: string): string[] {
  const cached = PUBLISHED.get(electionId);
  if (cached) return cached;
  const scope = scopeFor(electionId);
  const excluded = new Set(scope?.excludeStates ?? []);
  const list = scope
    ? Object.keys(POSTCODES)
        .filter((pc) => !statesOf(POSTCODES[pc]!).some((s) => excluded.has(s)))
        .sort()
    : [];
  PUBLISHED.set(electionId, list);
  return list;
}

/** Elections that have postcode pages. */
export const postcodeElections = (): string[] =>
  ELECTIONS.map((e) => e.id).filter((id) => scopeFor(id));

export const postcodeHubEntries = (): { election: string }[] =>
  postcodeElections().map((election) => ({ election }));

export function postcodeEntries(): { election: string; postcode: string }[] {
  return postcodeElections().flatMap((election) =>
    postcodesFor(election).map((postcode) => ({ election, postcode })),
  );
}

/** Postcode hub and detail paths, for the sitemap. */
export const postcodePaths = (): string[] => [
  ...postcodeElections().map((e) => `/${e}/postcodes`),
  ...postcodeEntries().map((x) => `/${x.election}/postcodes/${x.postcode}`),
];

export type PostcodeElectorate = {
  name: string;
  stateName: string;
  href: string | null;
  /** Year of the ballot the link opens, when it is not this page's election. */
  linkYear: number | null;
};

export type PostcodePage = {
  seo: Seo;
  postcode: string;
  label: string;
  appliesTo: string;
  intro: string;
  /** The below-minimum electorates as one phrase ("A or B"), or "" when there are none. */
  partlyText: string;
  /** More than one electorate holds a share above the ABS minimum output size. */
  split: boolean;
  /** The postcode touches more than one electorate, so the reader should check the address. */
  checkAddress: boolean;
  electorates: PostcodeElectorate[];
  partly: PostcodeElectorate[];
  hubHref: string;
  finderUrl: string;
  attribution: string;
  licenceUrl: string;
  sources: { title: string; url: string }[];
};

function electorateLink(electionId: string, name: string): PostcodeElectorate {
  const slug = slugify(name);
  const state = STATE_OF.get(name) ?? "";
  for (const id of [electionId, BOUNDARY_ELECTION]) {
    const ds = datasetFor(id);
    if (ds?.ballots.electorates.some((e) => slugify(e.electorate) === slug)) {
      return {
        name,
        stateName: stateName(state),
        href: `/${id}/electorates/${slug}`,
        linkYear: id === electionId ? null : (electionById(id)?.year ?? null),
      };
    }
  }
  return { name, stateName: stateName(state), href: null, linkYear: null };
}

const longDate = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

/** "A", "A or B", "A, B or C". */
const orList = (names: string[]): string =>
  names.length > 1
    ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`
    : (names[0] ?? "");

/** A short election phrase for meta descriptions, with the boundary caveat where it applies. */
function electionPhrase(electionId: string): string {
  const meta = electionById(electionId);
  const scope = scopeFor(electionId);
  if (!meta || !scope) return "";
  if (electionId === BOUNDARY_ELECTION) return `the ${meta.year} federal election`;
  const boundary = electionById(BOUNDARY_ELECTION)?.year ?? BOUNDARY_ELECTION;
  const checked = scope.checkedAt ? `, as at ${longDate(scope.checkedAt)}` : "";
  return `the ${meta.current ? "next" : meta.year} federal election (${boundary} boundaries${checked})`;
}

/** The election and boundaries a page applies to, as shown on the page. */
export function appliesTo(electionId: string, subject = "these postcodes"): string {
  const meta = electionById(electionId);
  const scope = scopeFor(electionId);
  if (!meta || !scope) return "";
  if (electionId === BOUNDARY_ELECTION) {
    return `the ${meta.year} federal election, on the electorate boundaries used at that election`;
  }
  const boundary = electionById(BOUNDARY_ELECTION)?.year ?? BOUNDARY_ELECTION;
  const checked = scope.checkedAt ? ` as at ${longDate(scope.checkedAt)}` : "";
  return `the ${meta.current ? "next" : meta.year} federal election, using the electorate boundaries of the ${boundary} election, which were unchanged for ${subject}${checked}`;
}

export function buildPostcodePage(electionId: string, postcode: string): PostcodePage | null {
  const meta = electionById(electionId);
  if (!meta || !postcodesFor(electionId).includes(postcode)) return null;
  const m = POSTCODES[postcode]!;
  const electorates = m.in.map((n) => electorateLink(electionId, n));
  const partly = (m.partly ?? []).map((n) => electorateLink(electionId, n));
  const split = electorates.length > 1;
  const mainly = !split && partly.length > 0;
  const main = electorates[0]!;
  const minor = orList(partly.map((e) => e.name));
  const applies = appliesTo(electionId, "this postcode");
  const when = electionPhrase(electionId);
  const intro = split
    ? `Postcode ${postcode} spans more than one federal electorate. This applies to ${applies}.`
    : mainly
      ? `Postcode ${postcode} falls mainly in the federal electorate of ${main.name}, ${main.stateName}; a small part may be in ${minor}. This applies to ${applies}.`
      : `Postcode ${postcode} falls in the federal electorate of ${main.name}, ${main.stateName}. This applies to ${applies}.`;
  return {
    seo: {
      title: `Postcode ${postcode} federal electorate — ${meta.shortLabel} — How2Vote`,
      description: split
        ? `Postcode ${postcode} spans more than one federal electorate (${m.in.join(", ")}) for ${when}${minor ? `; a small part may be in ${minor}` : ""}. Check your address with the AEC.`
        : mainly
          ? `Postcode ${postcode} falls mainly in ${main.name} for ${when}; a small part may be in ${minor}. Check your address with the AEC.`
          : `Postcode ${postcode} falls in the federal electorate of ${main.name} for ${when}.`,
    },
    postcode,
    label: meta.label,
    appliesTo: applies,
    intro,
    partlyText: minor,
    split,
    checkAddress: split || mainly,
    electorates,
    partly,
    hubHref: `/${electionId}/postcodes`,
    finderUrl: AEC_ELECTORATE_FINDER,
    attribution: POSTCODE_ATTRIBUTION,
    licenceUrl: POSTCODE_LICENCE_URL,
    sources: POSTCODE_SOURCES,
  };
}

function notListed(scope: ElectionScope): PostcodeHub["notListed"] {
  const excluded = scope.excludeStates ?? [];
  if (excluded.length === 0) return null;
  const dates = (scope.boundaryChanges ?? []).map((c) => c.determinedAt).sort();
  const names = STATES.filter((s) => excluded.includes(s.code)).map((s) =>
    s.code === "ACT" || s.code === "NT" ? `the ${s.name}` : s.name,
  );
  const list =
    names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : names[0];
  const when = dates.length ? ` on ${longDate(dates[dates.length - 1]!)}` : "";
  return `Postcodes that fall in an electorate in ${list} are not listed. Those electorates were redrawn${when}, and the postcode data used here describes the earlier boundaries.`;
}

export type PostcodeHub = {
  seo: Seo;
  label: string;
  appliesTo: string;
  states: { code: string; name: string; postcodes: { postcode: string; href: string }[] }[];
  notListed: string | null;
  finderUrl: string;
  attribution: string;
  licenceUrl: string;
  sources: { title: string; url: string }[];
};

export function buildPostcodeHub(electionId: string): PostcodeHub | null {
  const meta = electionById(electionId);
  const scope = scopeFor(electionId);
  if (!meta || !scope) return null;
  const all = postcodesFor(electionId);
  const states = STATES.map((s) => ({
    code: s.code,
    name: s.name,
    postcodes: all
      .filter((pc) => statesOf(POSTCODES[pc]!).includes(s.code))
      .map((postcode) => ({ postcode, href: `/${electionId}/postcodes/${postcode}` })),
  })).filter((s) => s.postcodes.length > 0);
  return {
    seo: {
      title: `Federal electorates by postcode — ${meta.shortLabel} — How2Vote`,
      description: `Find the federal electorate or electorates each Australian postcode falls in for ${electionPhrase(electionId)}, listed by state.`,
    },
    label: meta.label,
    appliesTo: appliesTo(electionId),
    states,
    notListed: notListed(scope),
    finderUrl: AEC_ELECTORATE_FINDER,
    attribution: POSTCODE_ATTRIBUTION,
    licenceUrl: POSTCODE_LICENCE_URL,
    sources: POSTCODE_SOURCES,
  };
}
