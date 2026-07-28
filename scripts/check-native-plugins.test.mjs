import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GRADLE_BUILD_REL,
  GRADLE_SETTINGS_REL,
  gradleName,
  PKG_REL,
  SWIFT_REL,
  swiftName,
  verdict,
} from "./check-native-plugins.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function real() {
  const read = (rel) => readFileSync(resolve(ROOT, rel), "utf8");
  return {
    pkg: read(PKG_REL),
    swift: read(SWIFT_REL),
    gradleSettings: read(GRADLE_SETTINGS_REL),
    gradleBuild: read(GRADLE_BUILD_REL),
  };
}

describe("name mapping", () => {
  it("derives the SPM and gradle names Capacitor generates", () => {
    expect(swiftName("@capacitor/browser")).toBe("Browser");
    expect(swiftName("@capacitor/preferences")).toBe("Preferences");
    // Hyphenated plugin names become PascalCase, which is where a naive replace would break.
    expect(swiftName("@capacitor/push-notifications")).toBe("PushNotifications");
    expect(gradleName("@capacitor/browser")).toBe("capacitor-browser");
    expect(gradleName("@capacitor/push-notifications")).toBe("capacitor-push-notifications");
  });
});

describe("the committed shells", () => {
  it("register every installed plugin on both platforms", () => {
    const { ok, errors, plugins } = verdict(real());
    expect(errors).toEqual([]);
    expect(ok).toBe(true);
    // Guards the guard: an empty list would make the assertion above vacuous.
    expect(plugins.length).toBeGreaterThanOrEqual(4);
    expect(plugins).toContain("@capacitor/browser");
  });

  it("does not count core, cli or the platform packages as plugins", () => {
    const { plugins } = verdict(real());
    expect(plugins).not.toContain("@capacitor/core");
    expect(plugins).not.toContain("@capacitor/ios");
    expect(plugins).not.toContain("@capacitor/android");
  });
});

describe("the failures it exists to catch", () => {
  const base = {
    pkg: JSON.stringify({ dependencies: { "@capacitor/core": "^8", "@capacitor/browser": "^8" } }),
    swift:
      '.package(name: "CapacitorBrowser", path: "x")\n.product(name: "CapacitorBrowser", package: "CapacitorBrowser")',
    gradleSettings: "include ':capacitor-browser'",
    gradleBuild: "implementation project(':capacitor-browser')",
  };

  it("passes when both platforms are synced", () => {
    expect(verdict(base).ok).toBe(true);
  });

  it("catches sync:ios never being run", () => {
    const { ok, errors } = verdict({ ...base, swift: "" });
    expect(ok).toBe(false);
    expect(errors.join()).toMatch(/not declared in .*Package\.swift/);
    expect(errors.join(), "the message must say how to fix it").toMatch(/sync:ios/);
  });

  it("catches sync:android never being run", () => {
    const { ok, errors } = verdict({ ...base, gradleSettings: "", gradleBuild: "" });
    expect(ok).toBe(false);
    expect(errors.join()).toMatch(/sync:android/);
  });

  it("catches a half-written Swift entry (declared, not a target product)", () => {
    const swift = '.package(name: "CapacitorBrowser", path: "x")';
    const { ok, errors } = verdict({ ...base, swift });
    expect(ok).toBe(false);
    expect(errors.join()).toMatch(/not listed as a target product/);
  });

  it("catches a half-written gradle entry (included, not a dependency)", () => {
    const { ok, errors } = verdict({ ...base, gradleBuild: "" });
    expect(ok).toBe(false);
    expect(errors.join()).toMatch(/not a dependency in/);
  });

  it("catches a plugin left wired natively after it was uninstalled", () => {
    const gradleSettings = `${base.gradleSettings}\ninclude ':capacitor-camera'`;
    const { ok, errors } = verdict({ ...base, gradleSettings });
    expect(ok).toBe(false);
    expect(errors.join()).toMatch(/still includes capacitor-camera/);
  });

  it("fails closed when the dependency list comes back empty", () => {
    // A parse that finds nothing must not report success — that is how a broken guard hides.
    const { ok, errors } = verdict({ ...base, pkg: JSON.stringify({ dependencies: {} }) });
    expect(ok).toBe(false);
    expect(errors.join()).toMatch(/vacuously/);
  });

  it("fails closed on unreadable package.json", () => {
    expect(verdict({ ...base, pkg: "not json" }).ok).toBe(false);
  });

  it("ignores capacitor-android, which is the bridge rather than a plugin", () => {
    const gradleSettings = `include ':capacitor-android'\n${base.gradleSettings}`;
    expect(verdict({ ...base, gradleSettings }).ok).toBe(true);
  });
});
