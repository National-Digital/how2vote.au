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

        DispatchQueue.main.async { [weak self] in
            guard let self, let controller = self.bridge?.viewController else {
                call.resolve(["presented": false, "reason": "no view controller"])
                return
            }

            QuizState.eligibleThisSession = eligible
            NativeCoreHost.themeRequest = { [weak self] in self?.requestThemeChange() }

            let presented = NativeCoreHost.shared.present(
                route: route,
                electionID: electionID,
                isEditing: editing,
                eligible: eligible,
                canExplore: canExplore,
                allowedMapIDs: allowedMapIDs,
                from: controller
            ) { [weak self] path in
                self?.notifyListeners(Self.exitEvent, data: ["route": path])
            }

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
