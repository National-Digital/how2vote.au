#!/usr/bin/env node
/**
 * The native quiz and the web quiz offer the same answer scale (ADR 0018 D2).
 *
 * The scale is not decoration. Each option carries a `points` value that goes straight into the
 * scoring engine, so the label-to-points binding IS the meaning of a tap. A native restatement that
 * drifts does not crash and does not look wrong — the screen still reads correctly, the engine still
 * scores, and a voter who taps "Strongly agree" is recorded as strongly disagreeing. Nothing
 * downstream can detect that, because by the time the answer reaches the engine the label is gone.
 *
 * Three things therefore have to agree, and this checks all three:
 *
 *   1. **The options, in order.** Same kinds, same points, same labels, same secondary text. Order
 *      matters because the scale is presented as a ranked column and read top-to-bottom.
 *   2. **The short labels.** `answerLabel` supplies the review screen and the VoiceOver
 *      announcements. A label that disagrees with the option it names misreports the answer back to
 *      the voter, which on a screen reader is the only reading they get.
 *   3. **The star.** `important` prefixes the same mark on both sides, so the review screen and its
 *      announcement mean the same thing.
 *
 * Both sides are plain literals, so agreement is checkable without running either.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Read the scale out of the web's `answers.ts`.
 *
 * Parsed from source rather than imported: a plain-node guard cannot resolve the workspace's
 * TypeScript, and the values are literals so nothing needs evaluating.
 *
 * @param {string} source
 * @returns {{options: {kind: string, points: number, label: string, sub: string | null}[], labels: Record<string, string>, star: string | null}}
 */
export function webScale(source) {
  const block = /export const OPTIONS: OptionSpec\[\] = \[([\s\S]*?)\n\];/.exec(source)?.[1] ?? "";
  const options = [...block.matchAll(/\{([^}]*)\}/g)].map((m) => {
    const row = m[1];
    const sub = /sub:\s*"((?:[^"\\]|\\.)*)"/.exec(row)?.[1];
    return {
      kind: /kind:\s*"([^"]+)"/.exec(row)?.[1] ?? "",
      // A skip row carries no `points` and is scored as No Answer.
      points: Number(/points:\s*(\d+)/.exec(row)?.[1] ?? 0),
      label: /label:\s*"((?:[^"\\]|\\.)*)"/.exec(row)?.[1] ?? "",
      sub: sub === undefined ? null : sub,
    };
  });

  const map = /const base: Record<AnswerPoints, string> = \{([\s\S]*?)\};/.exec(source)?.[1] ?? "";
  const labels = Object.fromEntries(
    [...map.matchAll(/(\d+):\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => [m[1], m[2]]),
  );

  return {
    options,
    labels,
    star: /return important \? `([^\s`$]+) \$\{base\[points\]\}`/.exec(source)?.[1] ?? null,
  };
}

/**
 * Read the scale out of `AnswerScale.swift`.
 *
 * @param {string} source
 * @returns {{options: {kind: string, points: number, label: string, sub: string | null}[], labels: Record<string, string>, star: string | null}}
 */
export function nativeScale(source) {
  const block =
    /static let options: \[AnswerOption\] = \[([\s\S]*?)\n {4}\]/.exec(source)?.[1] ?? "";
  const options = [...block.matchAll(/AnswerOption\(([^)]*)\)/g)].map((m) => {
    const row = m[1];
    const sub = /sub:\s*"((?:[^"\\]|\\.)*)"/.exec(row)?.[1];
    return {
      kind: /kind:\s*\.(\w+)/.exec(row)?.[1] ?? "",
      points: Number(/points:\s*(\d+)/.exec(row)?.[1] ?? -1),
      label: /label:\s*"((?:[^"\\]|\\.)*)"/.exec(row)?.[1] ?? "",
      sub: sub === undefined ? null : sub,
    };
  });

  const map = /let base: \[Int: String\] = \[([\s\S]*?)\n {8}\]/.exec(source)?.[1] ?? "";
  const labels = Object.fromEntries(
    [...map.matchAll(/(\d+):\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => [m[1], m[2]]),
  );

  return {
    options,
    labels,
    star: /return important \? "([^\s"\\]+) \\\(text\)"/.exec(source)?.[1] ?? null,
  };
}

const describe = (o) => `${o.kind}/${o.points} "${o.label}"${o.sub === null ? "" : ` (${o.sub})`}`;

/**
 * The answers the ×10 importance lever may attach to.
 *
 * Read from the web's backstop in `record` rather than from the review screen's markup: the markup
 * is where the star is DRAWN, the backstop is where the rule is enforced, and it is the rule the
 * native side has to match.
 *
 * @param {string} source
 * @returns {number[]}
 */
export function webImportancePoints(source) {
  const rule = /const imp = important && \(([^)]*)\)/.exec(source)?.[1] ?? "";
  return [...rule.matchAll(/points === (\d+)/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
}

/**
 * @param {string} source
 * @returns {number[]}
 */
export function nativeImportancePoints(source) {
  const block = /static let importanceApplies: Set<Int> = \[([^\]]*)\]/.exec(source)?.[1] ?? "";
  return [...block.matchAll(/(\d+)/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
}

/**
 * @param {string} web  apps/web/src/lib/answers.ts
 * @param {string} native  AnswerScale.swift
 * @param {string} webQuiz  apps/web/src/lib/quiz.svelte.ts
 * @returns {string[]}
 */
export function verifyAnswerScale(web, native, webQuiz = "") {
  const errors = [];
  const a = webScale(web ?? "");
  const b = nativeScale(native ?? "");

  // Fail closed: an unreadable side would otherwise agree with anything.
  if (a.options.length === 0) errors.push("the web declares no OPTIONS (fail closed)");
  if (b.options.length === 0) errors.push("AnswerScale.swift declares no options (fail closed)");

  if (a.options.length !== b.options.length && a.options.length > 0 && b.options.length > 0) {
    errors.push(
      `the scale has ${a.options.length} options on the web and ${b.options.length} natively`,
    );
  }

  for (let i = 0; i < Math.min(a.options.length, b.options.length); i += 1) {
    const [x, y] = [a.options[i], b.options[i]];
    if (x.kind !== y.kind || x.points !== y.points || x.label !== y.label || x.sub !== y.sub) {
      errors.push(
        `option ${i + 1} differs — web ${describe(x)}, native ${describe(y)}. A tap would be ` +
          `scored as something other than what it reads as`,
      );
    }
  }

  if (Object.keys(a.labels).length === 0) errors.push("the web declares no answerLabel map");
  if (Object.keys(b.labels).length === 0) errors.push("AnswerScale.swift declares no label map");
  for (const points of new Set([...Object.keys(a.labels), ...Object.keys(b.labels)])) {
    if (a.labels[points] !== b.labels[points]) {
      errors.push(
        `the short label for ${points} differs — web ${JSON.stringify(a.labels[points])}, ` +
          `native ${JSON.stringify(b.labels[points])}. The review screen and VoiceOver would ` +
          `report an answer the voter did not give`,
      );
    }
  }

  // Each option must be named the same way where it is read back, or the quiz and the review screen
  // describe the same tap differently.
  for (const o of a.options) {
    if (o.kind === "answer" && a.labels[String(o.points)] === undefined) {
      errors.push(`the web scores ${o.points} but answerLabel has no name for it`);
    }
  }

  if (a.star === null || b.star === null || a.star !== b.star) {
    errors.push(
      `the "extremely important" mark differs — web ${JSON.stringify(a.star)}, ` +
        `native ${JSON.stringify(b.star)}`,
    );
  }

  // The ×10 lever weights only the two ends of the scale. A star allowed onto a middling answer
  // multiplies a weight the engine never intended to, and the result is wrong without looking wrong.
  const webPoints = webImportancePoints(webQuiz ?? "");
  const nativePoints = nativeImportancePoints(native ?? "");
  if (webPoints.length === 0) {
    errors.push("the web declares no importance rule in record() (fail closed)");
  }
  if (nativePoints.length === 0) {
    errors.push("AnswerScale.swift declares no importanceApplies (fail closed)");
  }
  if (webPoints.join(",") !== nativePoints.join(",")) {
    errors.push(
      `the \u00d710 importance lever applies to [${webPoints}] on the web and [${nativePoints}] ` +
        `natively — a star on any other answer multiplies a weight the scoring model does not`,
    );
  }

  return errors;
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
const ROOT = new URL("../", import.meta.url);
const read = (p) => {
  try {
    return readFileSync(fileURLToPath(new URL(p, ROOT)), "utf8");
  } catch {
    return "";
  }
};

function main() {
  const errors = verifyAnswerScale(
    read("apps/web/src/lib/answers.ts"),
    read("apps/mobile/ios/App/App/Model/AnswerScale.swift"),
    read("apps/web/src/lib/quiz.svelte.ts"),
  );

  if (errors.length > 0) {
    for (const e of errors) console.error(`::error::answer scale: ${e}`);
    process.exit(1);
  }
  console.info("answer scale OK — the native quiz offers the web's options, points and labels");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
/* c8 ignore stop */
