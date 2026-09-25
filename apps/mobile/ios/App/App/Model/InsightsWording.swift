import Foundation

/// The Insights page's wording, from the web's `states/insights` page (ADR 0019 D4b): its title and
/// top bar, its lead, and every piece the screen shows or speaks around the figures.
///
/// Nothing here is written natively. A page that drops a piece, marks other values in one, or leads
/// without the group size marked is refused, and the route is declined for the WebView's.
struct InsightsWording: Equatable {
    /// The pieces the screen uses, by the name the page gives each section (`insights-<name>`), with
    /// the values each is filled with.
    enum Piece: String, CaseIterable {
        case top, back, title, elections, cohorts, regions, national, failed, updated, withheld
        case parties, bar, of, propositions, agree, neutral, disagree, split, tally, footnote
        case upcoming, empty, closedTitle, closed, closedTime

        var values: Set<String> {
            switch self {
            case .updated: return ["election", "date", "count"]
            case .bar: return ["label", "pct", "shown"]
            case .of: return ["shown"]
            case .split, .tally: return ["agree", "neutral", "disagree", "shown"]
            case .upcoming: return ["election"]
            case .closed: return ["time"]
            default: return []
            }
        }
    }

    typealias Part = StatesPage.Part

    private let pieces: [Piece: [Part]]
    private let page: NativeDocument
    private let heading: NativeDocument.Block
    private let lead: [NativeDocument.Block]
    /// The group size the lead names when no election's figures say otherwise: the page's own.
    let defaultMinimum: String

    init(_ page: NativeDocument) throws {
        let states = StatesPage(page)
        var pieces: [Piece: [Part]] = [:]
        for piece in Piece.allCases {
            pieces[piece] = try states.parts("insights-\(piece.rawValue)", values: piece.values)
        }
        guard let heading = page.blocks.first(where: {
            if case .heading(1, _, _) = $0 { return true }
            return false
        }), page.top != nil else {
            throw states.missing("title and top bar")
        }
        guard let lead = states.sections["insights-lead"],
              case let marked = StatesPage.marked(in: lead), marked.map(\.name) == ["min"], let minimum = marked.first?.sample
        else {
            throw states.missing("lead naming its group size once")
        }
        // The closing time sits between two pieces of text, as the page sets it in bold.
        guard let closed = pieces[.closed], closed.count == 3, closed[1] == .value("time") else {
            throw states.missing("closing notice naming its time between its text")
        }

        self.pieces = pieces
        self.page = page
        self.heading = heading
        self.lead = lead
        defaultMinimum = minimum
    }

    /// A piece of the wording, with its values filled.
    func text(_ piece: Piece, _ values: [String: String] = [:]) -> String {
        StatesPage.fill(pieces[piece] ?? [], values)
    }

    /// The closing notice on either side of the time it names, so the time can be set as the page sets it.
    var closed: (before: String, after: String) {
        let parts = pieces[.closed] ?? []
        return (StatesPage.fill(Array(parts.prefix(1)), [:]), StatesPage.fill(Array(parts.suffix(1)), [:]))
    }

    /// The page's title and top bar, and — unless the page is closed — its lead with the group size
    /// given, laid out as the page draws them.
    func head(closed: Bool, minimum: String) -> DocumentLayout {
        let blocks = [heading] + (closed ? [] : lead.map { StatesPage.filling($0, ["min": minimum]) })
        return DocumentLayout(NativeDocument(
            route: page.route, title: page.title, crumbs: nil, crumbsLabel: nil, top: page.top, brand: nil,
            blocks: blocks, digest: "", spoken: "", drawn: ""
        ))
    }
}

/// The Insights page's figures, as the web derived them (`insightsModel` in `$lib/insights`) and
/// handed them over with the route. The screen draws them and works none of them out.
struct InsightsData: Decodable, Equatable {
    struct Cell: Decodable, Equatable {
        let label: String
        let pct: Int
    }

    struct Bucket: Decodable, Equatable, Identifiable {
        let key: String
        let label: String
        /// The count as heard, and as written.
        let shown: Int
        let shownText: String
        let cells: [Cell]
        var id: String { key }
    }

    struct Geo: Decodable, Equatable, Identifiable {
        let code: String?
        let national: Bool
        let label: String
        let buckets: [Bucket]
        var id: String { code ?? "" }
    }

    struct Party: Decodable, Equatable, Identifiable {
        let id: String
        let title: String
        let geos: [Geo]
    }

    struct Proposition: Decodable, Equatable, Identifiable {
        let id: String
        let title: String
        let agree: Int
        let neutral: Int
        let disagree: Int
        let shown: Int
        let shownText: String
    }

    struct Cohort: Decodable, Equatable, Identifiable {
        let key: String
        let label: String
        let disclosure: String
        let total: String
        let published: Bool
        let parties: [Party]
        let propositions: [Proposition]
        var id: String { key }
    }

    struct Stats: Decodable, Equatable {
        let label: String
        let updated: String
        let minCell: Int
        let published: Bool
        let cohorts: [Cohort]
    }

    struct Election: Decodable, Equatable, Identifiable {
        let id: String
        let pill: String
        let label: String
        let published: Bool
        let upcoming: Bool
        let provenance: String?
        let stats: Stats?
    }

    /// The election-day windows, as epoch-millisecond `[start, end)` pairs.
    let windows: [[Double]]
    /// Closed when handed over, so no figure was read.
    let closed: Bool
    let failed: Bool
    let initial: String
    let elections: [Election]?

    struct Invalid: Error, CustomStringConvertible {
        let description: String
    }

    /// The figures the web handed over, or a refusal for figures the screen could only draw wrongly.
    static func decode(_ data: String?) throws -> InsightsData {
        guard let data else { throw Invalid(description: "no insights figures were handed over") }
        let figures = try JSONDecoder().decode(InsightsData.self, from: Data(data.utf8))
        guard figures.windows.allSatisfy({ $0.count == 2 && $0[0] < $0[1] }) else {
            throw Invalid(description: "an election-day window that is not a start before an end")
        }
        if let elections = figures.elections {
            guard !figures.closed, !figures.failed, elections.contains(where: { $0.id == figures.initial }) else {
                throw Invalid(description: "figures that open on no election they offer")
            }
            let shares = elections.flatMap { $0.stats?.cohorts ?? [] }.flatMap { cohort in
                cohort.parties.flatMap { $0.geos.flatMap { $0.buckets.flatMap { $0.cells.map(\.pct) } } }
                    + cohort.propositions.flatMap { [$0.agree, $0.neutral, $0.disagree] }
            }
            guard shares.allSatisfy({ (0...100).contains($0) }) else {
                throw Invalid(description: "a share outside 0 to 100 per cent")
            }
        } else if !figures.closed && !figures.failed {
            throw Invalid(description: "no figures, and no reason given for none")
        }
        return figures
    }

    /// Whether the election-day close holds at a moment.
    func isClosed(at date: Date) -> Bool {
        let now = date.timeIntervalSince1970 * 1000
        return windows.contains { now >= $0[0] && now < $0[1] }
    }
}
