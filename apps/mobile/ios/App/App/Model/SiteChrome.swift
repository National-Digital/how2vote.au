import Foundation

/// The layout chrome the WebView would have drawn around a route: the footer's links, credit and
/// electoral authorisation, and the stale-data notice when it applies.
///
/// A native screen covers the whole WebView, so without this it would show none of it. The values
/// are the web's own (`apps/web/src/lib/site-chrome.ts`), handed over with each route rather than
/// authored here, so the two renderings cannot drift (ADR 0018 D6, D9).
struct SiteChrome: Decodable, Equatable {
    struct Link: Decodable, Equatable {
        let label: String
        /// A web route; following it leaves the native core.
        let href: String
    }

    struct CreditPart: Decodable, Equatable {
        let text: String
        /// An external page, opened in the in-app browser.
        let href: String?
    }

    struct Stale: Decodable, Equatable {
        let message: String
        let dataVersion: String
        let prominent: Bool
        /// The store listing, or nil where there is none to send the voter to.
        let updateUrl: String?
        /// The labels of its two controls, as the web's notice words them.
        let update: String
        let dismiss: String
    }

    let authorisation: String
    let credit: [CreditPart]
    let links: [Link]
    /// What an external link says it does before it is followed, appended to its accessible name.
    let linkCue: String
    let stale: Stale?

    /// Decodes the handover, or nil when it is missing or incomplete.
    ///
    /// Nil makes the shell decline the route, so the WebView renders it with its own footer: a
    /// native screen without the s321D authorisation is not a screen this app may show.
    static func decode(_ json: String?) -> SiteChrome? {
        guard let data = json?.data(using: .utf8),
              let chrome = try? JSONDecoder().decode(SiteChrome.self, from: data),
              !isBlank(chrome.authorisation),
              !chrome.credit.isEmpty,
              !chrome.links.isEmpty,
              !isBlank(chrome.linkCue),
              chrome.links.allSatisfy({ $0.href.hasPrefix("/") }),
              chrome.stale.map({ !isBlank($0.update) && !isBlank($0.dismiss) }) ?? true
        else { return nil }
        return chrome
    }

    private static func isBlank(_ text: String) -> Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
