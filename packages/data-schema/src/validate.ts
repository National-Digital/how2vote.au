import { buildPartyResolver, findAmbiguousNames } from "./resolve.js";
import {
  ballotsSchema,
  datasetSchema,
  partyRegistrySchema,
  questionSetSchema,
  type Ballots,
  type Dataset,
  type PartyRegistry,
  type QuestionSet,
} from "./schemas.js";

export type Severity = "error" | "warning";

export type ValidationIssue = {
  severity: Severity;
  /** Machine-readable issue code, e.g. "unresolved-candidate". */
  code: string;
  message: string;
  /** Named offenders (candidate names, party keys, …) so failures are actionable. */
  items?: string[];
};

export type ValidationReport = {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

const norm = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Parses raw JSON with the Zod schemas, throwing a readable error if the *shape* is wrong.
 * Returns strongly-typed data ready for {@link validateDataset}.
 */
export function parseDataset(raw: {
  questions: unknown;
  parties: unknown;
  ballots: unknown;
}): Dataset {
  return datasetSchema.parse({
    questions: questionSetSchema.parse(raw.questions),
    parties: partyRegistrySchema.parse(raw.parties),
    ballots: ballotsSchema.parse(raw.ballots),
  });
}

/**
 * The dataset integrity gate.
 *
 * Beyond the Zod shape check it verifies referential integrity across the three files:
 *  - every position key in every question exists in the party registry;
 *  - merge pairs reference real keys, and never merge an entity into itself;
 *  - procedural offices carry no ballot name and independents/parties do;
 *  - no registry name resolves ambiguously to two keys;
 *  - **every** House and Senate candidate's party string either resolves to a party key or is on
 *    the explicit `noRecord` allowlist — an unrecognised name is a build-failing error, never a
 *    silent -1;
 *  - every ballot division/state is covered by the electorate list.
 *
 * Pure and side-effect free: returns a structured report; the caller decides how to surface it.
 */
export function validateDataset(dataset: Dataset): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const { questions, parties, ballots } = dataset;
  const keys = new Set(parties.parties.map((p) => p.key));

  // — party registry internal consistency —
  const dupeKeys = parties.parties.map((p) => p.key).filter((k, i, a) => a.indexOf(k) !== i);
  if (dupeKeys.length > 0) {
    errors.push({
      severity: "error",
      code: "duplicate-party-key",
      message: "Duplicate party keys.",
      items: [...new Set(dupeKeys)],
    });
  }

  const officesWithName = parties.parties.filter((p) => p.kind === "office" && p.aecName !== null);
  if (officesWithName.length > 0) {
    errors.push({
      severity: "error",
      code: "office-with-ballot-name",
      message:
        "Procedural offices must not carry an AEC ballot name (they never appear on a ballot).",
      items: officesWithName.map((p) => p.key),
    });
  }

  const ballotablesWithoutName = parties.parties.filter(
    (p) => p.kind !== "office" && p.aecName === null,
  );
  if (ballotablesWithoutName.length > 0) {
    errors.push({
      severity: "error",
      code: "missing-ballot-name",
      message: "Parties and independents must carry an AEC ballot name to be matched to a ballot.",
      items: ballotablesWithoutName.map((p) => p.key),
    });
  }

  const ambiguous = findAmbiguousNames(parties.parties);
  if (ambiguous.length > 0) {
    errors.push({
      severity: "error",
      code: "ambiguous-registry-name",
      message: "Registry names that resolve to more than one party key.",
      items: ambiguous.map((a) => `"${a.name}" → ${a.keys.join(", ")}`),
    });
  }

  // — merges —
  for (const merge of parties.merges) {
    // An absent merger is expected: merges apply "only if both keys are present", and the
    // spec's merge list intentionally carries pairs whose members may not exist this cycle. So an
    // unknown key is a warning (a no-op merge), not a build failure.
    const missing = [merge.master, merge.merger].filter((k) => !keys.has(k));
    if (missing.length > 0) {
      warnings.push({
        severity: "warning",
        code: "merge-unknown-key",
        message: `Merge references key(s) absent from the registry (merge will be a no-op).`,
        items: missing,
      });
    }
    if (merge.master === merge.merger) {
      errors.push({
        severity: "error",
        code: "merge-self",
        message: `Merge master and merger are identical.`,
        items: [merge.master],
      });
    }
  }

  // — deregistered parties (off the AEC register; removed from a ballot-less election's surfaces) —
  const deregistered = parties.deregistered ?? [];
  const unknownDeregistered = deregistered.filter((d) => !keys.has(d.key)).map((d) => d.key);
  if (unknownDeregistered.length > 0) {
    errors.push({
      severity: "error",
      code: "deregistered-unknown-key",
      message: "Deregistered list references party keys absent from the registry.",
      items: unknownDeregistered,
    });
  }
  const deregisteredOffices = deregistered
    .map((d) => parties.parties.find((p) => p.key === d.key))
    .filter((p): p is (typeof parties.parties)[number] => p?.kind === "office")
    .map((p) => p.key);
  if (deregisteredOffices.length > 0) {
    errors.push({
      severity: "error",
      code: "deregistered-office",
      message: "Procedural offices cannot be deregistered parties (they never contest a ballot).",
      items: deregisteredOffices,
    });
  }

  // — questions ↔ registry —
  const unknownPositionKeys = new Set<string>();
  for (const q of questions.questions) {
    for (const key of Object.keys(q.positions)) {
      if (!keys.has(key)) unknownPositionKeys.add(`${key} (question ${q.id})`);
    }
  }
  if (unknownPositionKeys.size > 0) {
    errors.push({
      severity: "error",
      code: "unknown-position-key",
      message: "Question positions reference party keys absent from the registry.",
      items: [...unknownPositionKeys],
    });
  }

  const dupeQuestionIds = questions.questions
    .map((q) => q.id)
    .filter((id, i, a) => a.indexOf(id) !== i);
  if (dupeQuestionIds.length > 0) {
    errors.push({
      severity: "error",
      code: "duplicate-question-id",
      message: "Duplicate question ids.",
      items: [...new Set(dupeQuestionIds)].map(String),
    });
  }

  // — candidate resolution (the core dataset gate) —
  const resolver = buildPartyResolver(parties.parties);
  const noRecord = new Set(parties.noRecord.map(norm));
  const unresolved = new Set<string>();

  const check = (party: string, candidate: string, where: string): void => {
    const key = resolver.resolve({ party, candidate });
    if (key !== null) return;
    // A candidate with no party affiliation whom we cannot match by name is, by definition, an
    // independent with no parliamentary record — legitimately scored -1, not a data error.
    if (party.trim() === "") return;
    // A candidate WITH a party string must either resolve or be acknowledged on the noRecord
    // allowlist; otherwise it is a party we have failed to map, and the build fails.
    if (noRecord.has(norm(party))) return;
    unresolved.add(`${where}: "${candidate}" [${party}]`);
  };

  for (const c of ballots.house) check(c.party, c.candidate, `House/${c.division}`);
  for (const c of ballots.senate) check(c.party, c.candidate, `Senate/${c.state}/${c.group}`);

  if (unresolved.size > 0) {
    errors.push({
      severity: "error",
      code: "unresolved-candidate",
      message:
        "Candidates whose party string neither resolves to a party key nor appears on the noRecord allowlist. " +
        "Add a registry alias, or add the name to noRecord if the party genuinely has no parliamentary record.",
      items: [...unresolved].sort(),
    });
  }

  // — merge direction (a merged-in party must NOT be on the ballot) —
  // applyMerges pools the MERGER accumulator into the MASTER and DELETES the merger, so if the merger
  // key is resolvable from a ballot candidate, that candidate's rows would be scored against a deleted
  // accumulator and blanked. The master is the surviving/ballot entity; the merger is the absorbed
  // predecessor. (This is exactly the 2022 palmer/UAP mis-direction, which was inert only because
  // neither key happened to be on that ballot.)
  const ballotKeys = new Set();
  for (const c of ballots.house) {
    const k = resolver.resolve({ party: c.party, candidate: c.candidate });
    if (k !== null) ballotKeys.add(k);
  }
  for (const c of ballots.senate) {
    const k = resolver.resolve({ party: c.party, candidate: c.candidate });
    if (k !== null) ballotKeys.add(k);
  }
  const mergersOnBallot = parties.merges
    .filter((m) => ballotKeys.has(m.merger))
    .map((m) => `${m.merger} (merges into ${m.master})`);
  if (mergersOnBallot.length > 0) {
    errors.push({
      severity: "error",
      code: "merger-on-ballot",
      message:
        "A merge's MERGER key resolves from a ballot candidate; its accumulator is pooled into the " +
        "master and deleted, so those ballot rows would be blanked. Swap the direction so the ballot " +
        "entity is the master and the absorbed predecessor is the merger.",
      items: mergersOnBallot,
    });
  }

  // — electorate coverage —
  const electorates = new Set(ballots.electorates.map((e) => norm(e.electorate)));
  const missingDivisions = new Set<string>();
  for (const c of ballots.house) {
    if (!electorates.has(norm(c.division))) missingDivisions.add(c.division);
  }
  if (missingDivisions.size > 0) {
    errors.push({
      severity: "error",
      code: "division-without-electorate",
      message: "House divisions with candidates but no entry in the electorate list.",
      items: [...missingDivisions].sort(),
    });
  }

  // — senate state validity (a typo silently hides a candidate for everyone) —
  // Senate candidates are grouped and displayed by state; an out-of-set state code means the group
  // never renders for that state, dropping the candidate silently. House divisions are covered by the
  // electorate check above; the Senate has no equivalent until now.
  const VALID_STATES = new Set(["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"]);
  const badSenateStates = new Set<string>();
  for (const c of ballots.senate) {
    if (!VALID_STATES.has(c.state.trim().toUpperCase())) {
      badSenateStates.add(`${c.state} (${c.candidate})`);
    }
  }
  if (badSenateStates.size > 0) {
    errors.push({
      severity: "error",
      code: "senate-invalid-state",
      message:
        "Senate candidates whose state is not one of the eight AEC state/territory codes " +
        "(NSW, VIC, QLD, SA, WA, TAS, NT, ACT) — a typo silently hides the candidate for everyone.",
      items: [...badSenateStates].sort(),
    });
  }

  // — warnings: entities that can never score (all -1 across every question) —
  const everScored = new Set<string>();
  for (const q of questions.questions) {
    for (const [key, pos] of Object.entries(q.positions)) {
      if (pos !== -1) everScored.add(key);
    }
  }
  const neverScorable = parties.parties
    .filter((p) => p.kind !== "office" && !everScored.has(p.key))
    .map((p) => p.key);
  if (neverScorable.length > 0) {
    warnings.push({
      severity: "warning",
      code: "party-never-scorable",
      message:
        "Parties/independents in the registry with no scorable position on any question (always -1).",
      items: neverScorable,
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Formats a report for a terminal / CI log. */
export function formatReport(report: ValidationReport): string {
  const lines: string[] = [];
  const render = (issue: ValidationIssue): void => {
    const tag = issue.severity === "error" ? "✗" : "!";
    lines.push(`${tag} [${issue.code}] ${issue.message}`);
    for (const item of issue.items ?? []) lines.push(`    - ${item}`);
  };
  report.errors.forEach(render);
  report.warnings.forEach(render);
  lines.push(
    report.ok
      ? `✓ dataset valid (${report.warnings.length} warning(s))`
      : `✗ dataset invalid: ${report.errors.length} error(s), ${report.warnings.length} warning(s)`,
  );
  return lines.join("\n");
}

export type { QuestionSet, PartyRegistry, Ballots };
