#!/usr/bin/env node
/**
 * The native core's route handover is actually wired (ADR 0018 D1).
 *
 * Handing a route from the WebView to a native screen depends on a chain of four links, and every
 * one of them fails silently — the app builds, launches, and shows the web screen it always did:
 *
 *   1. **The storyboard names the subclass.** Capacitor's own `CAPBridgeViewController` has no
 *      `capacitorDidLoad` override of ours, so a storyboard still pointing at it produces a bridge
 *      with no plugin registered and no error anywhere.
 *   2. **The subclass registers the plugin.** A `CAPPlugin` in the APP target is not discovered the
 *      way a packaged plugin is; it has to be handed to the bridge.
 *   3. **The plugin declares its methods.** Capacitor dispatches through `pluginMethods`, so a
 *      method that exists in Swift and not in that list is unreachable from JavaScript.
 *   4. **The web calls it by the name the plugin publishes.** `jsName` is the key under
 *      `window.Capacitor.Plugins`, and the web layer reads that object by name and falls back to
 *      null — which is exactly what it does on the web, so a mismatch looks like "not a native
 *      shell" rather than like a fault.
 *
 * None of that is visible to the compiler, to the simulator launch check, or to a reviewer reading
 * either side on its own. It is four literals agreeing, so it is checkable without running anything.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * @param {object} input
 * @param {string} input.storyboard  Main.storyboard
 * @param {string} input.controller  MainViewController.swift
 * @param {string} input.plugin  NativeRouterPlugin.swift
 * @param {string} input.web  the module that looks the plugin up
 * @param {string} input.caller  the module that calls its methods
 * @returns {string[]}
 */
export function verifyRouterWiring(input) {
  const errors = [];
  const storyboard = input?.storyboard ?? "";
  const controller = input?.controller ?? "";
  const plugin = input?.plugin ?? "";
  const web = input?.web ?? "";

  const rooted = /<viewController[^>]*customClass="([^"]+)"/.exec(storyboard)?.[1] ?? null;
  const subclass = /class (\w+): CAPBridgeViewController/.exec(controller)?.[1] ?? null;

  if (subclass === null) {
    errors.push("no CAPBridgeViewController subclass — nothing can register an app-target plugin");
  } else if (rooted !== subclass) {
    errors.push(
      `Main.storyboard instantiates ${JSON.stringify(rooted)}, not ${JSON.stringify(subclass)} — ` +
        `capacitorDidLoad would never run, so the native router would never be registered and the ` +
        `app would silently serve the web screen for every route`,
    );
  }

  const registered = [...controller.matchAll(/registerPluginInstance\((\w+)\(\)\)/g)].map(
    (m) => m[1],
  );
  const pluginClass = /public class (\w+): CAPPlugin/.exec(plugin)?.[1] ?? null;

  if (pluginClass === null) {
    errors.push("NativeRouterPlugin.swift declares no CAPPlugin subclass (fail closed)");
  } else if (!registered.includes(pluginClass)) {
    errors.push(
      `${pluginClass} is never handed to the bridge — a plugin defined in the app target is not ` +
        `auto-discovered, so JavaScript would find no such plugin`,
    );
  }

  // `@objc func name` is what Capacitor can call; `pluginMethods` is what it will look for. Either
  // one alone is a method that cannot be invoked.
  const declared = [...plugin.matchAll(/CAPPluginMethod\(name: "(\w+)"/g)].map((m) => m[1]);
  const implemented = [...plugin.matchAll(/@objc func (\w+)\(_ call: CAPPluginCall\)/g)].map(
    (m) => m[1],
  );
  if (declared.length === 0) errors.push("the plugin declares no pluginMethods (fail closed)");
  for (const name of declared) {
    if (!implemented.includes(name)) {
      errors.push(`pluginMethods names \`${name}\`, which the plugin does not implement`);
    }
  }
  for (const name of implemented) {
    if (!declared.includes(name)) {
      errors.push(
        `\`${name}\` is implemented but absent from pluginMethods — Capacitor dispatches through ` +
          `that list, so JavaScript cannot reach it`,
      );
    }
  }

  // An app-target plugin ships no JavaScript, so it never appears in `Capacitor.Plugins` — the web
  // has to ask the bridge for a proxy by name. Reading the table instead leaves the bridge
  // listening and nothing on the web ever asking it anything, which is indistinguishable from
  // running on the web.
  if (!/registerPlugin/.test(web)) {
    errors.push(
      "the web never calls Capacitor.registerPlugin — an app-target plugin is not published to " +
        "Capacitor.Plugins, so the lookup would find nothing and every route would fall back",
    );
  }

  const jsName = /let jsName = "(\w+)"/.exec(plugin)?.[1] ?? null;
  if (jsName === null) {
    errors.push("the plugin publishes no jsName (fail closed)");
  } else if (!web.includes(`"${jsName}"`)) {
    // Fails closed on an unreadable web module too: "the file was not there" and "the name does not
    // appear in it" are the same fault from the guard's point of view, and treating the first as a
    // pass is how a check quietly stops checking.
    errors.push(
      `the web layer does not look up \`${jsName}\` — the name the plugin publishes and the name ` +
        `the web reads must match, and a mismatch reads as "not a native shell"`,
    );
  }

  // Every method the plugin publishes must have a caller, or a native capability exists that
  // nothing can reach. `dismiss` is the one that matters: without a call, a native screen outlives
  // the route it was serving and the app looks frozen on a page the voter has already left.
  const caller = input?.caller ?? "";
  for (const name of declared) {
    if (!new RegExp(`\\.${name}\\(`).test(caller)) {
      errors.push(
        `nothing on the web calls \`${name}\` — a plugin method with no caller is a native ` +
          `capability the app cannot reach`,
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
  const errors = verifyRouterWiring({
    storyboard: read("apps/mobile/ios/App/App/Base.lproj/Main.storyboard"),
    controller: read("apps/mobile/ios/App/App/Shell/MainViewController.swift"),
    plugin: read("apps/mobile/ios/App/App/Shell/NativeRouterPlugin.swift"),
    web: read("apps/web/src/lib/channel.ts"),
    caller: read("apps/web/src/lib/native-router.svelte.ts"),
  });

  if (errors.length > 0) {
    for (const e of errors) console.error(`::error::native router: ${e}`);
    process.exit(1);
  }
  console.info("native router OK — storyboard, registration, methods and the web name agree");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
/* c8 ignore stop */
