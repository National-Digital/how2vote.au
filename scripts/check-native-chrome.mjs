#!/usr/bin/env node
/**
 * Every native screen carries what the web layout would have drawn around it (ADR 0018 D6).
 *
 * The iOS native core covers the whole WebView, so the root layout's chrome — the footer with its
 * s321D authorisation, the stale-data notice, the feedback entry point — is invisible on a native
 * route unless the native screen renders it. Nothing else notices its absence: the app builds, the
 * screen looks finished, and the authorisation the web shows "on every screen" is simply gone.
 *
 * This guard holds that boundary from both ends, and fails closed:
 *
 *   1. **Layout.** Every component the root layout renders has a declared native disposition, so a
 *      new piece of layout chrome cannot ship without deciding what iOS does with it.
 *   2. **Screens.** Every screen the native host serves renders the stale notice and the footer, and
 *      receives the chrome through the host.
 *   3. **Handover.** The web passes the chrome from the same module its footer renders, and the
 *      shell declines a route that arrives without it.
 *   4. **Required notices.** Every paragraph of the prescribed AEC map notice is registered and drawn.
 *   5. **State.** Native screens record progress through the explorer-aware path, never `save`
 *      directly, and a landing request for another election is not treated as a repeat.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripComments } from "./check-neutrality-claims.mjs";

/**
 * What the native core does with each component the root layout renders.
 *
 * `native` names the SwiftUI view that stands in for it; `handedOver` is chrome the native footer
 * carries as data; `none` is not visible chrome, with the reason it needs no native counterpart.
 */
export const LAYOUT_DISPOSITIONS = {
  Footer: { native: "SiteFooter" },
  StaleDataNotice: { native: "StaleNotice" },
  FeedbackWidget: { handedOver: "FEEDBACK_LINK" },
  JsonLd: { none: "structured data in the document head, not visible chrome" },
  ConsentBanner: { none: "consent UI, off while no service requires consent (checked below)" },
  ConsentSettings: { none: "consent UI, off while no service requires consent (checked below)" },
};

/**
 * Components the root layout renders, read from its markup.
 *
 * @param {string} layout
 * @returns {string[]}
 */
export function layoutComponents(layout) {
  const markup = String(layout ?? "").replace(/<script[\s\S]*?<\/script>/g, "");
  return [...new Set([...markup.matchAll(/<([A-Z]\w*)[\s/>]/g)].map((m) => m[1]))];
}

/**
 * The native screens the host serves, as route → SwiftUI view type.
 *
 * @param {string} host  NativeCoreHost.swift
 * @returns {Record<string, string>}
 */
export function hostScreens(host) {
  const screens = {};
  const body = /private func screen\([\s\S]*?\n {4}}\n/.exec(String(host ?? ""))?.[0] ?? "";
  // A case may name several routes (`case "a", "b":`); each is the same screen.
  for (const m of body.matchAll(/case ((?:"\w+"\s*,\s*)*"\w+"):([\s\S]*?)(?=case "|default:)/g)) {
    const view = /themed\(\s*(\w+)\(/.exec(m[2])?.[1];
    for (const route of m[1].matchAll(/"(\w+)"/g)) screens[route[1]] = view ?? "";
  }
  return screens;
}

/**
 * @param {object} input
 * @param {string} input.layout  apps/web/src/routes/+layout.svelte
 * @param {string} input.footer  apps/web/src/lib/components/Footer.svelte
 * @param {string} input.router  apps/web/src/lib/native-router.svelte.ts
 * @param {string} input.host  NativeCoreHost.swift
 * @param {string} input.plugin  NativeRouterPlugin.swift
 * @param {Record<string, string>} input.views  Swift view type → source
 * @param {string} input.mapView  ElectorateMapView.swift
 * @param {string[]} input.swiftSources  every Swift source under Views/
 * @param {{entries?: {swiftName?: string, text?: string, webSource?: string}[]}} input.nativeCopy
 * @param {{notice?: {components?: string[]}}} input.sourceRecord
 * @param {{categories?: {id: string, consentRequired?: boolean}[], services?: {category: string}[]}} input.thirdParty
 * @returns {string[]}
 */
export function verifyNativeChrome(raw) {
  const errors = [];
  const push = (m) => errors.push(m);
  // Matched against code only: a token that survives in a comment proves nothing about the screen.
  const code = (text) => stripComments(String(text ?? ""));
  // A view's calls are matched with its strings removed too: `Text("SiteFooter()")` draws no footer.
  const calls = (text) => code(text).replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
  const input = {
    ...raw,
    footer: code(raw?.footer),
    router: code(raw?.router),
    host: code(raw?.host),
    plugin: code(raw?.plugin),
    mapView: calls(raw?.mapView),
    views: Object.fromEntries(Object.entries(raw?.views ?? {}).map(([k, v]) => [k, calls(v)])),
    swiftSources: (raw?.swiftSources ?? []).map(code),
  };

  // Every input fails closed: an unreadable or moved source reads as empty, and empty would pass.
  const components = layoutComponents(input?.layout);
  if (components.length === 0) {
    push("found no components in the root layout — the guard cannot see its chrome (fail closed)");
  }
  for (const name of components) {
    if (!Object.hasOwn(LAYOUT_DISPOSITIONS, name)) {
      push(
        `the root layout renders <${name}>, which has no native disposition — the iOS native core ` +
          `covers the layout, so declare in LAYOUT_DISPOSITIONS what its screens do instead`,
      );
    }
  }

  const categories = input?.thirdParty?.categories ?? [];
  const services = input?.thirdParty?.services ?? [];
  if (categories.length === 0) {
    push("third-party-services.json declares no categories (fail closed)");
  }
  const consentConfigurable = categories.some(
    (c) => c.consentRequired && services.some((s) => s.category === c.id),
  );
  if (consentConfigurable) {
    push(
      "a service now requires consent, so the web shows consent UI the native core does not " +
        "render — add a native disposition for ConsentBanner/ConsentSettings before enabling it",
    );
  }

  const screens = hostScreens(input?.host);
  if (Object.keys(screens).length === 0) {
    push("found no native screens in NativeCoreHost.screen(for:) — the guard cannot see them");
  }
  for (const [route, view] of Object.entries(screens)) {
    if (!view) {
      push(`the "${route}" screen is not built through themed(…), so it receives no site chrome`);
      continue;
    }
    const source = input?.views?.[view] ?? "";
    if (!source) {
      push(`could not read ${view}.swift for the "${route}" screen (fail closed)`);
      continue;
    }
    if (!/\bStaleNotice\(\)/.test(source)) {
      push(`${view} (the "${route}" screen) does not render StaleNotice()`);
    }
    // The whole footer, on every screen: the authorisation, and the data licence credit and the
    // privacy and terms links the web shows on every route.
    if (!/\bSiteFooter\(\)/.test(source)) {
      push(
        `${view} (the "${route}" screen) does not render SiteFooter(), so it shows no electoral ` +
          `authorisation or licence credit`,
      );
    }
  }

  const host = input?.host ?? "";
  if (!/\.environment\(\\\.siteChrome,/.test(host)) {
    push("NativeCoreHost.themed does not hand the screens their site chrome");
  }
  if (!/\.id\(screenIdentity\)/.test(host) || !/screenIdentity = "[^"\n]*electionID/.test(host)) {
    push(
      "NativeCoreHost does not give each screen an identity that includes the election — a swap " +
        "between elections would update the previous screen in place and keep its state",
    );
  }
  if (!/currentElectionID == electionID/.test(host)) {
    push(
      "NativeCoreHost treats a request for the same route as a repeat without comparing the " +
        "election — the landing's election toggle would do nothing",
    );
  }

  const plugin = input?.plugin ?? "";
  if (!/SiteChrome\.decode\(call\.getString\("chrome"\)\)/.test(plugin)) {
    push('NativeRouterPlugin does not read the "chrome" the web hands over');
  }
  if (
    !/guard let chrome else \{\s*NativeCoreHost\.shared\.dismiss\(\)\s*call\.resolve\(\["presented": false/.test(
      plugin,
    )
  ) {
    push(
      "NativeRouterPlugin does not decline a route without site chrome, or does not take down the " +
        "cover when it does",
    );
  }
  // Declined for any reason, the route is the WebView's; a cover left up hides it.
  if (!/if !presented \{\s*NativeCoreHost\.shared\.dismiss\(\)\s*\}/.test(plugin)) {
    push("NativeRouterPlugin does not take down the native cover when a route is declined");
  }
  if (!/call\.getString\("session"\)/.test(plugin) || !/data\["session"\]/.test(plugin)) {
    push("NativeRouterPlugin does not exchange an explorer's session record with the web");
  }

  const router = input?.router ?? "";
  if (!/chrome: siteChrome\(\)/.test(router)) {
    push("native-router.svelte.ts does not hand the native core its site chrome");
  }
  for (const name of [
    "AUTHORISATION",
    "footerCredit",
    "footerLinks",
    "FEEDBACK_LINK",
    "staleMessage",
  ]) {
    if (
      !new RegExp(`\\b${name}\\b`).test(
        /function siteChrome\(\)[\s\S]*?\n}\n/.exec(router)?.[0] ?? "",
      )
    ) {
      push(`the chrome handed to the native core omits ${name}`);
    }
  }

  const footer = input?.footer ?? "";
  if (!/from "\$lib\/site-chrome"/.test(footer)) {
    push("Footer.svelte does not render from $lib/site-chrome, so the native footer can drift");
  }
  // Every link the footer draws is bound to site-chrome.ts data, which the native footer is handed
  // too; any other — however written — is one the native footer would not show.
  const unbound = [...footer.matchAll(/<(?:a|ExternalLink)\b[^>]*>/g)].filter(
    (m) => !/\bhref=\{(?:link|part)\.href\}/.test(m[0]),
  );
  if (unbound.length > 0) {
    push(
      "Footer.svelte hard-codes a link the native footer is not handed — add it to site-chrome.ts",
    );
  }

  const notice = input?.sourceRecord?.notice?.components ?? [];
  if (notice.length === 0) {
    push("source-record.json declares no map notice paragraphs (fail closed)");
  }
  const entries = input?.nativeCopy?.entries ?? [];
  const mapView = input?.mapView ?? "";
  for (const paragraph of notice) {
    const entry = entries.find((e) => e.text === paragraph);
    if (!entry) {
      push(`the AEC map notice paragraph "${paragraph.slice(0, 48)}…" is not in native-copy.json`);
    } else if (!new RegExp(`LegalCopy\\.${entry.swiftName}\\b`).test(mapView)) {
      push(`ElectorateMapView does not draw LegalCopy.${entry.swiftName}`);
    }
  }
  for (const name of ["mapLicenceName", "mapLicenceURL"]) {
    if (!new RegExp(`LegalCopy\\.${name}\\b`).test(mapView)) {
      push(`ElectorateMapView does not link the licence (LegalCopy.${name})`);
    }
  }
  if (!/map\.attribution/.test(mapView))
    push("ElectorateMapView does not show the map's attribution");

  for (const source of input?.swiftSources ?? []) {
    if (/QuizState\.save\(/.test(source)) {
      push(
        "a native view writes through QuizState.save directly — use QuizState.record, or an " +
          "under-18 explorer's progress is refused and the flow stalls",
      );
      break;
    }
  }

  // The on-screen document check skips elements marked as decoration, so the mark must stay on the
  // one glyph a document screen adds — a list marker — and never reach the page's text.
  const marks = (input?.swiftSources ?? []).flatMap((source) => [
    ...source.matchAll(/accessibilityIdentifier\(DocumentURL\.decoration\)/g),
  ]).length;
  if (marks !== 1) {
    push(
      `DocumentView marks ${marks} elements as decoration; only the list marker may be, or the ` +
        `on-screen text check would skip page text`,
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
const readJson = (p) => {
  try {
    return JSON.parse(read(p));
  } catch {
    return {};
  }
};

function main() {
  const viewsDir = "apps/mobile/ios/App/App/Views/";
  const names = readdirSync(fileURLToPath(new URL(viewsDir, ROOT))).filter((f) =>
    f.endsWith(".swift"),
  );
  const views = Object.fromEntries(
    names.map((f) => [f.replace(/\.swift$/, ""), read(viewsDir + f)]),
  );

  const errors = verifyNativeChrome({
    layout: read("apps/web/src/routes/+layout.svelte"),
    footer: read("apps/web/src/lib/components/Footer.svelte"),
    router: read("apps/web/src/lib/native-router.svelte.ts"),
    host: read("apps/mobile/ios/App/App/Shell/NativeCoreHost.swift"),
    plugin: read("apps/mobile/ios/App/App/Shell/NativeRouterPlugin.swift"),
    views,
    mapView: views.ElectorateMapView ?? "",
    swiftSources: Object.values(views),
    nativeCopy: readJson("docs/legal/native-copy.json"),
    sourceRecord: readJson("data/aec-spatial/source-record.json"),
    thirdParty: readJson("apps/web/src/lib/privacy/third-party-services.json"),
  });

  if (errors.length > 0) {
    for (const e of errors) console.error(`::error::native chrome: ${e}`);
    process.exit(1);
  }
  console.info(
    "native chrome OK — every native screen carries the layout's footer, notice and authorisation",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
/* c8 ignore stop */
