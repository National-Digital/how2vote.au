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
    /// that would throw away the voter's place on it. Edit mode is part of the identity: the same
    /// route entered to change one answer is a different screen from the same route walked in full.
    private var currentRoute: String?
    private var currentIsEditing = false

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
        from presenter: UIViewController,
        onExit: @escaping (String) -> Void
    ) -> Bool {
        guard !electionID.isEmpty else {
            NSLog("How2Vote: declined \(route) — no election id was passed")
            return false
        }
        if currentRoute == route, currentIsEditing == isEditing, hosting != nil { return true }

        guard let engine = loadedEngine() else {
            NSLog("How2Vote: declined \(route) — the engine did not load")
            return false
        }
        guard let screen = screen(
            for: route,
            electionID: electionID,
            isEditing: isEditing,
            eligible: eligible,
            canExplore: canExplore,
            allowedMapIDs: allowedMapIDs,
            engine: engine,
            onExit: onExit
        ) else {
            NSLog("How2Vote: declined \(route) — no native screen for it")
            return false
        }

        currentRoute = route
        currentIsEditing = isEditing
        NSLog("How2Vote: presenting \(route)")

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

    /// Takes the native cover down, revealing the WebView. Called when the web reaches a route the
    /// native core does not serve.
    func dismiss() {
        currentRoute = nil
        currentIsEditing = false
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
    private func themed(_ view: some View) -> AnyView {
        AnyView(ThemedScreen { view })
    }

    private func screen(
        for route: String,
        electionID: String,
        isEditing: Bool,
        eligible: Bool,
        canExplore: Bool,
        allowedMapIDs: Set<String>,
        engine: JSCEngine,
        onExit: @escaping (String) -> Void
    ) -> AnyView? {
        // A screen reports a WEB PATH when the voter leaves it, never the next native screen. The web
        // stays the router (D4a): the shell would otherwise hold a second, silent copy of the flow,
        // and the two would disagree the first time a route moved. None of these dismiss — if the
        // next route is also native, this cover has to stay up for the swap.
        switch route {
        case "quiz":
            let model = QuizViewModel.live(electionID: electionID, engine: engine, isEditing: isEditing)
            return themed(QuizView(model: model) { onExit($0.webRoute) })
        case "landing":
            let model = LandingViewModel.live(electionID: electionID, engine: engine)
            return themed(
                LandingView(
                    model: model,
                    canExplore: canExplore,
                    onToggleTheme: { NativeCoreHost.themeRequest?() },
                    onExit: onExit
                )
            )
        case "ballot":
            let model = BallotViewModel.live(electionID: electionID, engine: engine)
            return themed(
                BallotView(
                    model: model,
                    electionID: electionID,
                    allowedMapIDs: allowedMapIDs,
                    onExit: onExit
                )
            )
        case "review":
            let model = ReviewViewModel.live(electionID: electionID, engine: engine)
            return themed(ReviewView(model: model, canVote: eligible, onExit: onExit))
        default:
            return nil
        }
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
