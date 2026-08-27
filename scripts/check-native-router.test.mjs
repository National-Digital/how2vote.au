import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { verifyRouterWiring } from "./check-native-router.mjs";

const url = (p) => new URL(p, import.meta.url);
const read = (p) => readFileSync(url(p), "utf8");
const COMMITTED = {
  storyboard: read("../apps/mobile/ios/App/App/Base.lproj/Main.storyboard"),
  controller: read("../apps/mobile/ios/App/App/Shell/MainViewController.swift"),
  plugin: read("../apps/mobile/ios/App/App/Shell/NativeRouterPlugin.swift"),
  web: read("../apps/web/src/lib/channel.ts"),
  caller: read("../apps/web/src/lib/native-router.svelte.ts"),
};

const mutate = (over) => verifyRouterWiring({ ...COMMITTED, ...over }).join(" ");

describe("verifyRouterWiring", () => {
  it("passes on the committed sources", () => {
    expect(verifyRouterWiring(COMMITTED)).toEqual([]);
  });

  it("catches a storyboard still naming Capacitor's own controller", () => {
    expect(
      mutate({
        storyboard: COMMITTED.storyboard.replace("MainViewController", "CAPBridgeViewController"),
      }),
    ).toContain("capacitorDidLoad would never run");
  });

  it("catches a plugin that is never handed to the bridge", () => {
    expect(
      mutate({
        controller: COMMITTED.controller.replace(
          "bridge?.registerPluginInstance(NativeRouterPlugin())",
          "",
        ),
      }),
    ).toContain("is never handed to the bridge");
  });

  it("catches a method Capacitor cannot dispatch to", () => {
    expect(
      mutate({
        plugin: COMMITTED.plugin.replace(
          'CAPPluginMethod(name: "present", returnType: CAPPluginReturnPromise)',
          "",
        ),
      }),
    ).toContain("absent from pluginMethods");
  });

  it("catches a declared method with no implementation", () => {
    expect(
      mutate({
        plugin: COMMITTED.plugin.replace(
          "@objc func present(_ call: CAPPluginCall)",
          "@objc func show(_ call: CAPPluginCall)",
        ),
      }),
    ).toContain("which the plugin does not implement");
  });

  it("catches a published name the web does not look up", () => {
    expect(
      mutate({
        plugin: COMMITTED.plugin.replace('let jsName = "NativeRouter"', 'let jsName = "Router"'),
      }),
    ).toContain("does not look up `Router`");
  });

  // "The file was not there" and "the name is not in it" are the same fault here, and treating the
  // first as a pass is how a guard quietly stops guarding.
  it("fails closed on an unreadable web module", () => {
    expect(mutate({ web: "" })).toContain("does not look up `NativeRouter`");
  });

  // A method with no caller is a native capability nothing can reach. `dismiss` is the one that
  // matters: uncalled, a native screen outlives the route it served and the app looks frozen.
  it("catches a plugin method the web never calls", () => {
    expect(mutate({ caller: COMMITTED.caller.replace(/router\.dismiss\(\)/g, "0") })).toContain(
      "nothing on the web calls `dismiss`",
    );
  });

  // An app-target plugin ships no JavaScript, so it never appears in Capacitor.Plugins. Reading
  // that table leaves the bridge listening and nothing on the web ever asking it anything, which
  // is indistinguishable from running on the web.
  it("catches a web side that reads the plugin table instead of asking for a proxy", () => {
    expect(mutate({ web: COMMITTED.web.replace(/registerPlugin/g, "getPlugin") })).toContain(
      "never calls Capacitor.registerPlugin",
    );
  });

  it("fails closed with no bridge subclass at all", () => {
    expect(mutate({ controller: "" })).toContain("nothing can register an app-target plugin");
  });
});
