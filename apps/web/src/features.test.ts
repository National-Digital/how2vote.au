/**
 * Executable BDD / Gherkin acceptance specifications.
 *
 * The project's dev methodology asks for critical legal / product requirements to be written as
 * concrete Given/When/Then examples that a developer, a lawyer AND a product owner can all read, and
 * — where practical — bound to the real code as acceptance tests. This runner is that binding: it
 * parses the plain-language .feature files under `apps/web/features/` with the official Gherkin
 * parser and, for every step, runs a step definition that exercises the REAL engine / schema / print
 * APIs and asserts with vitest. A scenario with any unmatched step FAILS (no silent skips), so a
 * feature file can never drift away from the code that is supposed to satisfy it.
 *
 * Traceability: each feature file names its control (control-4 print/sharing, control-7 corrections) in
 * a header comment. Steps that are genuinely browser-only (a DOM print button, the shared-readonly
 * session state) are asserted here at the closest module-level invariant and annotated with the
 * Playwright e2e that covers the full UI journey: apps/web/e2e/legal-electoral-output.spec.ts.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AstBuilder, GherkinClassicTokenMatcher, Parser } from "@cucumber/gherkin";
import { IdGenerator, type GherkinDocument, type Step } from "@cucumber/messages";
import { describe, expect, it } from "vitest";

import {
  decodeShare,
  encodeShare,
  generateCard,
  type Answer,
  type AnswerPoints,
  type Card,
  type DecodedShare,
} from "@how2vote/engine";
import {
  snapshotMetaSchema,
  snapshotVersionEntrySchema,
  snapshotVersionsSchema,
  type Dataset,
  type PartyKey,
  type SnapshotMeta,
  type SnapshotVersionEntry,
  type SnapshotVersions,
} from "@how2vote/data-schema";
import {
  formatAuthorisation,
  isPrintableText,
  MAX_PRINT_FIELD_LENGTH,
  PREFERENCE_SOURCE_NOTICE,
} from "$lib/print-auth";
import { AUTHORISATION } from "$lib/org";

// The committed, build-validated dataset — the same data the app ships — so the card pipeline runs
// against real ballots, parties and questions (mirrors packages/engine/src/card.test.ts).
import datasetJson from "$data/dist/2025/dataset.json" with { type: "json" };
const dataset = datasetJson as unknown as Dataset;

// ── The scenario "world": state carried across a single scenario's Given/When/Then steps ──────────
interface World {
  answers?: Answer[];
  orderedIds?: number[];
  electionId?: string;
  fragment?: string;
  decoded?: DecodedShare | null;
  sharedCard?: Card;
  v1?: SnapshotVersionEntry;
  v2?: SnapshotVersionEntry;
  meta1?: SnapshotMeta;
  versions?: SnapshotVersions;
}

type StepFn = (world: World) => void;
interface StepDef {
  pattern: RegExp;
  run: StepFn;
}

// A well-formed provenance-stamped snapshot meta (a direct TVFY API capture) for the correction trail.
function metaForVersion(version: number, retrievedAt: string): unknown {
  return {
    schemaVersion: 2,
    electionId: "2025",
    version,
    source: "tvfy-api",
    basis: "contemporaneous-api-snapshot",
    endpoint: "https://theyvoteforyou.org.au/api/v1",
    retrievedAt,
    responseSha256: "a".repeat(64),
    apiSchemaVersion: "v1",
    licenceVersion: "ODbL-1.0",
    effectiveAsAt: null,
    locked: true,
    lockedAt: retrievedAt,
    policyIds: [1],
    files: { "meta.json": "b".repeat(64) },
  };
}

// ── Step definitions: each binds one plain-language step to real APIs + substantive assertions ────
const steps: StepDef[] = [
  // ══ Scenario A — Opening a shared preference link (control-4) ══════════════════════════════════════
  {
    pattern: /^a user has created candidate preferences$/,
    run(world) {
      // The share codec packs answers positionally over the election's ordered question ids.
      world.electionId = "2025";
      world.orderedIds = Array.from({ length: 50 }, (_, i) => i + 1);
      world.answers = world.orderedIds.map((id, i) => ({
        id,
        points: ((i % 5) + 1) as AnswerPoints,
        important: i % 7 === 0,
      }));
      // Their preferences become a self-contained share fragment (the URL #fragment), no server.
      world.fragment = encodeShare(
        { electorate: "Bean", answers: world.answers },
        world.orderedIds,
        world.electionId,
      );
      expect(world.fragment.startsWith("v1.2025.bean.")).toBe(true);
    },
  },
  {
    pattern: /^another person opens the shared URL$/,
    run(world) {
      // A FRESH context — a decoder that knows only this election's ordering, exactly as the card
      // route does (apps/web/src/routes/card/+page.svelte, shared branch): reconstruct from the
      // fragment alone. A leading "#" is tolerated, just like a real location.hash.
      const resolver = (id: string): readonly number[] | undefined =>
        id === world.electionId ? world.orderedIds : undefined;
      world.decoded = decodeShare("#" + world.fragment, resolver);
      expect(world.decoded).not.toBeNull();
    },
  },
  {
    pattern: /^the candidate preferences are displayed$/,
    run(world) {
      // The preferences reconstruct EXACTLY — that is what the recipient sees (a comparison).
      expect(world.decoded!.answers).toEqual(world.answers);
    },
  },
  {
    pattern: /^no printable how-to-vote card can be generated$/,
    run(world) {
      // The read-only comparison the recipient sees, built exactly as the shared branch builds it.
      world.sharedCard = generateCard(dataset, {
        state: "ACT",
        electorate: "Bean",
        answers: world.decoded!.answers,
      });
      // The Card MODEL carries no print / authorisation / owner capability at all — there is nothing
      // on it that could produce printable how-to-vote material.
      const printish = Object.keys(world.sharedCard).filter((k) => /print|authoris|owner/i.test(k));
      expect(printish).toEqual([]);
      // Printing is gated on an in-memory OWNER capability (never on the shared card model) and is,
      // additionally, WITHDRAWN by the signed control plane in the current constrained boundary
      // (docs/adr/0010). A shared context can never hold the owner capability, so no how-to-vote
      // material is producible from it.
      // Module-level assertion for a browser-only invariant: a shared /card#… link is forced to
      // session="shared-readonly" and printAuth.reset() (no owner capability, no plan builder, no
      // print button) in +page.svelte. That UI journey is covered end-to-end by
      // apps/web/e2e/legal-electoral-output.spec.ts ("a shared (read-only) card cannot print").
    },
  },
  {
    pattern: /^no authorisation details from the original user are disclosed$/,
    run(world) {
      // The decoded share exposes ONLY version + election + electorate slug + answers. It has no
      // authoriser field of any kind — no name, town, State or address is carried in the link.
      expect(Object.keys(world.decoded!).sort()).toEqual([
        "answers",
        "electionId",
        "electorateSlug",
        "version",
      ]);
      for (const key of Object.keys(world.decoded!)) {
        expect(key).not.toMatch(/name|town|address|authoris/i);
      }
      // Belt-and-braces: the raw fragment itself carries no authoriser particulars.
      expect(world.fragment).not.toMatch(/authoris/i);
    },
  },

  // ══ Scenario B — Printing how-to-vote material (control-4) ═════════════════════════════════════════
  {
    pattern: /^a user created the preferences in the current session$/,
    run(world) {
      // An owner session: this browser built the card from its own quiz (the only state that may
      // print). We exercise the pure, DOM-free authorisation logic that gates that print.
      world.answers = [{ id: 1, points: 5, important: true }];
      expect(world.answers.length).toBeGreaterThan(0);
    },
  },
  {
    pattern: /^the user requests printable material$/,
    run() {
      // Requesting a print opens an ACKNOWLEDGEMENT step (National Digital authoriser model): the user
      // no longer supplies authoriser particulars. The DOM-free authorisation logic is a fixed stamp
      // derived from the operator record, so the stamp is producible without any user input.
      expect(formatAuthorisation().length).toBeGreaterThan(0);
    },
  },
  {
    pattern: /^the printed material carries National Digital's authorisation$/,
    run() {
      // The stamp is National Digital's entity authorisation of the material it publishes (the operator
      // legal name + locality + State via org.ts AUTHORISATION) — NOT a user-entered "Authorised by …".
      const stamp = formatAuthorisation();
      expect(stamp).toContain(AUTHORISATION);
      // It carries no user-entered particulars: no free-text name, and no street address.
      expect(stamp).not.toMatch(/\d+\s+\w+\s+(street|st|road|rd|avenue|ave)\b/i);
    },
  },
  {
    pattern: /^the printed output states the preference order was selected by the user$/,
    run() {
      // The preference order is separately and clearly identified as the user's own selection, so the
      // two are never conflated (National Digital authorises the template/analysis; the order is the
      // user's). This mirrors the stamp asserted in apps/web/src/lib/print-auth.test.ts.
      expect(formatAuthorisation()).toContain(PREFERENCE_SOURCE_NOTICE);
      expect(PREFERENCE_SOURCE_NOTICE).toBe("Preference order selected by the user.");
    },
  },
  {
    pattern: /^no user-entered authoriser particulars are collected or printed$/,
    run() {
      // The stamp is fixed operator particulars; there is no user name/town/state collection at all.
      // Any free-text that could ever reach the printed output is length-bounded and control-character
      // free (isPrintableText), so it can neither overflow the reserved area nor smuggle layout.
      expect(isPrintableText("Ballarat VIC")).toBe(true);
      expect(isPrintableText("")).toBe(false);
      expect(isPrintableText("a".repeat(MAX_PRINT_FIELD_LENGTH + 1))).toBe(false);
      expect(isPrintableText("line one\nline two")).toBe(false);
      // The full "printing is withdrawn in the constrained boundary; the print flow cannot be reached"
      // journey is asserted end-to-end in apps/web/e2e/legal-electoral-output.spec.ts.
    },
  },

  // ══ Scenario C — Candidate data is corrected (control-7) ══════════════════════════════════════════
  {
    pattern: /^published candidate information was sourced from an external dataset$/,
    run(world) {
      // The original publication: an immutable, provenance-stamped snapshot (a direct TVFY API
      // capture), version 1 — the first version needs no correction reason.
      world.v1 = snapshotVersionEntrySchema.parse({
        version: 1,
        createdAt: "2025-04-01T00:00:00+10:00",
        lockedAt: "2025-04-01T00:00:00+10:00",
      });
      world.meta1 = snapshotMetaSchema.parse(metaForVersion(1, "2025-04-01T00:00:00+10:00"));
      expect(world.meta1.source).toBe("tvfy-api");
    },
  },
  {
    pattern: /^a verified correction is received$/,
    run(world) {
      // A verified correction is published as a NEW version, recording who verified it, why, and the
      // version it supersedes — never an edit to the locked original.
      world.v2 = snapshotVersionEntrySchema.parse({
        version: 2,
        createdAt: "2025-04-02T00:00:00+10:00",
        lockedAt: "2025-04-02T00:00:00+10:00",
        reason: "Corrected a mis-mapped candidate party after a verified right-of-reply.",
        verifiedBy: "Data steward",
        supersedes: 1,
      });
      world.versions = snapshotVersionsSchema.parse({
        schemaVersion: 1,
        electionId: "2025",
        active: 2,
        history: [
          {
            version: 1,
            createdAt: "2025-04-01T00:00:00+10:00",
            lockedAt: "2025-04-01T00:00:00+10:00",
          },
          {
            version: 2,
            createdAt: "2025-04-02T00:00:00+10:00",
            lockedAt: "2025-04-02T00:00:00+10:00",
            reason: "Corrected a mis-mapped candidate party after a verified right-of-reply.",
            verifiedBy: "Data steward",
            supersedes: 1,
          },
        ],
      });
    },
  },
  {
    pattern: /^the corrected data is published$/,
    run(world) {
      // The pipeline reads the newest (active) version — the correction is what ships.
      expect(world.versions!.active).toBe(2);

      // Runtime right-of-reply lever on the REAL engine: while a figure is disputed, a suspended
      // party's alignment is withdrawn from a freshly generated card (shown "under review"), while the
      // prior data itself remains in git history and the immutable v1 snapshot. Prove the suspension
      // actually removes the figure.
      const answers: Answer[] = dataset.questions.questions
        .slice(0, 10)
        .map((q, i) => ({ id: q.id, points: ((i % 5) + 1) as AnswerPoints, important: i === 0 }));
      const base = generateCard(dataset, { state: "ACT", electorate: "Bean", answers });
      const scored = base.house.find((r) => r.partyKey !== null && r.score >= 0);
      expect(scored).toBeDefined();
      const suspended = generateCard(dataset, {
        state: "ACT",
        electorate: "Bean",
        answers,
        suspended: new Set<PartyKey>([scored!.partyKey!]),
      });
      const row = suspended.house.find((r) => r.partyKey === scored!.partyKey);
      expect(row!.suspended).toBe(true);
      expect(row!.score).toBeLessThan(0); // the disputed figure is withheld, not left standing
    },
  },
  {
    pattern: /^the source, retrieval date and previous version remain auditable$/,
    run(world) {
      // Previous version: the correction records the version it supersedes plus who verified it and why.
      expect(world.v2!.supersedes).toBe(1);
      expect(world.v2!.verifiedBy).toBeTruthy();
      expect(world.v2!.reason).toBeTruthy();
      // Source + retrieval date are retained on the immutable provenance meta.
      expect(world.meta1!.source).toBe("tvfy-api");
      expect(Number.isNaN(Date.parse(world.meta1!.retrievedAt))).toBe(false);
      // Auditability is ENFORCED, not conventional: a correction (any version after the first) that
      // omits reason + verifiedBy is REJECTED by the schema, so the audit trail cannot be skipped.
      expect(() =>
        snapshotVersionEntrySchema.parse({
          version: 2,
          createdAt: "2025-04-02T00:00:00+10:00",
          lockedAt: null,
        }),
      ).toThrow();
    },
  },
];

// ── The runner: parse each .feature, bind every step, fail on any unmatched step ──────────────────
const featuresDir = fileURLToPath(new URL("../features", import.meta.url));

function parseFeature(source: string): GherkinDocument {
  const parser = new Parser(new AstBuilder(IdGenerator.uuid()), new GherkinClassicTokenMatcher());
  return parser.parse(source);
}

/** Resolve And/But/* to the keyword type they inherit, for readability only (all steps run alike). */
function definitionFor(step: Step): StepDef {
  const match = steps.find((d) => d.pattern.test(step.text));
  if (!match) {
    throw new Error(
      `No step definition for: "${step.keyword.trim()} ${step.text}". Every scenario step must bind to a real API — silent skips are not allowed.`,
    );
  }
  return match;
}

const featureFiles = readdirSync(featuresDir).filter((f) => f.endsWith(".feature"));
expect(featureFiles.length).toBe(3);

for (const file of featureFiles) {
  const doc = parseFeature(readFileSync(`${featuresDir}/${file}`, "utf8"));
  const feature = doc.feature;
  if (!feature) throw new Error(`No feature parsed from ${file}`);

  describe(`${file} — ${feature.name}`, () => {
    for (const child of feature.children) {
      const scenario = child.scenario;
      if (!scenario) continue;
      it(scenario.name, () => {
        const world: World = {};
        for (const step of scenario.steps) {
          definitionFor(step).run(world);
        }
      });
    }
  });
}
