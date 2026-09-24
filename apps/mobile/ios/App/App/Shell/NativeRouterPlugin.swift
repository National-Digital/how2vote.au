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
        CAPPluginMethod(name: "themeChanged", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "answer", returnType: CAPPluginReturnPromise)
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

    /// Emitted when the voter presses a control a projected page's slot stands in for. The web
    /// does what that control does on the page — it owns the keys and the flow, so the native side
    /// draws the button and never acts on it itself.
    private static let slotActionEvent = "nativeSlotAction"

    /// Emitted when the voter asks a native screen to change state the web holds — a saved card
    /// deleted. The web makes the change and offers the route again, and the screen is redrawn from
    /// what it then holds.
    private static let screenActionEvent = "nativeScreenAction"

    /// The screens waiting on the web's answer to a request, by the request's id.
    private var waiting: [String: (String) -> Void] = [:]

    /// How long a screen waits for the web's answer before it is answered empty, as a failure. Longer
    /// than the web's own bound on a submission (a 20-second request after its anti-spam check), so
    /// only an answer that is never coming — a WebView reloaded mid-request — is cut short.
    private static let answerTimeout: TimeInterval = 60

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
        // The theme the WebView holds now. Handed over with every route, so a native screen follows
        // a change made anywhere — including the reset a data wipe makes.
        let theme = call.getString("theme")
        // What the screen draws that the web holds — the saved cards — handed over with the route.
        let data = call.getString("data")
        // The page to draw, for the document route.
        let document = call.getString("document").map {
            DocumentRequest(name: $0, anchor: call.getString("anchor").flatMap { $0.isEmpty ? nil : $0 })
        }

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
                route: route, electionID: electionID, isEditing: editing, document: document, data: data
            )
            QuizState.acceptHandover(
                session: session, electionID: electionID, eligible: eligible, repeated: repeated
            )
            NativeCoreHost.themeRequest = { [weak self] in self?.requestThemeChange() }
            if let theme { NativeTheme.shared.accept(theme) }
            // Claimed again at every handover, which always follows a data wipe's reload: the wipe
            // clears every `how2vote:` key, the ownership marker included, and without it every
            // native write is refused until the app next launches.
            NativeState.claimOwnership()

            let presented = NativeCoreHost.shared.present(
                route: route,
                electionID: electionID,
                isEditing: editing,
                eligible: eligible,
                canExplore: canExplore,
                allowedMapIDs: allowedMapIDs,
                document: document,
                data: data,
                chrome: chrome,
                onDismissStale: { [weak self] version in
                    self?.notifyListeners(Self.staleDismissEvent, data: ["dataVersion": version])
                },
                onSlotAction: { [weak self] slot, action in
                    if slot == .clearData { QuizState.sessionRecords.removeAll() }
                    self?.notifyListeners(Self.slotActionEvent, data: ["slot": slot.rawValue, "action": action])
                },
                onScreenAction: { [weak self] action, value, reply in
                    guard let self else {
                        reply?("")
                        return
                    }
                    var data: [String: Any] = ["screen": action.screen, "action": action.name]
                    if let value { data["value"] = value }
                    if let reply {
                        let request = UUID().uuidString
                        self.waiting[request] = reply
                        data["request"] = request
                        // Every request is answered once: by the web, or empty when it never does.
                        DispatchQueue.main.asyncAfter(deadline: .now() + Self.answerTimeout) { [weak self] in
                            self?.waiting.removeValue(forKey: request)?("")
                        }
                    }
                    self.notifyListeners(Self.screenActionEvent, data: data)
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

    /// The web's answer to a screen's request: how sending a contact message went, say. Each request
    /// is answered once; an answer to none waiting is dropped.
    @objc func answer(_ call: CAPPluginCall) {
        let request = call.getString("request") ?? ""
        let answer = call.getString("answer") ?? ""
        DispatchQueue.main.async { [weak self] in
            self?.waiting.removeValue(forKey: request)?(answer)
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

/// A request a native screen makes of the web, for state the web holds (ADR 0018 D3), named as
/// `SCREEN_ACTIONS` in `native-screen-actions.ts` names it: `<screen>:<action>`.
enum ScreenAction: String, CaseIterable {
    case savedRemove = "saved:remove"
    case savedClear = "saved:clear"
    case contactSend = "contact:send"
    case insightsRefresh = "insights:refresh"

    /// The screen that asks.
    var screen: String { String(rawValue.prefix { $0 != ":" }) }
    /// What it asks for.
    var name: String { String(rawValue.drop { $0 != ":" }.dropFirst()) }
}
