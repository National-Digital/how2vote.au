import Foundation

/// The saved-cards screen's wording, from the web's `states/saved` page (ADR 0019 D4b): every piece
/// the screen shows or speaks, and the clear-all-data section it ends with, as the page renders it.
///
/// Nothing here is written natively. A page that drops a piece, marks other values in one, or holds
/// no plain clear-data section is refused, and the route is declined for the WebView's.
struct SavedWording: Equatable {
    /// The pieces the screen uses, by the name the page gives each section (`saved-<name>`), with
    /// the values each is filled with.
    enum Piece: String, CaseIterable {
        case title, back, none, how, action, build, kept, meta, remove, removal, clear, ask, confirm, cancel

        var values: Set<String> {
            switch self {
            case .how: return ["action"]
            case .meta: return ["state", "date"]
            case .removal: return ["electorate"]
            case .ask: return ["count"]
            default: return []
            }
        }
    }

    typealias Part = StatesPage.Part

    private let pieces: [Piece: [Part]]
    /// The clear-all-data section, laid out as the page draws it. It holds no links or terms, so
    /// nothing in it is for a tap to follow.
    let clearData: DocumentLayout

    init(_ page: NativeDocument) throws {
        let states = StatesPage(page)
        var pieces: [Piece: [Part]] = [:]
        for piece in Piece.allCases {
            pieces[piece] = try states.parts("saved-\(piece.rawValue)", values: piece.values)
        }
        // The how-to names its button once, between two pieces of text, as the page sets it in bold.
        guard let how = pieces[.how], how.count == 3, how[1] == .value("action") else {
            throw states.missing("how-to naming its button between its text")
        }

        let sections = page.blocks.filter { block in
            if case .section(.clearData, _, _) = block { return true }
            return false
        }
        guard sections.count == 1 else { throw states.missing("clear-data section") }
        let layout = DocumentLayout(
            NativeDocument(
                route: page.route, title: "", crumbs: nil, crumbsLabel: nil, top: nil, brand: nil,
                blocks: sections, digest: "", spoken: "", drawn: ""
            )
        )
        guard layout.links.isEmpty, layout.terms.isEmpty else {
            throw states.missing("clear-data section without links")
        }

        self.pieces = pieces
        clearData = layout
    }

    /// A piece of the wording, with its values filled.
    func text(_ piece: Piece, _ values: [String: String] = [:]) -> String {
        StatesPage.fill(pieces[piece] ?? [], values)
    }

    /// The how-to on either side of the button it names, so the name can be set as the page sets it.
    var how: (before: String, after: String) {
        let parts = pieces[.how] ?? []
        return (StatesPage.fill(Array(parts.prefix(1)), [:]), StatesPage.fill(Array(parts.suffix(1)), [:]))
    }
}

/// A saved card as the web's saved page lists it: its link, and the values its row reads.
struct SavedCard: Decodable, Equatable, Identifiable {
    let url: String
    let electorate: String
    let state: String
    let date: String

    var id: String { url }

    struct Invalid: Error, CustomStringConvertible {
        let description: String
    }

    /// The cards the web handed over, or a refusal when there are none to read or one is not a route:
    /// a card is opened by the web, at a path of its own.
    static func list(_ data: String?) throws -> [SavedCard] {
        guard let data else { throw Invalid(description: "no saved cards were handed over") }
        let cards = try JSONDecoder().decode([SavedCard].self, from: Data(data.utf8))
        for card in cards where !card.url.hasPrefix("/") || card.url.hasPrefix("//") || card.url.contains("\\") {
            throw Invalid(description: "a saved card whose link is not a route")
        }
        guard Set(cards.map(\.url)).count == cards.count else {
            throw Invalid(description: "a saved card listed twice")
        }
        return cards
    }
}
