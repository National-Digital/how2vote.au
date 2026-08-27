import Capacitor
import UIKit
import WebKit

/// The app's Capacitor bridge controller, with the native core's plugin attached.
///
/// Capacitor discovers plugins that ship as packages. A `CAPPlugin` defined in the APP target is not
/// discovered — it has to be handed to the bridge explicitly, and `capacitorDidLoad()` is the hook
/// that runs once the bridge exists. Registration that never happens is invisible: the web layer
/// reads `window.Capacitor.Plugins` by name and falls back to null, which is the same thing it sees
/// on the web, so a missing native router would silently mean "the web quiz, for ever".
///
/// `Main.storyboard` must name THIS class, not `CAPBridgeViewController`. That is the other half of
/// the same silent failure, so `scripts/check-native-router.mjs` asserts it.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(NativeRouterPlugin())

        // Declares the native core the writer of the keys it owns (ADR 0018 D3), before the web app
        // has mounted and so before its mirror can run a backup pass. Without the claim the mirror
        // never stands down: `NativeState.set` refuses every write, a voter's native answers are
        // held in memory only, and they are gone the moment the screen closes. At launch rather than
        // when a native screen opens, because a claim made and then not honoured would leave the
        // owned keys with no writer at all and no eviction protection.
        NativeState.claimOwnership()

        // A marker, not chatter. The native core is reached through a chain of four things that all
        // fail silently — a storyboard class, a plugin registration, a method table and a name the
        // web looks up — and the app runs perfectly with every one of them broken, serving the web
        // screens it always did. CI reads this line to tell "the native core is running" from "the
        // native core was never asked".
        NSLog("How2Vote: native router registered")

        // Web-side markers reach the same log as this one — see `MarkerLog`. Installed here so the
        // forwarding script is in place before the app's first document loads.
        markerLog.install(on: bridge?.webView)
    }

    private let markerLog = MarkerLog()
}

/// Forwards the web layer's `How2Vote:` markers into the unified log.
///
/// Capacitor's own console forwarding cannot carry them. It is disabled outright in a Release build
/// (`loggingBehavior` defaults to debug-only, so `CAPLog.enableLogging` is false — and Release is
/// the configuration CI builds), and even with it on, `CAPLog.print` writes to **stdout**, which
/// `log show` does not read and `simctl launch` discards unless it is asked for a console pipe.
/// A web-side marker was therefore unobservable on the device by two independent mechanisms, which
/// is not a thing to rediscover the next time the two halves disagree about what ran.
///
/// Only messages already prefixed `How2Vote:` are forwarded — a handful per launch, the same ones
/// CI asserts on — so this carries the diagnostics and none of the framework's chatter.
///
/// A class of its own, rather than the view controller conforming: the user-content controller
/// retains its message handlers, and a controller that retains it back would never be released.
final class MarkerLog: NSObject, WKScriptMessageHandler {
    private static let name = "how2voteMarker"

    /// The forwarder runs at document start, wraps `console.info` and passes the original call
    /// through, so the web keeps whatever logging it would otherwise have done.
    private static let script = """
        (function () {
          var pass = console.info.bind(console);
          console.info = function () {
            try {
              var text = Array.prototype.map.call(arguments, String).join(" ");
              if (text.indexOf("How2Vote:") === 0) {
                window.webkit.messageHandlers.how2voteMarker.postMessage(text);
              }
            } catch (e) {
              /* never let a diagnostic break the page */
            }
            return pass.apply(console, arguments);
          };
        })();
        """

    func install(on webView: WKWebView?) {
        guard let controller = webView?.configuration.userContentController else {
            NSLog("How2Vote: marker log NOT installed — no web view")
            return
        }
        controller.add(self, name: Self.name)
        controller.addUserScript(
            WKUserScript(source: Self.script, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        // Its own marker. Without it, a run with no web markers cannot say whether the web stayed
        // silent or the forwarder was never there to carry it — which is the ambiguity that made
        // the last several runs cost a round trip each to interpret.
        NSLog("How2Vote: marker log installed")
    }

    func userContentController(_: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let text = message.body as? String else { return }
        NSLog("%@", text)
    }
}
