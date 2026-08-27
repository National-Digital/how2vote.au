#!/usr/bin/env node
/**
 * The engine bundle the native iOS core evaluates in JavaScriptCore (ADR 0018 D2, D5).
 *
 * Two claims are asserted here, and both are the kind that otherwise fail on a reviewer's device
 * rather than in CI:
 *
 *   1. **It can run there at all.** JavaScriptCore is a bare JS engine: no DOM, no `window`, no
 *      module loader, no `require`, no network. The bundle is evaluated in a context built to have
 *      none of those, so an unguarded browser reference is a build failure and not a blank screen.
 *      Guarded feature detection (`typeof navigator !== "undefined"`) is fine and stays fine — the
 *      point is that nothing *depends* on a browser being there.
 *
 *   2. **It produces the same answers.** The bundle regenerates the committed golden artifacts and
 *      they must match byte for byte. This is the ADR's parity claim made mechanical: two
 *      implementations of the scoring logic would eventually disagree about the same answers, so
 *      there is only one implementation, and this proves the native channel is running it rather
 *      than a drifted copy.
 *
 * A pass here is not a claim that the app works on iOS — only that the engine half is intact and
 * host-independent. The Swift bridge that calls into it is exercised on a macOS runner.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";

/**
 * Host globals a vm context does not have but that leak in anyway, or that would mask a real
 * dependency if left in place. In practice this is `console`: a bare `JSContext` has none unless the
 * host installs one, so a stray debug call throws on device and must throw here too.
 */
const LEAKED_GLOBALS = ["console", "setTimeout", "setInterval", "queueMicrotask"];

/**
 * A context that models what JavaScriptCore actually offers.
 *
 * A bare vm context is already the right shape: it carries the ECMAScript intrinsics and nothing
 * else — no DOM, no `process`, no `require`, no `fetch`. Nothing is copied in from this process, and
 * that matters more than it sounds: handing the sandbox the host's `globalThis` would put `process`
 * and `fetch` back within reach through a property lookup, so a bundle depending on either would
 * pass this check and then fail on the device it was supposed to be cleared for.
 *
 * The missing globals are left genuinely undeclared rather than stubbed with throwing accessors,
 * because that is what JavaScriptCore does and the difference is behavioural, not cosmetic: a
 * getter fires on `typeof x` as readily as on `x.y`, so a stub would break the
 * `typeof navigator !== "undefined"` feature detection that bundled libraries rely on and would
 * fail the bundle for code that is correct. Undeclared, `typeof x` answers `"undefined"` and takes
 * its fallback path, while an unguarded `document.body` throws the same ReferenceError a developer
 * would see on the device.
 *
 * @returns {object} a vm context
 */
export function jscLikeContext() {
  const context = createContext(Object.create(null));
  runInContext(
    `(${function bootstrap(names) {
      for (const name of names) delete globalThis[name];
    }})(${JSON.stringify(LEAKED_GLOBALS)})`,
    context,
    { filename: "jsc-bootstrap.js" },
  );
  return context;
}

/**
 * Structural checks that do not need the bundle to run: it must be self-contained and it must
 * actually expose its global.
 *
 * @param {string} source
 * @param {string} globalName
 * @returns {string[]} problems
 */
export function inspectBundle(source, globalName = "How2VoteEngine") {
  const errors = [];
  if (typeof source !== "string" || source.length === 0) {
    return ["bundle is empty or unreadable (fail closed)"];
  }
  // A module or CommonJS statement means the bundle expects a loader that is not there.
  for (const [label, re] of [
    ["an ES import", /^\s*import\s[\s\S]{0,80}?from\s*["']/m],
    ["a dynamic import", /\bimport\s*\(/],
    ["an ES export", /^\s*export\s+(?:default|const|function|class|\{)/m],
    ["a CommonJS require", /\brequire\s*\(\s*["']/],
  ]) {
    if (re.test(source)) {
      errors.push(`bundle contains ${label} — it must be self-contained, with no module loader`);
    }
  }
  if (!new RegExp(`\\bvar\\s+${globalName}\\s*=`).test(source)) {
    errors.push(`bundle does not assign the \`${globalName}\` global the native bridge looks for`);
  }
  return errors;
}

/**
 * Evaluate the bundle in a JavaScriptCore-like context and hand back its exported API.
 *
 * @param {string} source
 * @param {string} globalName
 * @returns {Record<string, Function>}
 */
export function loadBundle(source, globalName = "How2VoteEngine") {
  const context = jscLikeContext();
  runInContext(source, context, { filename: "how2vote-engine.js" });
  const api = runInContext(globalName, context);
  if (!api || typeof api !== "object") {
    throw new Error(`bundle evaluated but \`${globalName}\` is not an object`);
  }
  return api;
}

/**
 * The golden recipe, restated here rather than imported.
 *
 * `golden-output.test.ts` builds these inputs through the TypeScript engine; restating them means
 * the native path is driven from its own description of the same recipe. If the two ever disagree
 * about what the recipe IS, the artifacts differ and this fails — which is the point. Keep in step
 * with `fixedAnswers` there.
 *
 * @param {{questions: {questions: {id: number}[]}}} dataset
 */
export function fixedAnswers(dataset) {
  return dataset.questions.questions.slice(0, 12).map((q, i) => ({
    id: q.id,
    points: (i % 5) + 1,
    important: i === 0 || i === 5,
  }));
}

/**
 * Regenerate each golden artifact through the bundle and compare bytes.
 *
 * @param {Record<string, Function>} api
 * @param {(p: string) => string} read  repo-relative reader
 * @returns {string[]} problems
 */
export function checkGoldens(api, read) {
  const errors = [];
  const golden = (name) => read(`packages/engine/src/__golden__/${name}`);

  for (const [electionId, file] of [
    ["2025", "card-2025-bean.json"],
    ["2019", "card-2019-bean.json"],
  ]) {
    const datasetJson = read(`data/dist/${electionId}/dataset.json`);
    const dataset = JSON.parse(datasetJson);
    const produced = api.card(
      datasetJson,
      JSON.stringify({ state: "ACT", electorate: "Bean", answers: fixedAnswers(dataset) }),
    );
    if (produced !== golden(file)) {
      errors.push(
        `${file}: the bundle does not reproduce the committed golden card — the native channel ` +
          `would show a different result from the web for the same answers`,
      );
    }
  }

  const dataset2025 = read("data/dist/2025/dataset.json");
  const paper = api.ballotPaper(dataset2025, JSON.stringify({ state: "ACT", electorate: "Bean" }));
  if (paper !== golden("ballot-paper-2025-act.json")) {
    errors.push(
      "ballot-paper-2025-act.json: the bundle does not reproduce the committed ballot order",
    );
  }

  return errors;
}

/**
 * The Swift bridge and the bundle expose the same API.
 *
 * `JSCEngine.swift` reaches into the bundle by string name, so a function renamed or added on the
 * TypeScript side does not break any build — it produces a Swift method that throws at runtime, or
 * an engine capability the native core silently never gains. Neither shows up in a compiler, and
 * both look like working code. Comparing the two surfaces turns that into a build failure.
 *
 * The version constant is checked in the same direction: `NATIVE_API_VERSION` exists so a stale
 * bundle refuses to load rather than quietly producing a wrong card, which only works if the number
 * the Swift expects is the number the bundle ships.
 *
 * @param {Record<string, unknown>} api  the evaluated bundle's exports
 * @param {string} swift  the contents of JSCEngine.swift
 * @returns {string[]} problems
 */
export function checkBridgeParity(api, swift) {
  const errors = [];

  const exported = Object.keys(api)
    .filter((k) => typeof api[k] === "function")
    .sort();
  const called = [...swift.matchAll(/try call\(\s*"([A-Za-z0-9_]+)"/g)].map((m) => m[1]).sort();

  for (const name of exported) {
    if (!called.includes(name)) {
      errors.push(
        `the bundle exports \`${name}\` but JSCEngine.swift never calls it — the native core ` +
          `cannot reach an engine capability that exists`,
      );
    }
  }
  for (const name of called) {
    if (!exported.includes(name)) {
      errors.push(
        `JSCEngine.swift calls \`${name}\`, which the bundle does not export — that call throws ` +
          `at runtime, and nothing before then fails`,
      );
    }
  }

  const expected = /static let expectedAPIVersion\s*=\s*(\d+)/.exec(swift)?.[1];
  if (expected === undefined) {
    errors.push(
      "JSCEngine.swift does not declare expectedAPIVersion — the staleness check is absent",
    );
  } else if (Number(expected) !== api.NATIVE_API_VERSION) {
    errors.push(
      `JSCEngine.swift expects API version ${expected} but the bundle ships ` +
        `${api.NATIVE_API_VERSION} — the app would refuse to start`,
    );
  }

  return errors;
}

/**
 * The two parity harnesses cover the same artifacts.
 *
 * This check runs the bundle on Node; `apps/mobile/ios/Parity/EngineParity.swift` runs it on
 * JavaScriptCore, which is the engine that actually ships. They exist as a pair — Node proves the
 * logic, JavaScriptCore proves it where it executes — and that only holds while both run the same
 * fixtures. A golden added to one alone leaves an artifact whose behaviour on device is unverified,
 * with nothing to say so.
 *
 * @param {string} jsSource  this file's own source
 * @param {string} swiftSource  the Swift harness
 * @returns {string[]} problems
 */
export function checkHarnessCoverage(jsSource, swiftSource) {
  const goldens = (source) =>
    // Bounded by a quote or a path separator on the left, so an interpolated path
    // ("\(goldenDir)/ballot-paper-2025-act.json") counts, while a name opening a message
    // ("card-2025-bean.json: ...") does not.
    [...new Set([...source.matchAll(/["/]([a-z0-9-]+\.json)"/g)].map((m) => m[1]))]
      .filter((name) => name !== "dataset.json" && name !== "elections.json")
      .sort();

  const here = goldens(jsSource);
  const swift = goldens(swiftSource);
  const errors = [];

  for (const name of here) {
    if (!swift.includes(name)) {
      errors.push(
        `${name} is checked on Node but not by the JavaScriptCore harness — its behaviour on the ` +
          `engine that ships is unverified`,
      );
    }
  }
  for (const name of swift) {
    if (!here.includes(name)) {
      errors.push(`${name} is checked by the JavaScriptCore harness but not here`);
    }
  }
  return errors;
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
const ROOT = new URL("../", import.meta.url);
const BUNDLE = "packages/engine/dist-native/how2vote-engine.js";
const SWIFT_BRIDGE = "apps/mobile/ios/App/App/Engine/JSCEngine.swift";
const SWIFT_HARNESS = "apps/mobile/ios/Parity/EngineParity.swift";
const SELF = "scripts/check-engine-bundle.mjs";
const read = (p) => readFileSync(fileURLToPath(new URL(p, ROOT)), "utf8");

function main() {
  let source;
  try {
    source = read(BUNDLE);
  } catch {
    console.error(
      `::error::engine bundle: ${BUNDLE} is missing — run \`pnpm -C packages/engine build:native\``,
    );
    process.exit(1);
  }

  const errors = inspectBundle(source);
  if (errors.length === 0) {
    try {
      const api = loadBundle(source);
      errors.push(...checkGoldens(api, read));
      errors.push(...checkBridgeParity(api, read(SWIFT_BRIDGE)));
      errors.push(...checkHarnessCoverage(read(SELF), read(SWIFT_HARNESS)));
    } catch (err) {
      errors.push(`bundle failed to run in a JavaScriptCore-like context: ${err.message}`);
    }
  }

  if (errors.length > 0) {
    for (const e of errors) console.error(`::error::engine bundle: ${e}`);
    process.exit(1);
  }
  console.info(
    `engine bundle OK — self-contained, host-independent, reproduces 3 golden artifacts, ` +
      `Swift bridge in parity (${Math.round(source.length / 1024)} KB)`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
/* c8 ignore stop */
