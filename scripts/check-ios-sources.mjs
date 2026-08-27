#!/usr/bin/env node
/**
 * Every Swift file in the iOS app target is actually compiled.
 *
 * The Xcode project uses the classic explicit file-reference model: a source file is built only if
 * it appears in `project.pbxproj` four times over — a `PBXFileReference`, a `PBXBuildFile`, a child
 * of the `App` group, and an entry in the target's `PBXSourcesBuildPhase`. Adding a `.swift` file to
 * the folder does nothing on its own.
 *
 * That failure is silent in the worst way. The file is present, readable, and reviewable; every
 * guard that reads it passes; the app builds and runs. It simply does not contain the code. A
 * generated notice file that is never compiled looks exactly like one that is, so the compliance
 * register would report copy as shipped that no binary carries.
 *
 * This guard asserts the registration exists, and `--write` performs it. Identifiers are derived
 * from the file's path (a truncated SHA-1) rather than generated randomly, so re-running is a no-op
 * and two people adding the same file produce the same project file rather than a merge conflict.
 *
 * It also asserts the project's deployment target matches the one ADR 0018 D10 declares. That is
 * the same class of fault seen from the other side: the SwiftUI the native core is written against
 * needs a floor the project did not have, and the only report of the mismatch was an availability
 * error deep in a seven-minute macOS build. Checking the number here turns it into a second on
 * Linux.
 *
 * Usage: `node scripts/check-ios-sources.mjs` to verify, `--write` to register what is missing.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Where the app target's own sources live, relative to the repo root. */
export const APP_SOURCE_DIR = "apps/mobile/ios/App/App";
const PROJECT = "apps/mobile/ios/App/App.xcodeproj/project.pbxproj";
const ADR = "docs/adr/0018-native-ios-core.md";

/**
 * The deployment target the project builds against, and the one the ADR declares.
 *
 * Every build configuration must agree: a target raised in Release and left behind in Debug builds
 * clean locally and fails only where it is expensive to find out.
 *
 * @param {string} project  project.pbxproj
 * @param {string} adr  the ADR that declares the minimum
 * @returns {string[]}
 */
export function deploymentTargetProblems(project, adr) {
  const declared = /Minimum target is \*\*iOS (\d+)\*\*/.exec(adr ?? "")?.[1];
  if (declared === undefined) {
    return ["ADR 0018 D10 no longer declares a minimum iOS version (fail closed)"];
  }

  const found = [...(project ?? "").matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([\d.]+);/g)].map(
    (m) => m[1],
  );
  if (found.length === 0) return ["project.pbxproj sets no IPHONEOS_DEPLOYMENT_TARGET"];

  const wrong = [...new Set(found)].filter((v) => Number.parseFloat(v) !== Number(declared));
  return wrong.map(
    (v) =>
      `project.pbxproj builds against iOS ${v}, but ADR 0018 D10 declares iOS ${declared} — the ` +
      `native core's SwiftUI would fail to compile, or would silently target more devices than ` +
      `the decision covers`,
  );
}

/**
 * A stable 24-hex-character object identifier for a path, in the shape Xcode uses.
 *
 * Deterministic on purpose: a random identifier would make every run produce a different project
 * file, so the guard could never assert "already registered" and two branches adding files would
 * conflict on identifiers that mean the same thing.
 *
 * @param {string} path
 * @param {string} kind  distinguishes the file reference from the build file for the same path
 * @returns {string}
 */
export function objectId(path, kind) {
  return createHash("sha1")
    .update(`how2vote:${kind}:${path}`)
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();
}

/**
 * Swift files under the app target, as paths relative to {@link APP_SOURCE_DIR}.
 *
 * @param {(dir: string) => string[]} listDir  returns entries, directories suffixed with "/"
 * @returns {string[]} sorted, so the project file's ordering is stable
 */
export function swiftSources(listDir) {
  const out = [];
  const walk = (prefix) => {
    for (const entry of listDir(prefix)) {
      if (entry.endsWith("/")) walk(`${prefix}${entry}`);
      else if (entry.endsWith(".swift")) out.push(`${prefix}${entry}`);
    }
  };
  walk("");
  return out.sort();
}

/**
 * Basenames shared between the app sources and the command-line harnesses.
 *
 * `swiftc` distinguishes private declarations by FILENAME, so compiling two files with the same
 * basename in one invocation is a hard error — and every harness compiles the app sources it
 * exercises alongside its own. The collision does not exist in the Xcode build, so it surfaces only
 * on a macOS runner, minutes in.
 *
 * @param {string[]} appSources  paths relative to the app source dir
 * @param {string[]} harnesses   paths relative to the harness dir
 * @returns {string[]} one message per collision
 */
export function harnessNameCollisions(appSources, harnesses) {
  const base = (p) => p.slice(p.lastIndexOf("/") + 1);
  const appByName = new Map(appSources.map((p) => [base(p), p]));
  const problems = [];
  for (const h of harnesses) {
    const clash = appByName.get(base(h));
    if (clash) {
      problems.push(
        `harness ${h} shares a filename with ${clash} — swiftc refuses to compile both ` +
          `("filename used twice"), and the harnesses compile app sources alongside their own`,
      );
    }
  }
  return problems;
}

/**
 * Which of the given sources are not fully registered in the project file.
 *
 * A file counts as registered only when all four entries are present: a partial registration builds
 * inconsistently or not at all, and is exactly what a hand-edit tends to leave behind.
 *
 * @param {string} project  project.pbxproj contents
 * @param {string[]} sources  paths relative to {@link APP_SOURCE_DIR}
 * @returns {{path: string, missing: string[]}[]}
 */
export function unregistered(project, sources) {
  const problems = [];
  for (const path of sources) {
    const fileRef = objectId(path, "fileRef");
    const buildFile = objectId(path, "buildFile");
    const isAppDelegate = path === "AppDelegate.swift";
    // AppDelegate.swift predates this guard and carries Capacitor's own identifiers; recognise it
    // by name rather than by our derived ids, which it will never have.
    const has = (needle) => project.includes(needle);
    const missing = [];
    if (isAppDelegate) {
      if (!has("AppDelegate.swift in Sources */,")) missing.push("sources build phase");
    } else {
      if (!has(`${fileRef} /* ${basename(path)} */ = {isa = PBXFileReference`)) {
        missing.push("file reference");
      }
      if (!has(`${buildFile} /* ${basename(path)} in Sources */ = {isa = PBXBuildFile`)) {
        missing.push("build file");
      }
      if (!has(`\t\t\t\t${fileRef} /* ${basename(path)} */,`)) missing.push("group membership");
      if (!has(`\t\t\t\t${buildFile} /* ${basename(path)} in Sources */,`)) {
        missing.push("sources build phase");
      }
    }
    if (missing.length > 0) problems.push({ path, missing });
  }
  return problems;
}

/**
 * @param {string} p
 * @returns {string}
 */
function basename(p) {
  return p.slice(p.lastIndexOf("/") + 1);
}

/**
 * Register the given sources, returning the updated project file.
 *
 * Files in a subdirectory carry an explicit `name` alongside their `path`, which is how Xcode
 * represents a reference that is not a direct child of its group — without it the project shows the
 * full relative path as the file's name in the navigator.
 *
 * @param {string} project
 * @param {string[]} sources  paths relative to {@link APP_SOURCE_DIR} that need registering
 * @returns {string}
 */
export function register(project, sources) {
  let out = project;
  for (const path of sources) {
    if (path === "AppDelegate.swift") continue;
    const name = basename(path);
    const fileRef = objectId(path, "fileRef");
    const buildFile = objectId(path, "buildFile");
    const nameAttr = path.includes("/") ? `name = ${name}; ` : "";

    out = out.replace(
      "/* End PBXBuildFile section */",
      `\t\t${buildFile} /* ${name} in Sources */ = {isa = PBXBuildFile; fileRef = ${fileRef} /* ${name} */; };\n/* End PBXBuildFile section */`,
    );
    out = out.replace(
      "/* End PBXFileReference section */",
      `\t\t${fileRef} /* ${name} */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; ${nameAttr}path = ${path}; sourceTree = "<group>"; };\n/* End PBXFileReference section */`,
    );
    out = out.replace(
      /(504EC3061FED79650016851F \/\* App \*\/ = \{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = \(\n)/,
      `$1\t\t\t\t${fileRef} /* ${name} */,\n`,
    );
    out = out.replace(
      /(504EC3001FED79650016851F \/\* Sources \*\/ = \{\n\t\t\tisa = PBXSourcesBuildPhase;\n\t\t\tbuildActionMask = \d+;\n\t\t\tfiles = \(\n)/,
      `$1\t\t\t\t${buildFile} /* ${name} in Sources */,\n`,
    );
  }
  return out;
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
const ROOT = new URL("../", import.meta.url);
const rel = (p) => fileURLToPath(new URL(p, ROOT));

const read = (p) => {
  try {
    return readFileSync(rel(p), "utf8");
  } catch {
    return "";
  }
};

/** Command-line harnesses, which compile app sources alongside their own. */
const HARNESS_DIR = "apps/mobile/ios/Parity";

const lister = (root) => (prefix) =>
  readdirSync(rel(`${root}/${prefix}`), { withFileTypes: true })
    .filter((e) => !e.name.startsWith("."))
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));

const listDir = lister(APP_SOURCE_DIR);

function main() {
  const project = readFileSync(rel(PROJECT), "utf8");
  const sources = swiftSources(listDir);
  const problems = unregistered(project, sources);
  const targetProblems = deploymentTargetProblems(project, read(ADR));
  const collisions = harnessNameCollisions(sources, swiftSources(lister(HARNESS_DIR)));

  if (process.argv.includes("--write")) {
    if (problems.length === 0) {
      console.info(`iOS sources: all ${sources.length} Swift file(s) already registered`);
      return;
    }
    writeFileSync(
      rel(PROJECT),
      register(
        project,
        problems.map((p) => p.path),
      ),
      "utf8",
    );
    console.info(`iOS sources: registered ${problems.length} Swift file(s) in the App target`);
    return;
  }

  if (targetProblems.length > 0) {
    for (const problem of targetProblems) console.error(`::error::iOS sources: ${problem}`);
    process.exit(1);
  }

  if (collisions.length > 0) {
    for (const problem of collisions) console.error(`::error::iOS sources: ${problem}`);
    process.exit(1);
  }

  if (problems.length > 0) {
    for (const { path, missing } of problems) {
      console.error(
        `::error::iOS sources: ${APP_SOURCE_DIR}/${path} is not compiled — missing ` +
          `${missing.join(", ")}. Run \`node scripts/check-ios-sources.mjs --write\` and commit.`,
      );
    }
    process.exit(1);
  }
  console.info(`iOS sources OK — all ${sources.length} Swift file(s) built by the App target`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
/* c8 ignore stop */
