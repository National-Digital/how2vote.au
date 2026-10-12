/**
 * Build-time static data files published under /data/: per election, the propositions, the
 * recorded party positions and the candidate ballots that the content pages render, plus an index
 * and an OpenAPI description of the files.
 *
 * The ODbL and CC BY terms, attributions, copyright and sources are read from the rights register
 * (data/rights/rights-classes.json). The DbCL grant for National Digital's contributions to the
 * ODbL files is recorded in the register's tvfy-odbl notes and held to it by the tests. The CC0
 * dedication covers the OpenAPI description document only, not the data files.
 *
 * The vote-positions and candidate-ballots domains go to separate files. Registered party names
 * in positions.json are credited to the AEC as their source under `attributions`, without a
 * licence of their own. Only elections with a proposition-content-rights entry are published. A
 * domain whose class does not permit redistribution is refused, so boundary geometry and research
 * aggregates cannot be published here. Rows come from the same builders the pages use.
 */
import type { Dataset, ElectionMeta } from "@how2vote/data-schema";
import { ELECTIONS, NO_DATA, activeQuestions, electionById } from "@how2vote/data-schema";
import { slugify } from "@how2vote/engine";
import propositionRights from "$data/rights/proposition-content-rights.json";
import register from "$data/rights/rights-classes.json";
import {
  STANCE,
  buildElectorateHub,
  buildElectoratePage,
  buildSenatePage,
  ballotStates,
  datasetFor,
  issueSlug,
  partySlug,
  scoredParties,
  stateSlug,
  tvfyPolicy,
} from "./content.server";
import { provenanceFor } from "./manifest";
import { ORG } from "./org";
import { SITE_URL } from "./seo";

/** Shape version of the published files; bumped only on a breaking change to their structure. */
export const OPEN_DATA_FORMAT = 1;

export const LICENSE_DATA_URL =
  "https://github.com/National-Digital/how2vote.au/blob/main/LICENSE-DATA.md";

export type OpenDataDomain = "vote-positions" | "candidate-ballots";
export type OpenDataKind = "propositions" | "positions" | "candidates";

export const KIND_DOMAIN: Record<OpenDataKind, OpenDataDomain> = {
  propositions: "vote-positions",
  positions: "vote-positions",
  candidates: "candidate-ballots",
};

/** What How2Vote changed, per file kind (stated alongside the upstream attribution). */
export const MODIFICATIONS: Record<OpenDataKind, string> = {
  propositions:
    "Proposition wording adapted by How2Vote from They Vote For You policy descriptions; selection and wording are editorial (see https://how2vote.au/methodology).",
  positions:
    "Party positions computed by How2Vote from They Vote For You member agreement figures (see https://how2vote.au/methodology).",
  candidates:
    "Restructured by How2Vote from the AEC candidate downloads: grouped by electorate (House) and by state and group (Senate), sorted by ballot position, the candidate field renamed to name, a trailing comma removed from single-name candidates, and no other fields kept.",
};

export const PARTY_NAMES_SCOPE = "parties[].name where independent is false";

/** National Digital's own contents in the ODbL files (proposition wording, computed positions). */
export const CONTENTS_LICENSE = {
  id: "DbCL-1.0",
  name: "Open Data Commons Database Contents License v1.0",
  url: "https://opendatacommons.org/licenses/dbcl/1-0/",
};
export const CONTENTS_NOTE =
  "National Digital licenses its contributions to this database (the adaptation of the proposition wording and the computed positions) under the DbCL, to the extent it has rights in them.";

/**
 * Credit for the AEC registered party names in positions.json. They are facts, credited to their
 * source; no licence is stated for them inside the ODbL file. Independents' names come from They
 * Vote For You member records and are outside this credit.
 */
export function partyNamesCredit() {
  const aec = rightsFor("candidate-ballots");
  return {
    appliesTo: PARTY_NAMES_SCOPE,
    attribution: `Registered party names ${aec.copyright}`,
    source: aec.source,
  };
}

export const PUBLISHER = { name: ORG.tradingName, url: ORG.website };

export type Licence = { id: string; name: string; url: string };
export type Source = { name: string; organisation: string; url: string };
export type Rights = {
  license: Licence;
  attribution: string;
  copyright: string;
  source: Source;
};

type RightsClass = (typeof register.rightsClasses)[number];

/** The rights block for a domain, from the register. Throws unless the class permits redistribution. */
export function rightsFor(domainId: string): Rights {
  const domain = register.domains.find((d) => d.id === domainId);
  if (!domain) throw new Error(`open data: unknown rights domain "${domainId}"`);
  const rc = register.rightsClasses.find((c) => c.id === domain.rightsClass) as
    RightsClass | undefined;
  if (!rc) throw new Error(`open data: domain "${domainId}" has no rights class`);
  if (rc.redistribution !== "permitted" || rc.licenceStatus !== "current" || !rc.licence.url) {
    throw new Error(`open data: rights class "${rc.id}" does not permit redistribution`);
  }
  return {
    license: { id: rc.licence.spdxId, name: rc.licence.name, url: rc.licence.url },
    attribution: rc.attribution,
    copyright: rc.copyright,
    source: { name: rc.source, organisation: rc.sourceOrg, url: rc.sourceUrl },
  };
}

type AecSourceRecord = {
  sources: { id: string; title: string; url: string; publishedAt?: string; retrievedAt?: string }[];
};

const AEC_SOURCES = Object.fromEntries(
  Object.entries(
    import.meta.glob<AecSourceRecord>("$data/source/*/aec-sources.json", {
      eager: true,
      import: "default",
    }),
  ).map(([path, record]) => [path.replace(/.*\/source\//, "").split("/")[0]!, record]),
) as Record<string, AecSourceRecord>;

/** The AEC downloads an election's ballot was built from, as recorded in data/source/<id>/. */
export function aecSourcesFor(electionId: string) {
  const record = AEC_SOURCES[electionId];
  if (!record) throw new Error(`open data: no AEC source record for "${electionId}"`);
  return record.sources.map((s) => ({
    id: s.id,
    title: s.title,
    url: s.url,
    ...(s.publishedAt ? { publishedAt: s.publishedAt } : {}),
    ...(s.retrievedAt ? { retrievedAt: s.retrievedAt } : {}),
  }));
}

type ElectionRef = {
  id: string;
  label: string;
  year: number;
  date?: string;
  provisionalStage?: string;
};

const electionRef = (meta: ElectionMeta): ElectionRef => ({
  id: meta.id,
  label: meta.label,
  year: meta.year,
  ...(meta.date ? { date: meta.date } : {}),
  ...(meta.provisionalStage ? { provisionalStage: meta.provisionalStage } : {}),
});

export const filePath = (electionId: string, kind: OpenDataKind): string =>
  `/data/${electionId}/${kind}.json`;

const hasBallot = (ds: Dataset): boolean => ds.ballots.electorates.length > 0;

/** Elections with a recorded proposition-content-rights position; no other election is published. */
const RIGHTS_SETTLED = new Set(propositionRights.elections.map((e) => e.electionId));

/** Which files exist for an election: candidates only where the election has a ballot. */
export function kindsFor(electionId: string): OpenDataKind[] {
  const ds = datasetFor(electionId);
  if (!ds || !RIGHTS_SETTLED.has(electionId)) return [];
  return hasBallot(ds)
    ? ["propositions", "positions", "candidates"]
    : ["propositions", "positions"];
}

export const dataEntries = (kind: OpenDataKind): { election: string }[] =>
  ELECTIONS.filter((e) => kindsFor(e.id).includes(kind)).map((e) => ({ election: e.id }));

function voteHeader(meta: ElectionMeta, kind: OpenDataKind, dataVersion: string) {
  const provenance = provenanceFor(meta.id);
  return {
    format: OPEN_DATA_FORMAT,
    election: electionRef(meta),
    dataVersion,
    ...rightsFor(KIND_DOMAIN[kind]),
    licenseDetails: LICENSE_DATA_URL,
    contentsLicense: CONTENTS_LICENSE,
    contentsNote: CONTENTS_NOTE,
    publisher: PUBLISHER,
    modifications: MODIFICATIONS[kind],
    ...(provenance ? { provenance } : {}),
  };
}

export function propositionsFile(electionId: string) {
  const meta = electionById(electionId);
  const ds = datasetFor(electionId);
  if (!meta || !ds || !kindsFor(electionId).includes("propositions")) return null;
  return {
    ...voteHeader(meta, "propositions", ds.questions.dataVersion),
    propositions: activeQuestions(ds.questions).map((q) => ({
      id: q.id,
      text: q.text,
      url: `${SITE_URL}/${electionId}/issues/${issueSlug(q.text)}`,
      sourceUrl: tvfyPolicy(q.id),
      ...(q.divisionCount !== undefined ? { divisionCount: q.divisionCount } : {}),
      ...(q.divisionFirst ? { divisionFirst: q.divisionFirst } : {}),
      ...(q.divisionLast ? { divisionLast: q.divisionLast } : {}),
    })),
  };
}

export function positionsFile(electionId: string) {
  const meta = electionById(electionId);
  const ds = datasetFor(electionId);
  if (!meta || !ds || !kindsFor(electionId).includes("positions")) return null;
  const parties = scoredParties(ds).sort((a, b) => a.displayName.localeCompare(b.displayName));
  return {
    ...voteHeader(meta, "positions", ds.questions.dataVersion),
    attributions: [partyNamesCredit()],
    scale: [5, 4, 3, 2, 1].map((value) => ({ value, stance: STANCE[value]! })),
    parties: parties.map((p) => ({
      key: p.key,
      name: p.displayName,
      independent: p.kind === "independent",
      url: `${SITE_URL}/${electionId}/parties/${partySlug(p)}`,
    })),
    positions: activeQuestions(ds.questions).map((q) => ({
      propositionId: q.id,
      parties: parties.flatMap((p) => {
        const position = q.positions[p.key];
        return position === undefined || position === NO_DATA
          ? []
          : [{ party: p.key, position, stance: STANCE[position]! }];
      }),
    })),
  };
}

/** A ballot name without the trailing comma the AEC surname/given-name join leaves on a mononym. */
export const ballotName = (name: string): string => name.replace(/,\s*$/, "").trim();

export function candidatesFile(electionId: string) {
  const meta = electionById(electionId);
  const ds = datasetFor(electionId);
  const hub = buildElectorateHub(electionId);
  if (!meta || !ds || !hub || !kindsFor(electionId).includes("candidates")) return null;
  const rights = rightsFor("candidate-ballots");
  const sources = aecSourcesFor(electionId);
  const line = (c: { position: number; candidate: string; party: string }) => ({
    position: c.position,
    name: ballotName(c.candidate),
    party: c.party,
  });
  return {
    format: OPEN_DATA_FORMAT,
    election: electionRef(meta),
    dataVersion: ds.ballots.dataVersion,
    ...rights,
    source: { ...rights.source, url: sources[0]!.url },
    licenseDetails: LICENSE_DATA_URL,
    publisher: PUBLISHER,
    modifications: MODIFICATIONS.candidates,
    provenance: { sources },
    house: hub.states.flatMap((s) =>
      s.electorates.map((e) => {
        const page = buildElectoratePage(electionId, slugify(e.name))!;
        return {
          electorate: page.electorate,
          state: s.code,
          url: `${SITE_URL}${e.href}`,
          candidates: page.candidates.map(line),
        };
      }),
    ),
    senate: ballotStates(ds).map((s) => {
      const page = buildSenatePage(electionId, stateSlug(s.code))!;
      return {
        state: s.code,
        url: `${SITE_URL}/${electionId}/senate/${stateSlug(s.code)}`,
        groups: page.groups.map((g) => ({ group: g.group, candidates: g.candidates.map(line) })),
      };
    }),
  };
}

export const FILE_BUILDERS: Record<OpenDataKind, (electionId: string) => object | null> = {
  propositions: propositionsFile,
  positions: positionsFile,
  candidates: candidatesFile,
};

const KIND_TITLE: Record<OpenDataKind, string> = {
  propositions: "Propositions",
  positions: "Party positions",
  candidates: "Candidates by electorate and Senate group",
};

export type CatalogueEntry = {
  election: string;
  kind: OpenDataKind;
  name: string;
  url: string;
  dataVersion: string;
  license: Licence;
  attribution: string;
  /** Every credit the file carries: the domain attribution, plus any scoped credit. */
  credit: string;
  source: string;
  year: number;
};

/** Every published file, newest election first, with its licence. */
export function openDataCatalogue(): CatalogueEntry[] {
  return ELECTIONS.flatMap((e) => {
    const ds = datasetFor(e.id)!;
    return kindsFor(e.id).map((kind) => {
      const rights = rightsFor(KIND_DOMAIN[kind]);
      return {
        election: e.id,
        kind,
        name: `${e.label}: ${KIND_TITLE[kind].toLowerCase()}`,
        url: `${SITE_URL}${filePath(e.id, kind)}`,
        dataVersion: kind === "candidates" ? ds.ballots.dataVersion : ds.questions.dataVersion,
        license: rights.license,
        attribution: rights.attribution,
        credit:
          kind === "positions"
            ? `${rights.attribution}; ${partyNamesCredit().attribution}`
            : rights.attribution,
        source: rights.source.url,
        year: e.year,
      };
    });
  });
}

/** Elections with at least one published file, newest first. */
export const publishedElections = (): ElectionMeta[] =>
  ELECTIONS.filter((e) => kindsFor(e.id).length > 0);

export function dataIndex() {
  const domains: OpenDataDomain[] = ["vote-positions", "candidate-ballots"];
  return {
    format: OPEN_DATA_FORMAT,
    openapi: `${SITE_URL}/data/openapi.json`,
    licenseDetails: LICENSE_DATA_URL,
    publisher: PUBLISHER,
    attributions: domains.map((domain) => {
      const r = rightsFor(domain);
      return {
        domain,
        license: r.license,
        attribution: r.attribution,
        copyright: r.copyright,
      };
    }),
    elections: publishedElections().map((e) => ({
      ...electionRef(e),
      files: openDataCatalogue()
        .filter((f) => f.election === e.id)
        .map((f) => ({
          kind: f.kind,
          url: f.url,
          dataVersion: f.dataVersion,
          license: f.license.id,
          attribution: f.credit,
        })),
    })),
  };
}

// ─── OpenAPI ────────────────────────────────────────────────────────────────────────────────────

const str = { type: "string" } as const;
const int = { type: "integer" } as const;
const obj = (properties: Record<string, unknown>, optional: string[] = []) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties).filter((k) => !optional.includes(k)),
  properties,
});
const arr = (items: unknown) => ({ type: "array", items });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

function rightsSchema(domain: OpenDataDomain) {
  const r = rightsFor(domain);
  return {
    license: obj({
      id: { type: "string", const: r.license.id },
      name: str,
      url: { type: "string", const: r.license.url },
    }),
    attribution: { type: "string", const: r.attribution },
    copyright: str,
    source: ref("Source"),
  };
}

function fileHeader(kind: OpenDataKind) {
  return {
    format: { type: "integer", const: OPEN_DATA_FORMAT },
    election: ref("Election"),
    dataVersion: { ...str, description: "Data version of the domain the file was built from." },
    ...rightsSchema(KIND_DOMAIN[kind]),
    licenseDetails: str,
    publisher: ref("Publisher"),
    modifications: { type: "string", const: MODIFICATIONS[kind] },
  };
}

const contentsSchema = {
  contentsLicense: obj({
    id: { type: "string", const: CONTENTS_LICENSE.id },
    name: str,
    url: { type: "string", const: CONTENTS_LICENSE.url },
  }),
  contentsNote: { type: "string", const: CONTENTS_NOTE },
};

export function openApiDocument() {
  const electionParam = (ids: string[]) => ({
    name: "election",
    in: "path",
    required: true,
    description: "Election id.",
    schema: { type: "string", enum: ids },
  });
  const allIds = publishedElections().map((e) => e.id);
  const ballotIds = dataEntries("candidates").map((e) => e.election);
  const get = (
    operationId: string,
    summary: string,
    description: string,
    schema: string,
    ids: string[] | null,
  ) => ({
    get: {
      operationId,
      summary,
      description,
      ...(ids ? { parameters: [electionParam(ids)] } : {}),
      responses: {
        "200": {
          description: "OK",
          content: { "application/json": { schema: ref(schema) } },
        },
        "404": { description: "No such file." },
      },
    },
  });
  const tvfy = rightsFor("vote-positions");
  const aec = rightsFor("candidate-ballots");
  const candidate = (position: string) =>
    obj({
      position: { ...int, description: position },
      name: { ...str, description: "Name as printed on the ballot paper." },
      party: {
        ...str,
        description:
          "Party as printed on the ballot paper. Blank means no party is printed; the site shows such a candidate as Independent.",
      },
    });
  return {
    openapi: "3.1.0",
    info: {
      title: "How2Vote static data files",
      version: String(OPEN_DATA_FORMAT),
      license: { name: "CC0-1.0", identifier: "CC0-1.0" },
      description: `Read-only static JSON files of the propositions, recorded party positions and candidate ballots shown on ${SITE_URL}, published by ${PUBLISHER.name}. Each file carries the licence, attribution and source of the data it holds, and states what How2Vote changed. Propositions and positions: ${tvfy.attribution} (${tvfy.license.id}), with National Digital's proposition wording and computed positions under the ${CONTENTS_LICENSE.id}; the party names in positions.json are credited to the ${aec.source.organisation} as their source. Candidates: ${aec.attribution} (${aec.license.id}). Full terms: ${LICENSE_DATA_URL}. This description itself is CC0-1.0.`,
    },
    servers: [{ url: SITE_URL }],
    security: [],
    paths: {
      "/data/index.json": get(
        "getIndex",
        "List the published files",
        "Every election and the files published for it.",
        "Index",
        null,
      ),
      "/data/{election}/propositions.json": get(
        "getPropositions",
        "Propositions for an election",
        `The propositions in the order the site lists them. ${tvfy.license.name}.`,
        "PropositionsFile",
        allIds,
      ),
      "/data/{election}/positions.json": get(
        "getPositions",
        "Recorded party positions for an election",
        `Each party's and independent's recorded position on each proposition, on a 1–5 scale. ${tvfy.license.name}; party names credited to the ${aec.source.organisation}.`,
        "PositionsFile",
        allIds,
      ),
      "/data/{election}/candidates.json": get(
        "getCandidates",
        "Candidate ballots for an election",
        `House candidates by electorate and Senate candidates by group, in ballot-paper order, for elections with a ballot. ${aec.license.name}.`,
        "CandidatesFile",
        ballotIds,
      ),
    },
    components: {
      schemas: {
        Election: obj({ id: str, label: str, year: int, date: str, provisionalStage: str }, [
          "date",
          "provisionalStage",
        ]),
        Source: obj({ name: str, organisation: str, url: str }),
        Publisher: obj({ name: str, url: str }),
        Licence: obj({ id: str, name: str, url: str }),
        VoteProvenance: obj({
          basis: str,
          retrievedAt: str,
          effectiveAsAt: { type: ["string", "null"] },
          statement: str,
        }),
        Index: obj({
          format: { type: "integer", const: OPEN_DATA_FORMAT },
          openapi: str,
          licenseDetails: str,
          publisher: ref("Publisher"),
          attributions: arr(
            obj({
              domain: { type: "string", enum: ["vote-positions", "candidate-ballots"] },
              license: ref("Licence"),
              attribution: str,
              copyright: str,
            }),
          ),
          elections: arr(
            obj(
              {
                id: str,
                label: str,
                year: int,
                date: str,
                provisionalStage: str,
                files: arr(
                  obj({
                    kind: { type: "string", enum: ["propositions", "positions", "candidates"] },
                    url: str,
                    dataVersion: str,
                    license: str,
                    attribution: str,
                  }),
                ),
              },
              ["date", "provisionalStage"],
            ),
          ),
        }),
        PropositionsFile: obj(
          {
            ...fileHeader("propositions"),
            ...contentsSchema,
            provenance: ref("VoteProvenance"),
            propositions: arr(
              obj(
                {
                  id: { ...int, description: "They Vote For You policy id." },
                  text: str,
                  url: str,
                  sourceUrl: str,
                  divisionCount: int,
                  divisionFirst: str,
                  divisionLast: str,
                },
                ["divisionCount", "divisionFirst", "divisionLast"],
              ),
            ),
          },
          ["provenance"],
        ),
        PositionsFile: obj(
          {
            ...fileHeader("positions"),
            ...contentsSchema,
            provenance: ref("VoteProvenance"),
            attributions: arr(
              obj({
                appliesTo: { type: "string", const: PARTY_NAMES_SCOPE },
                attribution: { type: "string", const: partyNamesCredit().attribution },
                source: ref("Source"),
              }),
            ),
            scale: arr(obj({ value: int, stance: str })),
            parties: arr(obj({ key: str, name: str, independent: { type: "boolean" }, url: str })),
            positions: arr(
              obj({
                propositionId: int,
                parties: arr(
                  obj({
                    party: { ...str, description: "Key into `parties`." },
                    position: { type: "integer", minimum: 1, maximum: 5 },
                    stance: str,
                  }),
                ),
              }),
            ),
          },
          ["provenance"],
        ),
        CandidatesFile: obj({
          ...fileHeader("candidates"),
          provenance: obj({
            sources: arr(
              obj({ id: str, title: str, url: str, publishedAt: str, retrievedAt: str }, [
                "publishedAt",
                "retrievedAt",
              ]),
            ),
          }),
          house: arr(
            obj({
              electorate: str,
              state: str,
              url: str,
              candidates: arr(candidate("Position on the House ballot paper (1-based).")),
            }),
          ),
          senate: arr(
            obj({
              state: str,
              url: str,
              groups: arr(
                obj({
                  group: str,
                  candidates: arr(candidate("Position within the group (1-based).")),
                }),
              ),
            }),
          ),
        }),
      },
    },
  };
}

/** Serialised body of a published file: stable key order, two-space indent, trailing newline. */
export const jsonBody = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export const jsonResponse = (value: unknown): Response =>
  new Response(jsonBody(value), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
