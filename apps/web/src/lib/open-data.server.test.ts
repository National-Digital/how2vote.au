import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ELECTIONS } from "@how2vote/data-schema";
import register from "$data/rights/rights-classes.json";
import {
  buildElectorateHub,
  buildElectoratePage,
  buildIssueHub,
  buildPartyHub,
  buildSenatePage,
  datasetFor,
  stateSlug,
} from "./content.server";
import propositionRights from "$data/rights/proposition-content-rights.json";
import { provenanceFor } from "./manifest";
import { openDataDatasetGraph } from "./structured-data";
import { ORG } from "./org";
import {
  FILE_BUILDERS,
  MODIFICATIONS,
  CONTENTS_LICENSE,
  aecSourcesFor,
  ballotName,
  KIND_DOMAIN,
  candidatesFile,
  dataEntries,
  dataIndex,
  jsonBody,
  kindsFor,
  openApiDocument,
  openDataCatalogue,
  partyNamesCredit,
  positionsFile,
  propositionsFile,
  rightsFor,
  type OpenDataKind,
} from "./open-data.server";
import { slugify } from "@how2vote/engine";

const RIGHTS_IDS = propositionRights.elections.map((e) => e.electionId);
const PUBLISHED = ELECTIONS.filter((e) => RIGHTS_IDS.includes(e.id));

const ROUTES = resolve(dirname(fileURLToPath(import.meta.url)), "../routes/data");

const classFor = (domain: string) => {
  const d = register.domains.find((x) => x.id === domain)!;
  return register.rightsClasses.find((c) => c.id === d.rightsClass)!;
};

type Schema = Record<string, unknown>;

/** Validates `value` against the subset of JSON Schema the OpenAPI document uses. */
function validate(value: unknown, schema: Schema, root: Schema, at = "$"): string[] {
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.replace("#/components/schemas/", "");
    const target = (root.components as { schemas: Record<string, Schema> }).schemas[name];
    if (!target) return [`${at}: unresolved ${schema.$ref}`];
    return validate(value, target, root, at);
  }
  const errors: string[] = [];
  if ("const" in schema && value !== schema.const) errors.push(`${at}: expected const`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(`${at}: not in enum`);
  switch (schema.type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return [`${at}: expected object`];
      }
      const props = (schema.properties ?? {}) as Record<string, Schema>;
      for (const key of (schema.required ?? []) as string[]) {
        if (!(key in value)) errors.push(`${at}.${key}: missing`);
      }
      for (const [key, v] of Object.entries(value)) {
        if (props[key]) errors.push(...validate(v, props[key], root, `${at}.${key}`));
        else if (schema.additionalProperties === false) errors.push(`${at}.${key}: not allowed`);
      }
      break;
    }
    case "array":
      if (!Array.isArray(value)) return [`${at}: expected array`];
      value.forEach((v, i) =>
        errors.push(...validate(v, schema.items as Schema, root, `${at}[${i}]`)),
      );
      break;
    case "string":
      if (typeof value !== "string") errors.push(`${at}: expected string`);
      break;
    case "boolean":
      if (typeof value !== "boolean") errors.push(`${at}: expected boolean`);
      break;
    case "integer":
      if (!Number.isInteger(value)) errors.push(`${at}: expected integer`);
      else {
        if (typeof schema.minimum === "number" && (value as number) < schema.minimum)
          errors.push(`${at}: below minimum`);
        if (typeof schema.maximum === "number" && (value as number) > schema.maximum)
          errors.push(`${at}: above maximum`);
      }
      break;
  }
  return errors;
}

const SCHEMA_FOR: Record<OpenDataKind, string> = {
  propositions: "PropositionsFile",
  positions: "PositionsFile",
  candidates: "CandidatesFile",
};

describe("open data files", () => {
  it("withholds every election without a proposition-content-rights entry", () => {
    const withheld = ELECTIONS.filter((e) => !RIGHTS_IDS.includes(e.id));
    expect(withheld.map((e) => e.id)).toContain("next");
    const doc = JSON.stringify(openApiDocument());
    const index = JSON.stringify(dataIndex());
    for (const { id } of withheld) {
      expect(kindsFor(id)).toEqual([]);
      expect(propositionsFile(id)).toBeNull();
      expect(positionsFile(id)).toBeNull();
      expect(candidatesFile(id)).toBeNull();
      expect(openDataCatalogue().some((f) => f.election === id)).toBe(false);
      expect(index).not.toContain(`"${id}"`);
      expect(doc).not.toContain(`"${id}"`);
      expect(
        openDataDatasetGraph(openDataCatalogue()).distribution.some((d) =>
          d.contentUrl.includes(`/data/${id}/`),
        ),
      ).toBe(false);
    }
  });

  it("publishes propositions and positions for every rights-settled election, candidates where there is a ballot", () => {
    for (const { id } of PUBLISHED) {
      const ds = datasetFor(id)!;
      expect(propositionsFile(id)).not.toBeNull();
      expect(positionsFile(id)).not.toBeNull();
      if (ds.ballots.electorates.length > 0) expect(candidatesFile(id)).not.toBeNull();
      else expect(candidatesFile(id)).toBeNull();
    }
    expect(dataEntries("candidates").length).toBeGreaterThan(0);
  });

  it("has a prerendered route for every file", () => {
    for (const kind of Object.keys(FILE_BUILDERS)) {
      expect(existsSync(resolve(ROUTES, `[election=election]/${kind}.json/+server.ts`))).toBe(true);
    }
    expect(existsSync(resolve(ROUTES, "index.json/+server.ts"))).toBe(true);
    expect(existsSync(resolve(ROUTES, "openapi.json/+server.ts"))).toBe(true);
  });

  for (const { id } of PUBLISHED) {
    describe(id, () => {
      const ds = datasetFor(id)!;

      for (const kind of kindsFor(id)) {
        it(`${kind} carries its own domain's licence, attribution and source, exactly as registered`, () => {
          const file = FILE_BUILDERS[kind](id) as Record<string, unknown>;
          const rc = classFor(KIND_DOMAIN[kind]);
          expect(file.license).toEqual({
            id: rc.licence.spdxId,
            name: rc.licence.name,
            url: rc.licence.url,
          });
          expect(file.attribution).toBe(rc.attribution);
          expect(file.copyright).toBe(rc.copyright);
          expect(file.source).toEqual({
            name: rc.source,
            organisation: rc.sourceOrg,
            url: kind === "candidates" ? aecSourcesFor(id)[0]!.url : rc.sourceUrl,
          });
          expect(file.election).toMatchObject({ id });
        });

        it(`${kind} names the publisher and states what was changed`, () => {
          const file = FILE_BUILDERS[kind](id) as Record<string, unknown>;
          expect(file.publisher).toEqual({ name: ORG.tradingName, url: ORG.website });
          expect(file.modifications).toBe(MODIFICATIONS[kind]);
          expect(String(file.modifications)).toMatch(/How2Vote/);
        });

        it(`${kind} validates against the OpenAPI schema`, () => {
          const doc = openApiDocument() as unknown as Schema;
          const file = FILE_BUILDERS[kind](id);
          expect(validate(file, { $ref: `#/components/schemas/${SCHEMA_FOR[kind]}` }, doc)).toEqual(
            [],
          );
        });

        it(`${kind} is byte-identical across builds`, () => {
          expect(jsonBody(FILE_BUILDERS[kind](id))).toBe(jsonBody(FILE_BUILDERS[kind](id)));
        });
      }

      it("propositions and positions are ODbL with the They Vote For You attribution", () => {
        for (const file of [propositionsFile(id)!, positionsFile(id)!]) {
          expect(file.license.id).toBe("ODbL-1.0");
          expect(file.license.url).toBe("https://opendatacommons.org/licenses/odbl/1-0/");
          expect(file.attribution).toBe(
            "Vote data © They Vote For You (OpenAustralia Foundation), ODbL",
          );
          expect(file.dataVersion).toBe(ds.questions.dataVersion);
          const provenance = provenanceFor(id);
          if (provenance) expect(file.provenance).toEqual(provenance);
          else expect(file).not.toHaveProperty("provenance");
        }
      });

      it("the election carries its provisional stage where it has one", () => {
        const meta = ELECTIONS.find((e) => e.id === id)!;
        for (const kind of kindsFor(id)) {
          const file = FILE_BUILDERS[kind](id) as { election: Record<string, unknown> };
          expect(file.election.provisionalStage).toBe(meta.provisionalStage);
        }
      });

      it("positions credit the AEC as the source of registered party names, without licensing them", () => {
        const file = positionsFile(id)!;
        const aec = classFor("candidate-ballots");
        expect(file.attributions).toEqual([
          {
            appliesTo: "parties[].name where independent is false",
            attribution: `Registered party names ${aec.copyright}`,
            source: { name: aec.source, organisation: aec.sourceOrg, url: aec.sourceUrl },
          },
        ]);
        expect(file.attributions[0]!.attribution).toBe(
          "Registered party names © Commonwealth of Australia (Australian Electoral Commission)",
        );
        expect(JSON.stringify(file)).not.toContain("CC-BY");
      });

      it("propositions and positions offer National Digital's contents under the DbCL", () => {
        for (const file of [propositionsFile(id)!, positionsFile(id)!]) {
          expect(file.contentsLicense).toEqual({
            id: "DbCL-1.0",
            name: "Open Data Commons Database Contents License v1.0",
            url: "https://opendatacommons.org/licenses/dbcl/1-0/",
          });
          expect(file.contentsNote).toBe(
            "National Digital licenses its contributions to this database (the adaptation of the proposition wording and the computed positions) under the DbCL, to the extent it has rights in them.",
          );
        }
        expect(propositionsFile(id)!.modifications).toBe(
          "Proposition wording adapted by How2Vote from They Vote For You policy descriptions; selection and wording are editorial (see https://how2vote.au/methodology).",
        );
        expect(candidatesFile(id) ?? {}).not.toHaveProperty("contentsLicense");
      });

      it("propositions follow the issue hub", () => {
        const hub = buildIssueHub(id)!;
        const file = propositionsFile(id)!;
        expect(file.propositions.map((p) => p.text)).toEqual(hub.issues.map((i) => i.text));
        expect(file.propositions.map((p) => p.url)).toEqual(
          hub.issues.map((i) => `https://how2vote.au${i.href}`),
        );
      });

      it("positions cover the parties the party hub lists, on the 1–5 scale", () => {
        const file = positionsFile(id)!;
        expect(file.parties.map((p) => p.name).sort()).toEqual(
          buildPartyHub(id)!
            .parties.map((p) => p.name)
            .sort(),
        );
        const keys = new Set(file.parties.map((p) => p.key));
        for (const row of file.positions) {
          for (const p of row.parties) {
            expect(keys.has(p.party)).toBe(true);
            expect(p.position).toBeGreaterThanOrEqual(1);
            expect(p.position).toBeLessThanOrEqual(5);
          }
        }
      });

      if (ds.ballots.electorates.length > 0) {
        it("candidates are CC BY 4.0 with the AEC attribution", () => {
          const file = candidatesFile(id)!;
          expect(file.license.id).toBe("CC-BY-4.0");
          expect(file.license.url).toBe("https://creativecommons.org/licenses/by/4.0/");
          expect(file.attribution).toBe(
            "Candidate and electorate data © Commonwealth of Australia (Australian Electoral Commission)",
          );
          expect(file.dataVersion).toBe(ds.ballots.dataVersion);
          expect(file.provenance.sources).toEqual(aecSourcesFor(id));
          expect(file.source.url.startsWith("https://www.aec.gov.au/")).toBe(true);
        });

        it("House candidates are in the order the electorate pages show", () => {
          const file = candidatesFile(id)!;
          const hub = buildElectorateHub(id)!;
          expect(file.house.map((e) => e.electorate)).toEqual(
            hub.states.flatMap((s) => s.electorates.map((e) => e.name)),
          );
          expect(file.house).toHaveLength(ds.ballots.electorates.length);
          for (const e of file.house) {
            const page = buildElectoratePage(id, slugify(e.electorate))!;
            expect(e.candidates.map((c) => [c.position, c.name, c.party])).toEqual(
              page.candidates.map((c) => [c.position, ballotName(c.candidate), c.party]),
            );
            expect(e.candidates.map((c) => c.position)).toEqual(e.candidates.map((_, i) => i + 1));
          }
          expect(file.house.reduce((n, e) => n + e.candidates.length, 0)).toBe(
            ds.ballots.house.length,
          );
        });

        it("Senate candidates are in the order the Senate pages show", () => {
          const file = candidatesFile(id)!;
          for (const s of file.senate) {
            const page = buildSenatePage(id, stateSlug(s.state))!;
            expect(s.groups.map((g) => g.group)).toEqual(page.groups.map((g) => g.group));
            for (const [i, g] of s.groups.entries()) {
              expect(g.candidates.map((c) => c.name)).toEqual(
                page.groups[i]!.candidates.map((c) => ballotName(c.candidate)),
              );
            }
          }
          expect(
            file.senate.reduce(
              (n, s) => n + s.groups.reduce((m, g) => m + g.candidates.length, 0),
              0,
            ),
          ).toBe(ds.ballots.senate.length);
        });

        it("candidate lines carry only ballot position, name and party", () => {
          const file = candidatesFile(id)!;
          const lines = [
            ...file.house.flatMap((e) => e.candidates),
            ...file.senate.flatMap((s) => s.groups.flatMap((g) => g.candidates)),
          ];
          for (const c of lines) {
            expect(Object.keys(c).sort()).toEqual(["name", "party", "position"]);
            expect(c.name).not.toMatch(/,\s*$/);
          }
        });
      }
    });
  }

  it("never mixes rights domains in one file", () => {
    for (const { id } of ELECTIONS) {
      for (const kind of kindsFor(id)) {
        const body = jsonBody(FILE_BUILDERS[kind](id));
        if (KIND_DOMAIN[kind] === "vote-positions") {
          expect(body).not.toMatch(/"(house|senate|candidates)"/);
          const file = FILE_BUILDERS[kind](id) as Record<string, unknown>;
          const { attributions: _scoped, ...rest } = file;
          expect(jsonBody(rest)).not.toContain("Australian Electoral Commission");
        } else {
          expect(body).not.toMatch(/"(propositions|positions|stance)"/);
          expect(body).not.toContain("ODbL");
        }
      }
    }
  });

  it("the DbCL grant matches the register and the proposition-rights record", () => {
    const notes = classFor("vote-positions").notes;
    expect(notes).toContain(CONTENTS_LICENSE.name);
    expect(notes).toContain(CONTENTS_LICENSE.id);
    expect(notes).toContain(CONTENTS_LICENSE.url);
    for (const e of propositionRights.elections) {
      expect(e.oafPermissionBasis).toContain("additionally licensed under the DbCL 1.0");
    }
  });

  it("refuses domains whose rights class does not permit redistribution", () => {
    expect(() => rightsFor("boundary-geometry")).toThrow(/does not permit redistribution/);
    expect(() => rightsFor("research-aggregates")).toThrow(/does not permit redistribution/);
    expect(() => rightsFor("no-such-domain")).toThrow(/unknown rights domain/);
  });

  it("the index lists every file with its licence", () => {
    const index = dataIndex();
    const doc = openApiDocument() as unknown as Schema;
    expect(validate(index, { $ref: "#/components/schemas/Index" }, doc)).toEqual([]);
    const listed = index.elections.flatMap((e) => e.files.map((f) => f.url));
    expect(listed).toEqual(openDataCatalogue().map((f) => f.url));
    expect(index.attributions.map((a) => a.attribution)).toEqual([
      classFor("vote-positions").attribution,
      classFor("candidate-ballots").attribution,
    ]);
    for (const e of index.elections) {
      for (const f of e.files) {
        expect(f.license).toBe(f.kind === "candidates" ? "CC-BY-4.0" : "ODbL-1.0");
        const credit = classFor(KIND_DOMAIN[f.kind]).attribution;
        expect(f.attribution).toBe(
          f.kind === "positions" ? `${credit}; ${partyNamesCredit().attribution}` : credit,
        );
      }
    }
  });

  it("the OpenAPI document describes every published path", () => {
    const doc = openApiDocument();
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths).sort()).toEqual(
      [
        "/data/index.json",
        "/data/{election}/candidates.json",
        "/data/{election}/positions.json",
        "/data/{election}/propositions.json",
      ].sort(),
    );
    const refs = JSON.stringify(doc).match(/#\/components\/schemas\/\w+/g) ?? [];
    for (const r of refs) {
      expect(doc.components.schemas).toHaveProperty(r.replace("#/components/schemas/", ""));
    }
  });

  it("each OpenAPI operation has an id, a 404 and only the elections it serves", () => {
    const doc = openApiDocument();
    expect(doc.security).toEqual([]);
    const ids = new Set<string>();
    for (const [path, item] of Object.entries(doc.paths)) {
      const op = item.get as {
        operationId: string;
        responses: Record<string, unknown>;
        parameters?: { schema: { enum: string[] } }[];
      };
      ids.add(op.operationId);
      expect(op.responses).toHaveProperty("404");
      if (op.parameters) {
        const kind = path.split("/").at(-1)!.replace(".json", "") as OpenDataKind;
        expect(op.parameters[0]!.schema.enum).toEqual(dataEntries(kind).map((e) => e.election));
      }
    }
    expect(ids.size).toBe(Object.keys(doc.paths).length);
    expect(
      (doc.paths["/data/{election}/candidates.json"].get.parameters ?? [])[0]!.schema.enum,
    ).not.toContain("next");
  });

  it("the OpenAPI schemas reject a file carrying the other domain's licence", () => {
    const doc = openApiDocument() as unknown as Schema;
    const id = dataEntries("candidates")[0]!.election;
    const swapped = { ...candidatesFile(id)!, license: propositionsFile(id)!.license };
    expect(
      validate(swapped, { $ref: "#/components/schemas/CandidatesFile" }, doc).length,
    ).toBeGreaterThan(0);
  });

  it("the rights register lists the published files as outputs of their domains", () => {
    const outputs = (domain: string) =>
      register.domains.find((d) => d.id === domain)!.outputs.join(" ");
    expect(outputs("vote-positions")).toContain("/data/*/propositions.json");
    expect(outputs("vote-positions")).toContain("/data/*/positions.json");
    expect(outputs("candidate-ballots")).toContain("/data/*/candidates.json");
  });

  it("llms.txt and llms-full.txt link every file with its licence", async () => {
    const short = await (await import("../routes/llms.txt/+server")).GET().text();
    const full = await (await import("../routes/llms-full.txt/+server")).GET().text();
    expect(short).toContain("https://how2vote.au/data/openapi.json");
    for (const f of openDataCatalogue()) {
      expect(short).toContain(`(${f.url}) (${f.license.id})`);
      expect(full).toContain(`${f.url} (${f.license.id})`);
    }
  });

  it("the service worker does not precache the data files", () => {
    const sw = readFileSync(resolve(ROUTES, "../../service-worker.ts"), "utf8");
    expect(sw).toMatch(/!path\.startsWith\("\/data\/"\)/);
  });
});
