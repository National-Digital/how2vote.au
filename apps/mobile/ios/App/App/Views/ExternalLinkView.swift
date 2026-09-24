import SafariServices
import SwiftUI
import UIKit

/// A link to a page outside the app, which says so before it is followed.
///
/// Mirrors `apps/web/src/lib/components/ExternalLink.svelte`, including the part that is easy to drop
/// natively: the cue. Two audiences, one cue — the ↗ arrow for anyone scanning the screen, and the
/// same words inside the accessible name, so a screen reader announces the destination change rather
/// than dropping the reader into an unexplained context (WCAG 3.2.5).
///
/// The wording is the web's app cue (`LINK_CUE.app` in `$lib/external-link-copy.ts`), handed over
/// with the site chrome. It says "in-app browser" rather than "new tab" because that is what the
/// shells actually do, and a cue that misdescribes the behaviour is worse than none.
struct ExternalLinkView: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.siteChrome) private var chrome

    let title: String
    let url: URL
    /// Set false where a visible glyph would be wrong.
    var showsGlyph = true

    @State private var presenting = false

    var body: some View {
        Button {
            presenting = true
        } label: {
            HStack(spacing: 2) {
                Text(title)
                    .underline()
                if showsGlyph {
                    Image(systemName: "arrow.up.right")
                        .font(.caption2)
                }
            }
            .frame(minHeight: 24, alignment: .leading)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.ink2.resolve(scheme))
        // A native screen is shown only with its chrome, so the cue is always there to append.
        .accessibilityLabel(chrome.map { "\(title) (\($0.linkCue))" } ?? title)
        .accessibilityAddTraits(.isLink)
        .sheet(isPresented: $presenting) {
            SafariView(url: url)
                .ignoresSafeArea()
        }
    }
}

/// `SFSafariViewController` as a SwiftUI view.
///
/// Deliberately not `openURL`: that hands the page to the system browser and takes the voter out of
/// the app, where an in-app browser keeps them in it and keeps the cue honest. It also matches what
/// the WebView channel does through Capacitor's Browser plugin, so a link behaves the same way
/// whichever half of the app it was tapped in.
struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
