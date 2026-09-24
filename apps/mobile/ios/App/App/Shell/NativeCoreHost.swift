import SwiftUI
import UIKit

/// Renders its content in the app's effective theme.
///
/// A view of its own so the preference is OBSERVED: a value read once while building the screen
/// would leave a voter who changed the theme looking at the old one until they navigated.
private struct ThemedScreen<Content: View>: View {
    @Environment(\.colorScheme) private var system
    @ObservedObject private var theme = NativeTheme.shared

    let content: () -> Content

    var body: some View {
        content().nativeTheme(theme, system: system)
    }
}

/// A document the web asks the native core to draw: its route name, and the fragment it was opened at.
struct DocumentRequest: Equatable {
    let name: String
    let anchor: String?

    var identity: String { "\(name)#\(anchor ?? "")" }
}

/// Presents the native core's screens over the WebView.
///
/// A full-screen presentation rather than a re-rooted window. Capacitor's bridge controller stays
/// the window's root, so the plugins, the URL-open proxy and the WebView's own lifecycle are exactly
/// what they were; the native screen simply covers it. Re-rooting would buy nothing a voter can see
/// and would put every Capacitor assumption about its own view controller in play at once.
///
/// Moving between two native screens SWAPS the presented content rather than dismissing and
/// presenting again. Dismissing first would show the WebView for the width of the transition —
/// mid-route, on a page the voter has already left — so every native-to-native step would flash the
/// screen they were escaping. The cover therefore stays up until the web reaches a route the native
/// core does not serve, and only then comes down.
///
/// The engine is loaded once and kept. Evaluating the bundle costs real time, and a voter moving
/// between native screens should not pay it again.
@MainActor
final class NativeCoreHost {
    static let shared = NativeCoreHost()

    private var engine: JSCEngine?
    private var hosting: UIHostingController<AnyView>?
    /// The route currently on screen, so a repeated request for it is a no-op rather than a rebuild
    /// that would throw away the voter's place on it. Edit mode and the election are part of the
    /// identity: the landing serves every election, and the toggle between them is the same route.
    private var currentRoute: String?
    private var currentIsEditing = false
    private var currentElectionID: String?
    /// The document on screen, for the document route, including the fragment it was opened at.
    private var currentDocument: String?
    /// What the web handed over for the screen on display, which a change of updates it.
    private var currentData: String?
    /// The layout chrome for the screen being built, and what its links and notice do.
    private var chrome: SiteChrome?
    private var chromeActions = SiteChromeActions()
    /// The identity of the screen being built. A swap to the same view type would otherwise be an
    /// in-place update that keeps the previous screen's state — the old election, the old model.
    private var screenIdentity = ""

    /// Asks the web to change the theme. Set by the plugin, because the theme preference is the
    /// WebView's key to write (ADR 0018 D3) and a screen can only request the change.
    static var themeRequest: (() -> Void)?

    private init() {}

    /// Shows, or swaps to, the native screen for a route.
    ///
    /// - Returns: `false` when the native core cannot serve this route, so the caller renders the
    ///   web screen instead (ADR 0018 D4). An unknown route, an engine that will not load and a
    ///   dataset that will not decode all take that path: the failure of a native surface must be
    ///   "this looks like the web app", never a dead screen.
    @discardableResult
    func present(
        route: String,
        electionID: String,
        isEditing: Bool,
        eligible: Bool,
        canExplore: Bool,
        allowedMapIDs: Set<String>,
        document: DocumentRequest? = nil,
        data: String? = nil,
        chrome: SiteChrome,
        onDismissStale: @escaping (String) -> Void,
        onSlotAction: @escaping (NativeDocument.Slot, String) -> Void,
        onScreenAction: @escaping (ScreenAction, String?, ((String) -> Void)?) -> Void,
        from presenter: UIViewController,
        onExit: @escaping (String) -> Void
    ) -> Bool {
        guard !electionID.isEmpty else {
            NSLog("How2Vote: declined \(route) — no election id was passed")
            return false
        }
        if isShowing(route: route, electionID: electionID, isEditing: isEditing, document: document, data: data) {
            return true
        }

        // A document is drawn from its projection alone, so it needs no engine.
        let engine = loadedEngine()
        guard engine != nil || !Self.needsEngine(route) else {
            NSLog("How2Vote: declined \(route) — the engine did not load")
            return false
        }
        // Set before building, because `themed` reads them; restored if the route is declined, so a
        // screen still on display keeps the chrome and actions it was built with.
        let previous = (self.chrome, chromeActions, screenIdentity)
        self.chrome = chrome
        chromeActions = SiteChromeActions(exit: onExit, dismissStale: onDismissStale, slotAction: onSlotAction)
        // Not the data: a screen handed new data — a saved card deleted — is updated in place, so
        // the voter keeps their place in it.
        screenIdentity = "\(route)|\(electionID)|\(isEditing)|\(document?.identity ?? "")"
        guard let screen = screen(
            for: route,
            electionID: electionID,
            isEditing: isEditing,
            document: document,
            data: data,
            eligible: eligible,
            canExplore: canExplore,
            allowedMapIDs: allowedMapIDs,
            engine: engine,
            onScreenAction: onScreenAction,
            onExit: onExit
        ) else {
            (self.chrome, chromeActions, screenIdentity) = previous
            NSLog("How2Vote: declined \(route) — no native screen for it")
            return false
        }

        currentRoute = route
        currentIsEditing = isEditing
        currentElectionID = electionID
        currentDocument = document?.identity
        currentData = data
        NSLog("How2Vote: presenting \(route)\(document.map { " \($0.name)" } ?? "")")

        if let hosting {
            hosting.rootView = screen
            return true
        }

        let controller = UIHostingController(rootView: screen)
        controller.modalPresentationStyle = .fullScreen
        // The native core is the app here, not a sheet over it: an interactive dismiss would drop a
        // voter back into a WebView showing a route they had already left.
        controller.isModalInPresentation = true

        hosting = controller
        presenter.present(controller, animated: false)
        return true
    }

    /// True when this exact screen is already on display, so a request for it changes nothing.
    func isShowing(
        route: String, electionID: String, isEditing: Bool, document: DocumentRequest? = nil, data: String? = nil
    ) -> Bool {
        currentRoute == route && currentIsEditing == isEditing && currentElectionID == electionID
            && currentDocument == document?.identity && currentData == data && hosting != nil
    }

    /// Takes the native cover down, revealing the WebView. Called when the web reaches a route the
    /// native core does not serve.
    func dismiss() {
        currentRoute = nil
        currentIsEditing = false
        currentElectionID = nil
        currentDocument = nil
        currentData = nil
        guard let hosting else { return }
        self.hosting = nil
        hosting.dismiss(animated: false)
    }

    /// The screen for a route, or nil when there is none — which is what makes D4's fallback a
    /// decision rather than a crash.
    /// Wraps a screen so it renders in the app's effective theme.
    ///
    /// At the host rather than in each view: a screen that forgot the wrapper would render in the
    /// system appearance and look like the theme had simply not been applied to that one page.
    /// The layout chrome goes in at the same point, so every screen is handed it without being
    /// able to forget it.
    private func themed(_ view: some View) -> AnyView {
        AnyView(
            ThemedScreen { view }
                .id(screenIdentity)
                .environment(\.siteChrome, chrome)
                .environment(\.siteChromeActions, chromeActions)
        )
    }

    private func screen(
        for route: String,
        electionID: String,
        isEditing: Bool,
        document: DocumentRequest?,
        data: String?,
        eligible: Bool,
        canExplore: Bool,
        allowedMapIDs: Set<String>,
        engine: JSCEngine?,
        onScreenAction: @escaping (ScreenAction, String?, ((String) -> Void)?) -> Void,
        onExit: @escaping (String) -> Void
    ) -> AnyView? {
        // A screen reports a WEB PATH when the voter leaves it, never the next native screen. The web
        // stays the router (D4a): the shell would otherwise hold a second, silent copy of the flow,
        // and the two would disagree the first time a route moved. None of these dismiss — if the
        // next route is also native, this cover has to stay up for the swap.
        switch route {
        case "quiz":
            guard let engine else { return nil }
            // Its wording is the web's quiz page; one that is missing or incomplete declines the
            // route, and the WebView draws the quiz instead.
            do {
                let (page, _) = try NativeDocument.load(name: "states/quiz")
                let wording = try QuizWording(page)
                let model = QuizViewModel.live(electionID: electionID, engine: engine, isEditing: isEditing)
                return themed(QuizView(model: model, wording: wording) { onExit($0.webRoute) })
            } catch {
                NSLog("How2Vote: declined quiz — \(error)")
                return nil
            }
        case "landing":
            // The election's prerendered landing, with the stage the engine reports and the voter's
            // progress drawn from the states page (ADR 0019 D4b).
            guard let document, let engine else { return nil }
            do {
                let model = LandingViewModel.live(electionID: electionID, engine: engine)
                let (landing, _) = try NativeDocument.load(name: document.name)
                let (states, _) = try NativeDocument.load(name: "states/landing")
                let composed = try LandingComposition.compose(
                    landing: landing,
                    states: states,
                    electionID: electionID,
                    phase: model.phase ?? LandingComposition.prerenderedPhase(of: landing, electionID: electionID) ?? "",
                    progress: model.progress
                )
                let labels = try LandingComposition.themeLabels(in: states)
                // The landing's buttons act here: the quiz state is the native core's (ADR 0018 D3).
                let begin = {
                    QuizState.clear(electionID: electionID)
                    onExit(canExplore ? "/ballot" : "/start")
                }
                // By the action each button names on the page, as the page's own handlers are bound.
                chromeActions.slotAction = { _, action in
                    if action == "resume" {
                        onExit("/quiz")
                    } else if action == "card" {
                        onExit("/card")
                    } else if action == "start" {
                        begin()
                    }
                }
                return themed(
                    DocumentView(
                        layout: DocumentLayout(composed),
                        anchor: nil,
                        theme: (labels, { NativeCoreHost.themeRequest?() }),
                        onExit: onExit
                    )
                )
            } catch {
                NSLog("How2Vote: declined landing \(document.name) — \(error)")
                return nil
            }
        case "ballot":
            guard let engine else { return nil }
            // Its wording is the web's ballot page; one that is missing or incomplete declines the
            // route, and the WebView draws the picker instead.
            do {
                let (page, _) = try NativeDocument.load(name: "states/ballot")
                let wording = try BallotWording(page)
                let model = BallotViewModel.live(electionID: electionID, engine: engine, national: wording.national)
                return themed(
                    BallotView(
                        model: model,
                        wording: wording,
                        electionID: electionID,
                        allowedMapIDs: allowedMapIDs,
                        onExit: onExit
                    )
                )
            } catch {
                NSLog("How2Vote: declined ballot — \(error)")
                return nil
            }
        case "review":
            guard let engine else { return nil }
            // Its wording is the web's review page; one that is missing or incomplete declines the
            // route, and the WebView draws the review instead.
            do {
                let (page, _) = try NativeDocument.load(name: "states/review")
                let wording = try ReviewWording(page)
                let model = ReviewViewModel.live(electionID: electionID, engine: engine)
                return themed(ReviewView(model: model, wording: wording, canVote: eligible, onExit: onExit))
            } catch {
                NSLog("How2Vote: declined review — \(error)")
                return nil
            }
        case "document":
            // A page the web prerendered, drawn from its projection. One that is missing, does not
            // decode, or lays out to other text than the page's is declined, and the WebView shows it.
            guard let document else { return nil }
            do {
                let (page, layout) = try NativeDocument.load(name: document.name)
                // A page holding the clear-data control is drawn with its confirmation's wording.
                let clearData = ClearDataWording.isNeeded(by: page)
                    ? try ClearDataWording(NativeDocument.load(name: "states/clear-data").0)
                    : nil
                return themed(
                    DocumentView(layout: layout, anchor: document.anchor, onExit: onExit)
                        .environment(\.clearDataWording, clearData)
                )
            } catch {
                NSLog("How2Vote: declined document \(document.name) — \(error)")
                return nil
            }
        case "saved":
            // The cards are the web's to hold, handed over with the route; the screen's words are the
            // web's saved page. Either missing declines the route, and the WebView lists the cards.
            do {
                let (page, _) = try NativeDocument.load(name: "states/saved")
                let wording = try SavedWording(page)
                let clearData = try ClearDataWording(NativeDocument.load(name: "states/clear-data").0)
                let cards = try SavedCard.list(data)
                return themed(
                    SavedView(wording: wording, cards: cards, onAction: { onScreenAction($0, $1, nil) }, onExit: onExit)
                        .environment(\.clearDataWording, clearData)
                )
            } catch {
                NSLog("How2Vote: declined saved — \(error)")
                return nil
            }
        case "contact":
            // The page's text above its form is drawn as a document; the form is drawn from the
            // form's wording, and sending asks the web, which makes the page's own submission.
            do {
                let (_, intro) = try NativeDocument.load(name: "states/contact")
                let wording = try ContactWording(NativeDocument.load(name: "states/contact-form").0)
                return themed(
                    DocumentView(
                        layout: intro,
                        anchor: nil,
                        onExit: onExit,
                        form: AnyView(ContactForm(wording: wording) { fields in
                            await withCheckedContinuation { answered in
                                onScreenAction(.contactSend, fields) { answered.resume(returning: $0) }
                            }
                        })
                    )
                )
            } catch {
                NSLog("How2Vote: declined contact — \(error)")
                return nil
            }
        default:
            return nil
        }
    }

    /// Whether a route's screen runs the engine. A page drawn from its projection, and a list the web
    /// hands over, need none.
    private static func needsEngine(_ route: String) -> Bool {
        !["document", "saved", "contact"].contains(route)
    }

    private func loadedEngine() -> JSCEngine? {
        if let engine { return engine }
        do {
            let loaded = try JSCEngine()
            engine = loaded
            return loaded
        } catch {
            // Falling back to the WebView is the designed answer, so this is a diagnostic rather
            // than an error path: the voter still gets a working quiz.
            NSLog("How2Vote: native core unavailable, falling back to the WebView — \(error)")
            return nil
        }
    }
}
