import Foundation

/// The ballot picker's wording, from the web's `states/ballot` page (ADR 0019 D4b): every piece the
/// screen shows or speaks, the states it offers in the web's order, the ballot an election with no
/// electorates records, and where the lookup link leads.
///
/// Nothing here is written natively. A page that drops a piece, marks other values in one, or
/// offers no states is refused, and the picker is declined for the WebView's.
struct BallotWording: Equatable {
    /// The pieces the screen uses, by the name the page gives each section (`ballot-<name>`), with
    /// the values each is filled with.
    enum Piece: String, CaseIterable {
        case position, back, progress, pick, electorate, failed, retry, search, searchLabel
        case none, unsure, lookup, located, start, different, map, unsaved

        var values: Set<String> {
            switch self {
            case .position: return ["step", "total"]
            case .failed: return ["retry"]
            case .search: return ["count", "code"]
            case .none: return ["filter"]
            case .unsure: return ["lookup"]
            case .located: return ["state"]
            case .map: return ["state", "electorate"]
            default: return []
            }
        }
    }

    struct Jurisdiction: Equatable {
        let code: String
        let name: String
    }

    typealias Part = StatesPage.Part

    /// The states and territories, in the order the picker offers them.
    let states: [Jurisdiction]
    /// The ballot an election with no electorates records, so the quiz has one to read.
    let national: (state: String, electorate: String)
    /// Where the lookup link leads.
    let lookupURL: URL
    private let pieces: [Piece: [Part]]

    init(_ page: NativeDocument) throws {
        let states = StatesPage(page)
        var pieces: [Piece: [Part]] = [:]
        for piece in Piece.allCases {
            pieces[piece] = try states.parts("ballot-\(piece.rawValue)", values: piece.values)
        }

        let offered = try states.pairs("ballot-states").map { Jurisdiction(code: $0.term, name: $0.detail) }
        guard Set(offered.map(\.code)).count == offered.count else { throw states.missing("states without repeats") }
        let national = try states.pairs("ballot-national")
        guard national.count == 1 else { throw states.missing("single national ballot") }

        // The link the page draws for its lookup piece: its words, and an https destination.
        let lookup = StatesPage.fill(pieces[.lookup] ?? [], [:])
        guard let link = try? states.paragraph("ballot-lookup-link"), link.count == 1,
              case let .link(href, true, _, _, content) = link[0],
              BallotWording.words(of: content) == lookup,
              let url = URL(string: href), url.scheme == "https", url.host != nil
        else { throw states.missing("lookup link") }

        self.states = offered
        self.national = (national[0].term, national[0].detail)
        lookupURL = url
        self.pieces = pieces
    }

    static func == (a: BallotWording, b: BallotWording) -> Bool {
        a.states == b.states && a.national == b.national && a.lookupURL == b.lookupURL
            && a.pieces == b.pieces
    }

    /// A link's drawn words, without the external-link cue the link view adds itself.
    private static func words(of content: [NativeDocument.Inline]) -> String {
        content.map { inline -> String in
            if case let .text(text) = inline { return text }
            return ""
        }.joined().trimmingCharacters(in: .whitespaces)
    }

    /// A piece of the wording, with its values filled.
    func text(_ piece: Piece, _ values: [String: String] = [:]) -> String {
        StatesPage.fill(pieces[piece] ?? [], values)
    }

    /// A piece's text on either side of its one value, for a screen that draws something else there.
    func around(_ piece: Piece) -> (before: String, after: String) {
        let parts = pieces[piece] ?? []
        let at = parts.firstIndex { if case .value = $0 { return true } else { return false } } ?? parts.count
        return (StatesPage.fill(Array(parts[..<at]), [:]), StatesPage.fill(Array(parts[min(at + 1, parts.count)...]), [:]))
    }

    func position(_ step: Int, of total: Int) -> String {
        text(.position, ["step": String(step), "total": String(total)])
    }

    /// The load failure, with its retry in place.
    var failed: String { text(.failed, ["retry": text(.retry)]) }

    /// The full name for a code, or the code itself when the page offers no such state.
    func name(for code: String) -> String {
        states.first { $0.code == code.uppercased() }?.name ?? code
    }
}
