#!/usr/bin/env node
/**
 * The native core and the web agree on which keys the native core owns (ADR 0018 D3).
 *
 * On-device state is shared: the native core writes it through `UserDefaults`, the WebView reads and
 * mirrors it through Capacitor's Preferences plugin, and `clearLocalDeviceData()` wipes it. Three
 * things have to line up for that to hold, and each fails silently on its own:
 *
 *   1. **The ownership marker.** The WebView's backup pass stands down for the native core's keys
 *      only when it finds this exact key. A name that differs by a character means the pass never
 *      stands down, and a voter's in-progress answers are pruned as orphans on the next visibility
 *      change — with nothing anywhere reporting it.
 *   2. **The owned prefixes.** A prefix the native side claims and the web does not is a key with
 *      two writers; a prefix the web cedes and the native side never writes is a key with none, no
 *      longer protected from WebKit eviction.
 *   3. **The Preferences namespace.** The plugin prefixes every key with its configured group
 *      (`CapacitorStorage` by default). A native write without that prefix lands in `UserDefaults`
 *      where the plugin cannot see it — so the WebView cannot read it and, far worse, the data wipe
 *      cannot clear it. That is a store outside the swept namespace, which the product boundary
 *      forbids.
 *
 * All three are plain constants on both sides, so agreement is checkable without running anything.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Capacitor Preferences' default group. Its plugin prefixes every key with `<group>.`. */
const DEFAULT_PREFERENCES_GROUP = "CapacitorStorage";

/**
 * Read the web's declarations out of `privacy/local-data.ts`.
 *
 * Parsed from source rather than imported: the module pulls in SvelteKit's `$app/environment`, which
 * a plain-node guard cannot resolve, and this job needs no evaluation — the values are literals.
 *
 * @param {string} source
 * @returns {{marker: string | null, prefixes: string[]}}
 */
export function webDeclarations(source) {
  const prefix = /export const STORAGE_KEY_PREFIX = "([^"]+)"/.exec(source)?.[1] ?? null;
  const expand = (literal) =>
    prefix === null ? literal : literal.replace("${STORAGE_KEY_PREFIX}", prefix);

  const markerLiteral = /NATIVE_CORE_MARKER_KEY = `([^`]+)`/.exec(source)?.[1] ?? null;
  const block = /NATIVE_OWNED_KEY_PREFIXES: readonly string\[\] = \[([\s\S]*?)\]/.exec(source)?.[1];

  return {
    marker: markerLiteral === null ? null : expand(markerLiteral),
    prefixes: block === undefined ? [] : [...block.matchAll(/`([^`]+)`/g)].map((m) => expand(m[1])),
  };
}

/**
 * Read the native core's declarations out of `NativeState.swift`.
 *
 * @param {string} source
 * @returns {{marker: string | null, prefixes: string[], preferencesPrefix: string | null}}
 */
export function nativeDeclarations(source) {
  const block = /static let ownedPrefixes = \[([\s\S]*?)\]/.exec(source)?.[1];
  return {
    marker: /static let markerKey = "([^"]+)"/.exec(source)?.[1] ?? null,
    prefixes: block === undefined ? [] : [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]),
    preferencesPrefix: /static let preferencesPrefix = "([^"]+)"/.exec(source)?.[1] ?? null,
  };
}

/**
 * @param {object} input
 * @param {string} input.web  privacy/local-data.ts
 * @param {string} input.native  NativeState.swift
 * @param {string} input.capacitorConfig  apps/mobile/capacitor.config.ts
 * @param {string} input.launch  the bridge subclass that runs at launch
 * @returns {{ok: boolean, errors: string[]}}
 */
export function verifyStateKeys(input) {
  const errors = [];
  const web = webDeclarations(input?.web ?? "");
  const native = nativeDeclarations(input?.native ?? "");

  if (web.marker === null) errors.push("the web declares no NATIVE_CORE_MARKER_KEY (fail closed)");
  if (native.marker === null) errors.push("NativeState.swift declares no markerKey (fail closed)");
  if (web.marker !== null && native.marker !== null && web.marker !== native.marker) {
    errors.push(
      `ownership marker differs — web "${web.marker}", native "${native.marker}". The WebView's ` +
        `backup pass would never stand down, and native state would be pruned as orphans`,
    );
  }

  if (web.prefixes.length === 0) errors.push("the web declares no owned prefixes (fail closed)");
  for (const p of web.prefixes) {
    if (!native.prefixes.includes(p)) {
      errors.push(
        `the web cedes "${p}" to the native core, which does not claim it — that key now has no writer and no eviction protection`,
      );
    }
  }
  for (const p of native.prefixes) {
    if (!web.prefixes.includes(p)) {
      errors.push(
        `the native core claims "${p}", which the web still mirrors — two writers on one key`,
      );
    }
  }

  // The plugin's group, and so the prefix a native write must carry to be visible to it and to the
  // data wipe. A configured group overrides the default, and the Swift constant must follow.
  const configured = /Preferences\s*:\s*\{[\s\S]*?group\s*:\s*["']([^"']+)["']/.exec(
    input?.capacitorConfig ?? "",
  )?.[1];
  const expected = `${configured ?? DEFAULT_PREFERENCES_GROUP}.`;
  if (native.preferencesPrefix !== expected) {
    errors.push(
      `NativeState.preferencesPrefix is ${JSON.stringify(native.preferencesPrefix)} but Capacitor ` +
        `Preferences uses ${JSON.stringify(expected)} — native writes would be invisible to the ` +
        `WebView and, worse, to clearLocalDeviceData()`,
    );
  }

  // A claim that is declared and never made is the worst of both worlds: `NativeState.set` refuses
  // every write, so a voter's native answers live in memory and vanish when the screen closes, and
  // nothing reports it — the screen works perfectly until it is left.
  if (!/NativeState\.claimOwnership\(\)/.test(input?.launch ?? "")) {
    errors.push(
      "nothing calls NativeState.claimOwnership() at launch — the mirror would never stand down, " +
        "and every native write would be refused with the voter's answers held in memory only",
    );
  }

  return { ok: errors.length === 0, errors };
}

/**
 * The native core reads the theme preference the WebView writes.
 *
 * A key that differed by a character would read nothing and fall back to the system appearance —
 * indistinguishable from a preference that simply did not stick, and visible only as one native
 * screen rendering light between two dark ones. The values must line up too: an unrecognised value
 * takes the same silent fallback.
 *
 * The native side must NOT write it. The preference sits outside the owned prefixes (ADR 0018 D3),
 * so two writers on one key is exactly the failure the ownership split exists to prevent.
 *
 * @param {string} web  apps/web/src/lib/theme.svelte.ts
 * @param {string} native  NativeTheme.swift
 * @returns {string[]}
 */
export function verifyThemeContract(web, native) {
  const errors = [];

  const webKey = /const KEY = "([^"]+)"/.exec(web ?? "")?.[1] ?? null;
  const nativeKey = /static let preferenceKey = "([^"]+)"/.exec(native ?? "")?.[1] ?? null;
  if (webKey === null) errors.push("the web declares no theme KEY (fail closed)");
  if (nativeKey === null) errors.push("NativeTheme.swift declares no preferenceKey (fail closed)");
  if (webKey !== null && nativeKey !== null && webKey !== nativeKey) {
    errors.push(
      `theme key differs — web "${webKey}", native "${nativeKey}". The native screens would read ` +
        `nothing and fall back to the system appearance, which looks like a preference that did ` +
        `not stick`,
    );
  }

  const webValues = (/export type ThemePref = ([^;]+);/.exec(web ?? "")?.[1] ?? "")
    .split("|")
    .map((v) => v.trim().replace(/"/g, ""))
    .filter(Boolean)
    .sort();
  const nativeBlock = /enum Preference: String \{([\s\S]*?)\n {4}\}/.exec(native ?? "")?.[1] ?? "";
  const nativeValues = [...nativeBlock.matchAll(/case (\w+)/g)].map((m) => m[1]).sort();

  if (webValues.length === 0) errors.push("the web declares no ThemePref values (fail closed)");
  if (nativeValues.length === 0) errors.push("NativeTheme.swift declares no cases (fail closed)");
  if (webValues.join(",") !== nativeValues.join(",")) {
    errors.push(
      `theme values differ — web [${webValues}], native [${nativeValues}]. An unrecognised value ` +
        `falls back to the system appearance without reporting anything`,
    );
  }

  // The native side must never record the preference: it asks the web, which owns the key.
  if (/NativeState\.set\([^)]*preferenceKey/.test(native ?? "")) {
    errors.push(
      "NativeTheme writes the theme preference — that key is the WebView's, and two writers on " +
        "one key is what the ownership split exists to prevent",
    );
  }

  return errors;
}

/**
 * The native core writes the in-progress quiz in exactly the shape the web reads.
 *
 * The format is shared, not merely similar: the WebView reads the same record for the document
 * routes, the D8 islands and the D4 fallback. A renamed field or a different key is not a type
 * error on either side — it is a voter's progress silently invisible to half their own app.
 *
 * Three things are asserted, each of which fails quietly on its own:
 *   - the per-election key prefix, or the two sides read different keys;
 *   - the resume window, or one side offers to resume progress the other has already discarded;
 *   - the record's field names, since JSON has no schema and a rename is undetectable at runtime.
 *
 * The age-first gate (ADR 0011) is checked as WIRING rather than by name-matching: the web refuses
 * to persist quiz state without the 18+ declaration, and a native path that skipped that check would
 * be a bypass of the gate, not a second implementation of it.
 *
 * @param {string} web  quiz.svelte.ts
 * @param {string} native  QuizState.swift
 * @returns {string[]} problems
 */
export function verifyQuizContract(web, native) {
  const errors = [];

  const webKey = /KEY_PREFIX = "([^"]+)"/.exec(web)?.[1] ?? null;
  const nativeKey = /static let keyPrefix = "([^"]+)"/.exec(native)?.[1] ?? null;
  if (webKey === null || nativeKey === null) {
    errors.push("quiz key prefix missing on one side (fail closed)");
  } else if (webKey !== nativeKey) {
    errors.push(`quiz key prefix differs — web "${webKey}", native "${nativeKey}"`);
  }

  // A product of integer literals on both sides; multiplied out rather than evaluated.
  const product = (expr) =>
    expr === undefined ? null : expr.split("*").reduce((a, n) => a * Number(n.trim()), 1);
  const webAge = product(/MAX_AGE_MS = ([\d\s*]+);/.exec(web)?.[1]);
  const nativeAge = product(/maxAgeMilliseconds: Int64 = ([\d\s*]+)$/m.exec(native)?.[1]);
  if (webAge === null || nativeAge === null || Number.isNaN(webAge) || Number.isNaN(nativeAge)) {
    errors.push("resume window missing or unparseable on one side (fail closed)");
  } else if (webAge !== nativeAge) {
    errors.push(
      `resume window differs — web ${webAge}ms, native ${nativeAge}ms: one side would offer to ` +
        `resume progress the other has discarded`,
    );
  }

  const webFields = (/type Persisted = \{([\s\S]*?)\};/.exec(web)?.[1] ?? "")
    .split("\n")
    .map((line) => /^\s*(\w+)\??:/.exec(line)?.[1])
    .filter(Boolean)
    .sort();
  const nativeFields = (
    /struct Persisted: Codable[^{]*\{([\s\S]*?)\n {4}\}/.exec(native)?.[1] ?? ""
  )
    .split("\n")
    .map((line) => /^\s*var (\w+)\s*:/.exec(line)?.[1])
    .filter(Boolean)
    .sort();

  if (webFields.length === 0 || nativeFields.length === 0) {
    errors.push("persisted record fields unreadable on one side (fail closed)");
  } else {
    for (const f of webFields) {
      if (!nativeFields.includes(f)) {
        errors.push(
          `the web persists "${f}", which the native record omits — the field is lost on a native save`,
        );
      }
    }
    for (const f of nativeFields) {
      if (!webFields.includes(f)) {
        errors.push(`the native record persists "${f}", which the web does not read`);
      }
    }
  }

  if (!/eligibleThisSession/.test(native) || !/QuizError\.notEligible/.test(native)) {
    errors.push(
      "QuizState does not fail closed on the 18+ eligibility declaration (docs/adr/0011) — a " +
        "native save would bypass the age-first gate the web enforces before any quiz state",
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
  const { errors } = verifyStateKeys({
    web: read("apps/web/src/lib/privacy/local-data.ts"),
    native: read("apps/mobile/ios/App/App/State/NativeState.swift"),
    capacitorConfig: read("apps/mobile/capacitor.config.ts"),
    launch: read("apps/mobile/ios/App/App/Shell/MainViewController.swift"),
  });

  errors.push(
    ...verifyThemeContract(
      read("apps/web/src/lib/theme.svelte.ts"),
      read("apps/mobile/ios/App/App/State/NativeTheme.swift"),
    ),
  );

  errors.push(
    ...verifyQuizContract(
      read("apps/web/src/lib/quiz.svelte.ts"),
      read("apps/mobile/ios/App/App/State/QuizState.swift"),
    ),
  );

  if (errors.length > 0) {
    for (const e of errors) console.error(`::error::native state: ${e}`);
    process.exit(1);
  }
  console.info(
    "native state OK — ownership marker, owned prefixes, Preferences namespace and the quiz " +
      "record agree across native and web",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
/* c8 ignore stop */
