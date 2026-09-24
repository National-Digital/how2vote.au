import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hostScreens, layoutComponents, verifyNativeChrome } from "./check-native-chrome.mjs";

const url = (p) => new URL(p, import.meta.url);
const read = (p) => readFileSync(url(p), "utf8");
const VIEWS_DIR = "../apps/mobile/ios/App/App/Views/";
const views = Object.fromEntries(
  readdirSync(fileURLToPath(url(VIEWS_DIR)))
    .filter((f) => f.endsWith(".swift"))
    .map((f) => [f.replace(/\.swift$/, ""), read(VIEWS_DIR + f)]),
);

const COMMITTED = {
  layout: read("../apps/web/src/routes/+layout.svelte"),
  footer: read("../apps/web/src/lib/components/Footer.svelte"),
  router: read("../apps/web/src/lib/native-router.svelte.ts"),
  host: read("../apps/mobile/ios/App/App/Shell/NativeCoreHost.swift"),
  plugin: read("../apps/mobile/ios/App/App/Shell/NativeRouterPlugin.swift"),
  views,
  mapView: views.ElectorateMapView,
  swiftSources: Object.values(views),
  nativeCopy: JSON.parse(read("../docs/legal/native-copy.json")),
  sourceRecord: JSON.parse(read("../data/aec-spatial/source-record.json")),
  thirdParty: JSON.parse(read("../apps/web/src/lib/privacy/third-party-services.json")),
};

const mutate = (over) => verifyNativeChrome({ ...COMMITTED, ...over }).join(" ");
const withView = (name, source) => ({ views: { ...views, [name]: source } });

describe("verifyNativeChrome", () => {
  it("passes on the committed sources", () => {
    expect(verifyNativeChrome(COMMITTED)).toEqual([]);
  });

  it("reads the layout's components and the host's screens", () => {
    expect(layoutComponents(COMMITTED.layout)).toEqual(
      expect.arrayContaining(["Footer", "StaleDataNotice", "FeedbackWidget"]),
    );
    expect(hostScreens(COMMITTED.host)).toEqual({
      quiz: "QuizView",
      landing: "DocumentView",
      ballot: "BallotView",
      review: "ReviewView",
      document: "DocumentView",
    });
  });

  it("catches new layout chrome with no native disposition", () => {
    expect(
      mutate({ layout: COMMITTED.layout.replace("<Footer />", "<Footer />\n  <SurveyNudge />") }),
    ).toContain("renders <SurveyNudge>, which has no native disposition");
  });

  it("catches consent UI switched on without a native counterpart", () => {
    const thirdParty = JSON.parse(JSON.stringify(COMMITTED.thirdParty));
    const gated = thirdParty.categories.find((c) => c.consentRequired);
    thirdParty.services.push({ category: gated.id });
    expect(mutate({ thirdParty })).toContain("a service now requires consent");
  });

  it("catches a screen that drops the footer and the authorisation", () => {
    const landing = views.DocumentView.replace("SiteFooter()", "EmptyView()");
    expect(mutate(withView("DocumentView", landing))).toContain(
      'DocumentView (the "landing" screen) does not render SiteFooter()',
    );
  });

  it("catches a screen that drops the stale notice", () => {
    const quiz = views.QuizView.replace("StaleNotice()", "EmptyView()");
    expect(mutate(withView("QuizView", quiz))).toContain(
      'QuizView (the "quiz" screen) does not render StaleNotice()',
    );
  });

  it("catches a new native screen built without chrome", () => {
    const host = COMMITTED.host.replace(
      'case "review":',
      'case "saved":\n            return themed(SavedView())\n        case "review":',
    );
    expect(mutate({ host, views: { ...views, SavedView: "struct SavedView: View {}" } })).toContain(
      'SavedView (the "saved" screen) does not render StaleNotice()',
    );
  });

  it("catches a screen that bypasses themed()", () => {
    const host = COMMITTED.host.replace(
      "return themed(ReviewView(model: model, wording: wording, canVote: eligible, onExit: onExit))",
      "return AnyView(ReviewView(model: model, wording: wording, canVote: eligible, onExit: onExit))",
    );
    expect(mutate({ host })).toContain('the "review" screen is not built through themed');
  });

  it("catches the host no longer injecting the chrome", () => {
    expect(
      mutate({ host: COMMITTED.host.replace(".environment(\\.siteChrome, chrome)", "") }),
    ).toContain("does not hand the screens their site chrome");
  });

  it("catches the election dropped from the repeat check", () => {
    expect(
      mutate({ host: COMMITTED.host.replace("&& currentElectionID == electionID", "") }),
    ).toContain("election toggle would do nothing");
  });

  it("catches a screen swap that keeps the previous screen's state", () => {
    expect(mutate({ host: COMMITTED.host.replace(".id(screenIdentity)", "") })).toContain(
      "does not give each screen an identity that includes the election",
    );
  });

  it("is not satisfied by a token left in a comment", () => {
    const landing = views.DocumentView.replace("SiteFooter()", "// SiteFooter()");
    expect(mutate(withView("DocumentView", landing))).toContain("does not render SiteFooter()");
  });

  it("catches the plugin presenting without chrome", () => {
    expect(
      mutate({
        plugin: COMMITTED.plugin.replace(/guard let chrome else \{[\s\S]*?return\n\s*\}/, ""),
      }),
    ).toContain("does not decline a route without site chrome");
  });

  it("catches the explorer session no longer exchanged", () => {
    expect(
      mutate({ plugin: COMMITTED.plugin.replace('data["session"]', 'data["unused"]') }),
    ).toContain("does not exchange an explorer's session record");
  });

  it("catches the web no longer handing over the chrome, or part of it", () => {
    expect(mutate({ router: COMMITTED.router.replace("chrome: siteChrome(),", "") })).toContain(
      "does not hand the native core its site chrome",
    );
    expect(
      mutate({ router: COMMITTED.router.replace("authorisation: AUTHORISATION,", "") }),
    ).toContain("omits AUTHORISATION");
  });

  it("catches a footer link hard-coded outside the shared module", () => {
    expect(
      mutate({ footer: COMMITTED.footer.replace("</p>", '<a href="/press">Press</a></p>') }),
    ).toContain("hard-codes a link the native footer is not handed");
  });

  it("catches a map notice paragraph the native map does not draw", () => {
    const sourceRecord = JSON.parse(JSON.stringify(COMMITTED.sourceRecord));
    sourceRecord.notice.components.push("A fifth paragraph the licence now requires.");
    expect(mutate({ sourceRecord })).toContain("is not in native-copy.json");
    expect(
      mutate({ mapView: views.ElectorateMapView.replace("LegalCopy.mapLicenceNoWarranty,", "") }),
    ).toContain("does not draw LegalCopy.mapLicenceNoWarranty");
  });

  it("catches the map's attribution or licence link dropped", () => {
    expect(
      mutate({ mapView: views.ElectorateMapView.replace("Text(map.attribution)", "EmptyView()") }),
    ).toContain("does not show the map's attribution");
    expect(
      mutate({
        mapView: views.ElectorateMapView.replace("LegalCopy.mapLicenceURL", '"https://x"'),
      }),
    ).toContain("does not link the licence (LegalCopy.mapLicenceURL)");
  });

  it("catches a view writing quiz state past the explorer path", () => {
    expect(
      mutate({
        swiftSources: [
          ...COMMITTED.swiftSources,
          "persist: { try QuizState.save($0, electionID: electionID) }",
        ],
      }),
    ).toContain("writes through QuizState.save directly");
  });

  it("is not satisfied by a token inside a string", () => {
    const landing = views.DocumentView.replace("SiteFooter()", 'Text("SiteFooter()")');
    expect(mutate(withView("DocumentView", landing))).toContain("does not render SiteFooter()");
  });

  it("requires the full footer on the quiz, not the authorisation line alone", () => {
    const quiz = views.QuizView.replace("SiteFooter()", "EmptyView()");
    expect(mutate(withView("QuizView", quiz))).toContain(
      'QuizView (the "quiz" screen) does not render SiteFooter()',
    );
  });

  it("catches a footer link hard-coded however it is written", () => {
    for (const link of ['<a class="x" href="/press">P</a>', '<a href={"/press"}>P</a>']) {
      expect(mutate({ footer: COMMITTED.footer.replace("</p>", `${link}</p>`) })).toContain(
        "hard-codes a link",
      );
    }
  });

  it("fails closed when a source it reads is missing", () => {
    expect(mutate({ layout: "" })).toContain("found no components in the root layout");
    expect(mutate({ thirdParty: {} })).toContain("declares no categories");
    expect(mutate({ sourceRecord: {} })).toContain("declares no map notice paragraphs");
  });

  it("requires the cover to come down when a route is declined", () => {
    expect(
      mutate({
        plugin: COMMITTED.plugin.replace("if !presented { NativeCoreHost.shared.dismiss() }", ""),
      }),
    ).toContain("does not take down the native cover when a route is declined");
    expect(
      mutate({
        plugin: COMMITTED.plugin.replace(
          /(guard let chrome else \{[\s\S]*?)NativeCoreHost\.shared\.dismiss\(\)/,
          "$1",
        ),
      }),
    ).toContain("does not take down the cover when it does");
  });

  it("catches a footer link bound to anything but the site-chrome data", () => {
    for (const link of [
      "<a href=/press>P</a>",
      "<a {href}>P</a>",
      "<a href={pressUrl}>P</a>",
      '<ExternalLink href="https://x.org">X</ExternalLink>',
    ]) {
      expect(mutate({ footer: COMMITTED.footer.replace("</p>", `${link}</p>`) })).toContain(
        "hard-codes a link",
      );
    }
  });

  it("is not satisfied by a map licence named only in a string", () => {
    expect(
      mutate({
        mapView: COMMITTED.mapView.replace(
          "LegalCopy.mapLicenceName",
          '"LegalCopy.mapLicenceName"',
        ),
      }),
    ).toContain("LegalCopy.mapLicenceName");
  });

  it("reads a case that names several routes", () => {
    const host = COMMITTED.host.replace('case "review":', 'case "summary", "review":');
    expect(hostScreens(host)).toMatchObject({ summary: "ReviewView", review: "ReviewView" });
  });

  it("catches page text marked as decoration, which the on-screen check would skip", () => {
    const doc = views.DocumentView.replace(
      ".font(Self.headingFont(level))",
      ".font(Self.headingFont(level)).accessibilityIdentifier(DocumentURL.decoration)",
    );
    expect(doc).not.toBe(views.DocumentView);
    expect(
      mutate({
        ...withView("DocumentView", doc),
        swiftSources: Object.values({ ...views, DocumentView: doc }),
      }),
    ).toContain("marks 2 elements as decoration");
  });
});
