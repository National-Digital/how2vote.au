import Capacitor
import Foundation

/// Lets the web layer hand a route to the native core (ADR 0018 D1).
///
/// The web app keeps the flow and the routing. When it reaches a route the native core implements,
/// it asks this plugin to take over; the native screen covers the WebView until the voter leaves it,
/// and the plugin reports where they went so the web can continue from there.
///
/// It is deliberately the web that asks. The alternative — the shell watching the WebView's URL —
/// makes every web-side routing change a silent native behaviour change, and gives the shell no way
/// to decline. Here declining is a first-class answer: `present` returns `{ presented: false }` when
/// the native core cannot serve the route, and the web renders its own screen instead, which is
/// D4's fallback rather than a failure.
@objc(NativeRouterPlugin)
public class NativeRouterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeRouterPlugin"
    public let jsName = "NativeRouter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "present", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "dismiss", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "themeChanged", returnType: CAPPluginReturnPromise)
    ]

    /// Emitted when the voter leaves a native screen, carrying the route the web should show.
    private static let exitEvent = "nativeRouteExit"

    /// Emitted when a native screen asks for the theme to change.
    ///
    /// A request, not a write. The theme preference is the WebView's key (ADR 0018 D3), so the
    /// native side never records it — it asks, the web performs the single durable write, and the
    /// web reports back through `themeChanged`. Two writers on one key is exactly what the
    /// ownership split exists to prevent, and the way it would fail here is a preference that
    /// appears to stick and is gone on the next launch.
    private static let themeRequestEvent = "nativeThemeRequest"

    /// Emitted when the voter dismisses the stale-data notice on a native screen. The dismissal is
    /// the WebView's key to write, for the same reason as the theme.
    private static let staleDismissEvent = "nativeStaleDismiss"

    @objc func present(_ call: CAPPluginCall) {
        guard let route = call.getString("route") else {
            call.reject("present requires a route")
            return
        }
        let editing = call.getBool("editing") ?? false
        let electionID = call.getString("electionId") ?? ""
        // The eligibility declaration is the WebView's to hold (ADR 0011): it is excluded from the
        // durable native mirror, so the native core cannot read it and is told instead, per session.
        let eligible = call.getBool("eligible") ?? false
        // The emergency levers stay single-implementation (ADR 0018 D10a): the WebView resolves the
        // signed control plane and hands the answer over. An absent list therefore withholds every
        // map, which is the direction a failed handover has to fail in.
        let allowedMapIDs = Set(call.getArray("allowedMapIds", String.self) ?? [])
        // May enter the quiz: an adult, or an under-18 exploring this session. Distinct from
        // `eligible`, which is the 18+ declaration that gates persistence and a printable plan.
        let canExplore = call.getBool("canExplore") ?? false
        // The layout chrome this screen covers. Without it the route is declined, and the WebView
        // renders it with its own footer.
        let chrome = SiteChrome.decode(call.getString("chrome"))
        // An explorer's in-memory quiz (ADR 0012), which the WebView never persists.
        let session = call.getString("session")

        DispatchQueue.main.async { [weak self] in
            guard let self, let controller = self.bridge?.viewController else {
                call.resolve(["presented": false, "reason": "no view controller"])
                return
            }

            guard let chrome else {
                // A declined route is the WebView's to render, so a native screen still covering it
                // must come down — or the voter is left on the screen they were leaving.
                NativeCoreHost.shared.dismiss()
                call.resolve(["presented": false, "reason": "no site chrome"])
                return
            }

            QuizState.eligibleThisSession = eligible
            QuizState.canExploreThisSession = canExplore
            // The web's copy is current at a handover, not at a repeat of the screen already showing,
            // where the native record may be newer.
            let repeated = NativeCoreHost.shared.isShowing(
                route: route, electionID: electionID, isEditing: editing
            )
            QuizState.acceptHandover(
                session: session, electionID: electionID, eligible: eligible, repeated: repeated
            )
            NativeCoreHost.themeRequest = { [weak self] in self?.requestThemeChange() }

            let presented = NativeCoreHost.shared.present(
                route: route,
                electionID: electionID,
                isEditing: editing,
                eligible: eligible,
                canExplore: canExplore,
                allowedMapIDs: allowedMapIDs,
                chrome: chrome,
                onDismissStale: { [weak self] version in
                    self?.notifyListeners(Self.staleDismissEvent, data: ["dataVersion": version])
                },
                from: controller
            ) { [weak self] path in
                var data: [String: Any] = ["route": path, "electionId": electionID]
                if !eligible, let record = QuizState.sessionRecords[electionID],
                   let json = try? JSONEncoder().encode(record) {
                    data["session"] = String(decoding: json, as: UTF8.self)
                }
                self?.notifyListeners(Self.exitEvent, data: data)
            }

            // Declined for any reason: take down whatever was covering the WebView, which is about
            // to render this route itself.
            if !presented { NativeCoreHost.shared.dismiss() }
            call.resolve(["presented": presented])
        }
    }

    /// Records the theme the WebView has just written, so a screen already on display updates
    /// without waiting for the durable mirror's next pass.
    @objc func themeChanged(_ call: CAPPluginCall) {
        let preference = call.getString("theme") ?? "system"
        DispatchQueue.main.async {
            NativeTheme.shared.accept(preference)
            call.resolve()
        }
    }

    /// Asks the web to change the theme. Called by a native screen, never by JavaScript.
    func requestThemeChange() {
        notifyListeners(Self.themeRequestEvent, data: [:])
    }

    /// Takes the native cover down.
    ///
    /// Called when the web reaches a route the native core does not serve. Without it the last
    /// native screen would stay over a WebView that has already moved on, and the app would look
    /// frozen on a screen the voter had left — the exact cost of letting the cover outlive its route.
    @objc func dismiss(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            NativeCoreHost.shared.dismiss()
            call.resolve()
        }
    }
}

extension QuizExit {
    /// The web route the voter continues on after leaving a native screen.
    var webRoute: String {
        switch self {
        case .review: return "/review"
        case .ballot: return "/ballot"
        case .pause: return "/"
        }
    }
}
