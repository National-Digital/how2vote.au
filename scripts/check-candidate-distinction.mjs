#!/usr/bin/env node
/**
 * @fileoverview CI guard: the candidate/party alignment distinction is wired from ONE source, the
 * alignment figure lives ONLY in the party-level panel (never on an individual candidate row), and no
 * surface can fabricate a figure for an independent (control-register test
 * `candidate-party-distinction`).
 *
 * An alignment figure describes a candidate's PARTY's recorded parliamentary voting, never the
 * individual candidate's personal views or future votes (defamation / political-misattribution
 * risk) — and a figure printed beside a candidate's name reads as a score OF that candidate. The
 * product therefore shows alignment ONLY in a separate, party-keyed panel. This guard proves the
 * WIRING can't be bypassed and the copy can't drift:
 *   - candidate-alignment.ts is the single source: it exports the presentation fn + the qualifier +
 *     the independent/suspended treatment strings, and its qualifier states the party-not-candidate
 *     limitation;
 *   - PlanRow (the per-candidate row — the blank build-stage ballot line the voter numbers
 *     themselves) renders NO numeric alignment figure and never consumes the presentation function;
 *     scores are party-panel-only, fail-closed. The results screen lists no candidates: alignment is
 *     shown solely in the party panel.
 *   - PartyAlignmentPanel (the alignment surface) imports alignmentPresentation from the shared
 *     module, shows a figure ONLY behind its showScore gate, references partyKey + suspended so the
 *     independent + suspension treatments reach it, and renders the shared qualifier constant (not a
 *     hard-copied paragraph);
 *   - there IS at least one PartyAlignmentPanel surface, and every surface passes partyKey +
 *     suspended (refuse to pass vacuously).
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/git plumbing runs only when
 * executed directly.
 *
 * Usage:
 *   node scripts/check-candidate-distinction.mjs
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ALIGN_MODULE = "apps/web/src/lib/candidate-alignment.ts";
const ALIGN_SPECIFIER = "$lib/candidate-alignment";
const QUALIFIER_EXPORT = "PARTY_ALIGNMENT_QUALIFIER";
const PRESENTATION_EXPORT = "alignmentPresentation";
const PLAN_ROW = "apps/web/src/lib/components/PlanRow.svelte";
const PANEL = "apps/web/src/lib/components/PartyAlignmentPanel.svelte";
/** A verbatim slice of the qualifier — a page that contains this hard-copied it instead of importing. */
const QUALIFIER_SLICE = "not evidence of an individual candidate's personal views";
/** A component "shows alignment" if it renders the party-level alignment panel. */
export const ALIGNMENT_MARKER = /<PartyAlignmentPanel\b/;
/** A numeric alignment figure: a template expression immediately followed by a percent sign. */
const NUMERIC_FIGURE = /\}\s*%/;

/** The modules a surface may take its panel rows from, by the specifier it imports them with. */
export const ROW_SOURCES = [
  { path: "apps/web/src/lib/card-flow.svelte.ts", specifier: "$lib/card-flow.svelte" },
];

/**
 * Source with its JS and HTML comments removed. Strings and template literals are stepped over, so a
 * `//` inside one (a URL, a path) is kept, as the code it is part of.
 */
export function withoutComments(text) {
  const html = text.replace(/<!--[\s\S]*?-->/g, "");
  let out = "";
  let quote = null;
  for (let i = 0; i < html.length; i += 1) {
    const c = html[i];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += html[i + 1] ?? "";
        i += 1;
      } else if (c === quote) {
        quote = null;
      }
    } else if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
    } else if (c === "/" && html[i + 1] === "/") {
      while (i < html.length && html[i] !== "\n") i += 1;
      out += "\n";
    } else if (c === "/" && html[i + 1] === "*") {
      const end = html.indexOf("*/", i + 2);
      i = end < 0 ? html.length : end + 1;
    } else {
      out += c;
    }
  }
  return out;
}

/**
 * The row set a panel's `parties` expression names in a registered row source — `flow.houseParties`
 * where `flow` is imported from it — or null for any other expression.
 */
function rowSetOf(expr, code, rowSources) {
  const m = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(expr);
  if (!m) return null;
  const [, local, name] = m;
  for (const source of rowSources) {
    const escaped = source.specifier.replace(/[$.]/g, "\\$&");
    const imported = new RegExp(
      `import\\s*\\{[^}]*\\b\\w+\\s+as\\s+${local}\\b[^}]*\\}\\s*from\\s*"${escaped}"`,
    );
    const direct = new RegExp(`import\\s*\\{[^}]*\\b${local}\\b[^}]*\\}\\s*from\\s*"${escaped}"`);
    if (imported.test(code) || direct.test(code)) return { source, name };
  }
  return null;
}

/** Whether rows are given a property: `name: …`, or `name` in an object's shorthand. */
function carries(rows, name) {
  return new RegExp(`(?:^|[{,\\s])${name}\\s*:|[{,]\\s*${name}\\s*[,}]`).test(rows);
}

/** Each `<PartyAlignmentPanel>`'s `parties={…}` expression, braces counted. */
function panelRows(code) {
  const found = [];
  for (const m of code.matchAll(/<PartyAlignmentPanel\b/g)) {
    const at = code.indexOf("parties={", m.index);
    const close = code.indexOf("/>", m.index);
    if (at < 0 || (close >= 0 && at > close)) continue;
    let depth = 1;
    let i = at + "parties={".length;
    const start = i;
    while (i < code.length && depth > 0) {
      if (code[i] === "{") depth += 1;
      else if (code[i] === "}") depth -= 1;
      i += 1;
    }
    found.push(code.slice(start, i - 1).trim());
  }
  return found;
}

/** The body of a `name = $derived(…)` or `$derived.by(…)` field, brackets counted, or null. */
function derivedBody(code, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*\\$derived(?:\\.by)?\\(`).exec(code);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  while (i < code.length && depth > 0) {
    if (code[i] === "(") depth += 1;
    else if (code[i] === ")") depth -= 1;
    i += 1;
  }
  return code.slice(start, i - 1);
}

/** @param {string} text */
export const showsAlignment = (text) => typeof text === "string" && ALIGNMENT_MARKER.test(text);

/**
 * @param {object} input
 * @param {string} input.alignModule   source of candidate-alignment.ts
 * @param {string} input.planRow       source of PlanRow.svelte
 * @param {string} input.panel         source of PartyAlignmentPanel.svelte
 * @param {{ path: string, text: string }[]} input.alignmentSurfaces  components rendering <PartyAlignmentPanel>
 * @param {{ path: string, specifier: string, text: string }[]} [input.rowSources]  modules a surface may take its panel rows from
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict({ alignModule, planRow, panel, alignmentSurfaces, rowSources = [] }) {
  const errors = [];
  const push = (m) => errors.push(m);

  // 1 — the single-source module.
  if (typeof alignModule !== "string" || alignModule.trim() === "") {
    push(`${ALIGN_MODULE}: shared alignment module is missing or empty`);
  } else {
    for (const sym of [QUALIFIER_EXPORT, PRESENTATION_EXPORT]) {
      if (!new RegExp(`export\\s+(?:const|function)\\s+${sym}\\b`).test(alignModule)) {
        push(`${ALIGN_MODULE}: must export ${sym}`);
      }
    }
    if (!alignModule.includes(QUALIFIER_SLICE)) {
      push(`${ALIGN_MODULE}: the qualifier must state the party-not-candidate limitation`);
    }
    // The independent treatment must exist and must not invent a number.
    if (!alignModule.includes("No party-position alignment available")) {
      push(
        `${ALIGN_MODULE}: missing the independent "no party-position alignment available" wording`,
      );
    }
  }

  // 2 — the per-candidate build row renders NO alignment figure (scores are party-panel-only, fail-closed).
  if (typeof planRow !== "string" || planRow.trim() === "") {
    push(`${PLAN_ROW}: PlanRow component is missing or empty`);
  } else {
    if (/\.showScore\b/.test(planRow)) {
      push(`${PLAN_ROW}: must NOT use the showScore gate — alignment figures are party-panel-only`);
    }
    if (NUMERIC_FIGURE.test(planRow)) {
      push(`${PLAN_ROW}: must NOT render a numeric alignment figure (e.g. \`{…}%\`)`);
    }
    if (planRow.includes(PRESENTATION_EXPORT)) {
      push(
        `${PLAN_ROW}: must not consume ${PRESENTATION_EXPORT} — the panel is the alignment surface`,
      );
    }
  }

  // 3 — the party-level panel single-sources the decision and renders a figure only behind showScore.
  if (typeof panel !== "string" || panel.trim() === "") {
    push(`${PANEL}: PartyAlignmentPanel component is missing or empty`);
  } else {
    if (!panel.includes(ALIGN_SPECIFIER)) {
      push(
        `${PANEL}: must import from "${ALIGN_SPECIFIER}" (single-source the alignment decision)`,
      );
    }
    if (!panel.includes(PRESENTATION_EXPORT)) {
      push(`${PANEL}: must use ${PRESENTATION_EXPORT} to decide each party's treatment`);
    }
    if (!/\.showScore\b/.test(panel)) {
      push(`${PANEL}: a figure must render only behind the presentation showScore gate`);
    }
    if (!panel.includes("partyKey")) {
      push(`${PANEL}: must reference partyKey (independent = null → no figure)`);
    }
    if (!panel.includes("suspended")) {
      push(`${PANEL}: must reference suspended (correction suspension → no figure)`);
    }
    if (!panel.includes(QUALIFIER_EXPORT)) {
      push(`${PANEL}: must render the shared ${QUALIFIER_EXPORT}`);
    }
    if (panel.includes(QUALIFIER_SLICE)) {
      push(
        `${PANEL}: hard-copies the alignment qualifier — render ${QUALIFIER_EXPORT} instead so it cannot drift`,
      );
    }
  }

  // 4 — every alignment surface wires the distinction props; there must be at least one. Read as
  // code: a prop named only in a comment wires nothing. A surface may instead take a panel's rows
  // from a registered row source (the card's flow, which the iOS app draws from too), whose rows
  // must then carry both, row set by row set.
  if (!Array.isArray(alignmentSurfaces) || alignmentSurfaces.length === 0) {
    push(
      "no component renders <PartyAlignmentPanel> — refusing to pass the distinction guard vacuously",
    );
  } else {
    for (const { path, text } of alignmentSurfaces) {
      const code = withoutComments(text);
      const panels = panelRows(code);
      if (panels.length === 0) {
        push(`${path}: renders <PartyAlignmentPanel> without a parties prop it can check`);
        continue;
      }
      for (const expr of panels) {
        // The rows a panel is given: a registered row source's row set, a row set derived on the
        // surface itself, or the expression written in the prop.
        const sourced = rowSetOf(expr, code, rowSources);
        const local = /^[A-Za-z_$][\w$]*$/.test(expr) ? derivedBody(code, expr) : null;
        const rows = sourced
          ? derivedBody(withoutComments(sourced.source.text), sourced.name)
          : (local ?? expr);
        const where = sourced ? `${sourced.source.path}: ${sourced.name}` : `${path}: ${expr}`;
        if (rows === null) {
          push(
            `${path}: takes its panel rows from ${sourced.source.path}, which has no ${sourced.name}`,
          );
          continue;
        }
        // As a property each row is given, not merely a name the rows' code mentions.
        if (!carries(rows, "partyKey")) {
          push(`${where} never passes partyKey (independent treatment lost)`);
        }
        if (!carries(rows, "suspended")) {
          push(`${where} never passes suspended (correction suspension lost)`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/git/fs plumbing, exercised via CI not unit tests */
function main() {
  const root = new URL("../", import.meta.url);
  const rootPath = fileURLToPath(root);

  const safeRead = (rel) => {
    try {
      return readFileSync(new URL(rel, root), "utf8");
    } catch {
      return "";
    }
  };

  const alignModule = safeRead(ALIGN_MODULE);
  const planRow = safeRead(PLAN_ROW);
  const panel = safeRead(PANEL);

  const svelte = execFileSync("git", ["ls-files", "apps/web/src/**/*.svelte"], {
    cwd: rootPath,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);
  const alignmentSurfaces = [];
  for (const rel of svelte) {
    if (rel.endsWith("components/PartyAlignmentPanel.svelte")) continue; // the panel itself, not a surface
    const text = safeRead(rel);
    if (showsAlignment(text)) alignmentSurfaces.push({ path: rel, text });
  }

  const rowSources = ROW_SOURCES.map((source) => ({ ...source, text: safeRead(source.path) }));
  const result = verdict({ alignModule, planRow, panel, alignmentSurfaces, rowSources });
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::candidate-distinction: ${e}`);
    console.error(`candidate/party distinction: ${result.errors.length} problem(s)`);
    process.exit(1);
    return;
  }
  console.info(
    `candidate/party distinction OK — single-sourced from ${ALIGN_MODULE}; PlanRow carries no figure; ${alignmentSurfaces.length} PartyAlignmentPanel surface(s) wire partyKey + suspended`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
