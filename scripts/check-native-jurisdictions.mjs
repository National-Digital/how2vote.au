#!/usr/bin/env node
/**
 * The native ballot picker offers the same states and territories as the web (ADR 0018 D1).
 *
 * The codes are not labels. Each one is matched against the compiled dataset to build that state's
 * electorate list, so a code that differs by a character does not look wrong — it returns an empty
 * list, and the picker appears broken for everyone who lives there. A missing entry is worse still:
 * a whole state with no way to reach the questionnaire, on one channel only.
 *
 * Both sides are plain literals, so agreement is checkable without running either.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * @param {string} source  apps/web/src/lib/data.ts
 * @returns {{code: string, name: string}[]}
 */
export function webJurisdictions(source) {
  const block =
    /export const STATES: \{ code: string; name: string \}\[\] = \[([\s\S]*?)\n\];/.exec(
      source ?? "",
    )?.[1];
  if (block === undefined) return [];
  return [...block.matchAll(/\{ code: "([^"]+)", name: "([^"]+)" \}/g)].map((m) => ({
    code: m[1],
    name: m[2],
  }));
}

/**
 * @param {string} source  Jurisdictions.swift
 * @returns {{code: string, name: string}[]}
 */
export function nativeJurisdictions(source) {
  const block = /static let all: \[Jurisdiction\] = \[([\s\S]*?)\n {4}\]/.exec(source ?? "")?.[1];
  if (block === undefined) return [];
  return [...block.matchAll(/Jurisdiction\(code: "([^"]+)", name: "([^"]+)"\)/g)].map((m) => ({
    code: m[1],
    name: m[2],
  }));
}

/**
 * @param {string} web  apps/web/src/lib/data.ts
 * @param {string} native  Jurisdictions.swift
 * @returns {string[]}
 */
export function verifyJurisdictions(web, native) {
  const errors = [];
  const a = webJurisdictions(web);
  const b = nativeJurisdictions(native);

  if (a.length === 0) errors.push("the web declares no STATES (fail closed)");
  if (b.length === 0) errors.push("Jurisdictions.swift declares none (fail closed)");
  if (a.length === 0 || b.length === 0) return errors;

  if (a.length !== b.length) {
    errors.push(
      `the picker offers ${a.length} states and territories on the web and ${b.length} natively — ` +
        `a missing one is a state with no way to reach the questionnaire`,
    );
  }

  // Order matters as well as membership: this is the list the ballot paper is ordered by, and the
  // two are compared line for line so a reordering is visible rather than silently equivalent.
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i].code !== b[i].code || a[i].name !== b[i].name) {
      errors.push(
        `entry ${i + 1} differs — web ${a[i].code} "${a[i].name}", ` +
          `native ${b[i].code} "${b[i].name}"`,
      );
    }
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
  const errors = verifyJurisdictions(
    read("apps/web/src/lib/data.ts"),
    read("apps/mobile/ios/App/App/Model/Jurisdictions.swift"),
  );

  if (errors.length > 0) {
    for (const e of errors) console.error(`::error::jurisdictions: ${e}`);
    process.exit(1);
  }
  console.info("jurisdictions OK — the native picker offers the web's states and territories");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
/* c8 ignore stop */
