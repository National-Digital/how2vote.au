import Foundation

/// The comparison card's wording, from the web's `states/card` page (ADR 0019 D4b): every piece the
/// card shows or speaks, and each of its paragraphs that carry emphasis or links, as the page renders
/// them. What the card computes — its figures, its rows and the labels made from them — is handed
/// over with the route instead (`CardData`).
///
/// Nothing here is written natively. A page that drops a piece or a paragraph, or marks other values
/// in one, is refused, and the route is declined for the WebView's.
struct CardWording {
    /// The pieces the screen uses, by the name the page gives each section, with the values each is
    /// filled with.
    enum Piece: String, CaseIterable {
        case archivedLinkKicker, archivedLinkTitle, archivedLinkOld, archivedLinkNow, archivedLinkAction
        case errorTitle, errorNote, errorAction, unavailableTitle, unavailableNote, unavailableAction
        case home, shared, plansClosed, share, shareWarning, shareWarningTitle, copyLink, cancel
        case save, savedOn, whyShow, whyHide, record, changeAnswers, makeOwn
        case senateMethod, above, below, senateOneMethod, backToCompare
        case preferenceFor, higher, lower, bandLabel, bandMarker, bandAuthorisation, qualifier
        case panelEmpty, termsAccept, termsCancel, termsLabel, termsGroup, close

        /// The section the page renders the piece in.
        var id: String {
            switch self {
            case .panelEmpty: return "panel-empty"
            case .termsAccept: return "terms-accept"
            case .termsCancel: return "terms-cancel"
            case .termsLabel: return "terms-label"
            case .termsGroup: return "terms-group"
            case .close: return "dialog-close"
            default: return "card-\(rawValue)"
            }
        }

        var values: Set<String> {
            switch self {
            case .preferenceFor, .higher, .lower: return ["name"]
            case .close: return ["title"]
            default: return []
            }
        }
    }

    /// The paragraphs that carry emphasis or links, by the section the page renders each in, with the
    /// values each marks.
    enum Paragraph: CaseIterable, Hashable {
        case archive, correction, hint(parliament: Bool), vintage(archived: Bool, withdrawn: Withdrawn)
        case advocacy(parliament: Bool), shareWarning, saveNote(saved: Bool), whyNote
        case panelLabel(ballotOrdered: Bool), termsIntro, ack(archived: Bool), foot(archived: Bool)

        enum Withdrawn: String, CaseIterable { case none, one, many }

        static var allCases: [Paragraph] {
            [.archive, .correction, .shareWarning, .whyNote, .termsIntro]
                + [false, true].flatMap { flag in
                    [.hint(parliament: flag), .advocacy(parliament: flag), .saveNote(saved: flag),
                     .panelLabel(ballotOrdered: flag), .ack(archived: flag), .foot(archived: flag)]
                        + Withdrawn.allCases.map { .vintage(archived: flag, withdrawn: $0) }
                }
        }

        var id: String {
            switch self {
            case .archive: return "card-archive"
            case .correction: return "card-correction"
            case let .hint(parliament): return parliament ? "card-hint-parliament" : "card-hint-ballot"
            case let .vintage(archived, withdrawn):
                return "card-vintage-\(archived ? "archived" : "live")-\(withdrawn.rawValue)"
            case let .advocacy(parliament): return parliament ? "card-advocacy-parliament" : "card-advocacy-ballot"
            case .shareWarning: return "card-share-warning"
            case let .saveNote(saved): return saved ? "card-save-saved" : "card-save-unsaved"
            case .whyNote: return "card-why-note"
            case let .panelLabel(ballotOrdered): return ballotOrdered ? "panel-label-ballot" : "panel-label-registration"
            case .termsIntro: return "terms-intro"
            case let .ack(archived): return archived ? "card-ack-archived" : "card-ack-live"
            case let .foot(archived): return archived ? "card-foot-archived" : "card-foot-live"
            }
        }

        /// The values the paragraph marks, as the page marks them.
        var values: Set<String> {
            switch self {
            case .archive: return ["label", "year"]
            case let .vintage(archived, withdrawn):
                switch (archived, withdrawn == .many) {
                case (true, true): return ["vintage", "year", "n"]
                case (true, false): return ["vintage", "year"]
                case (false, true): return ["vintage", "n"]
                case (false, false): return ["vintage"]
                }
            case let .advocacy(parliament): return parliament ? ["age"] : ["age", "electorate"]
            case let .ack(archived): return archived ? ["year"] : []
            case .foot: return ["built", "label", "data", "version", "attribution"]
            default: return []
            }
        }
    }

    typealias Part = StatesPage.Part

    private let pieces: [Piece: [Part]]
    private let paragraphs: [Paragraph: [NativeDocument.Block]]
    private let page: NativeDocument
    /// The age the under-18 note names, as the page gives it.
    let age: String

    init(_ page: NativeDocument) throws {
        let states = StatesPage(page)
        var pieces: [Piece: [Part]] = [:]
        for piece in Piece.allCases {
            pieces[piece] = try states.parts(piece.id, values: piece.values)
        }
        var paragraphs: [Paragraph: [NativeDocument.Block]] = [:]
        for paragraph in Paragraph.allCases {
            guard let blocks = states.sections[paragraph.id],
                  Set(StatesPage.marked(in: blocks).map(\.name)) == paragraph.values
            else {
                throw states.missing("\(paragraph.id) marking \(paragraph.values.sorted())")
            }
            paragraphs[paragraph] = blocks
        }
        let ages = StatesPage.marked(in: paragraphs[.advocacy(parliament: true)] ?? []).filter { $0.name == "age" }
        guard !ages.isEmpty, Set(ages.map(\.sample)).count == 1, let age = ages.first?.sample else {
            throw states.missing("an under-18 note naming one age")
        }
        // The only pages the card's paragraphs open over it are the ones the page opens as dialogs.
        let links = Set(paragraphs.values.flatMap { StatesPage.links(in: $0) }.filter { $0.hasPrefix("/") })
        guard links.isSubset(of: ["/corrections", "/terms", "/saved"]) else {
            throw states.missing("paragraphs linking only the corrections, the terms and the saved cards")
        }

        self.pieces = pieces
        self.paragraphs = paragraphs
        self.page = page
        self.age = age
    }

    /// A piece of the wording, with its values filled.
    func text(_ piece: Piece, _ values: [String: String] = [:]) -> String {
        StatesPage.fill(pieces[piece] ?? [], values)
    }

    /// A paragraph, with its values filled, laid out as the page draws it.
    func layout(_ paragraph: Paragraph, _ values: [String: String] = [:]) -> DocumentLayout {
        let blocks = (paragraphs[paragraph] ?? []).map { StatesPage.filling($0, values) }
        return DocumentLayout(NativeDocument(
            route: page.route, title: "", crumbs: nil, crumbsLabel: nil, top: nil, brand: nil,
            blocks: blocks, digest: "", spoken: "", drawn: ""
        ))
    }
}

/// The card as the web hands it over (`nativeCard` in `$lib/card-flow`): what the page would show,
/// with every label the page computes already filled. The screen draws it; every rule is the web's.
enum CardData: Decodable, Equatable {
    case error, unavailable, archivedLink
    case ready(Ready)

    struct Ready: Decodable, Equatable {
        let stage: Stage
        let stageLabel: String
        let heading: String
        let stateSuffix: String
        let shared: Bool
        let canVote: Bool
        let archived: Bool
        let electorateLess: Bool
        let correction: Bool
        let electorate: String
        let label: String
        let year: String
        let vintage: String
        let withdrawn: Int
        let panels: [Panel]
        let plansEnabled: Bool
        let build: String
        let saveable: Bool
        let saved: Bool
        let terms: Terms
        let shareWarning: Bool
        let why: Bool
        let evidence: [Evidence]
        let plan: Plan?
    }

    enum Stage: String, Decodable { case compare, build }

    struct Terms: Decodable, Equatable {
        let shown: Bool
        let ticked: Bool
    }

    struct Panel: Decodable, Equatable {
        let title: String
        let subtitle: String
        let caption: String
        let ballotOrdered: Bool
        let blocks: [Block]
    }

    enum Block: Decodable, Equatable {
        case single(Row)
        case group(label: String, note: String, rows: [Row])

        private enum Keys: String, CodingKey { case kind, row, label, note, rows }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            switch try c.decode(String.self, forKey: .kind) {
            case "single": self = .single(try c.decode(Row.self, forKey: .row))
            case "group":
                self = .group(
                    label: try c.decode(String.self, forKey: .label),
                    note: try c.decode(String.self, forKey: .note),
                    rows: try c.decode([Row].self, forKey: .rows)
                )
            default:
                throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "no such block")
            }
        }
    }

    /// A party's row, as the panel presents it: a figure only where one may be shown.
    struct Row: Decodable, Equatable {
        let name: String
        let kind: String
        let showScore: Bool
        let figure: String?
        let badge: String
        let spoken: String
    }

    struct Evidence: Decodable, Equatable, Identifiable {
        let key: String
        let summary: String
        let lines: [Line]
        var id: String { key }

        struct Line: Decodable, Equatable, Identifiable {
            let id: Int
            let question: String
            let agreement: String
            let href: String
            let label: String
        }
    }

    struct Plan: Decodable, Equatable {
        let house: House
        let senate: Senate
        let built: String
        let dataVersion: String
        let version: String
        let attribution: String

        struct House: Decodable, Equatable {
            let title: String
            let subtitle: String
            let rows: [PlanRow]
            let status: String
        }

        struct Senate: Decodable, Equatable {
            let title: String
            let subtitle: String
            let view: Line
            let above: [PlanRow]
            let aboveStatus: String
            let below: [Group]
            let belowStatus: String
        }

        struct Group: Decodable, Equatable {
            let label: String
            let rows: [PlanRow]
        }
    }

    enum Line: String, Decodable { case above, below }

    /// A row of the plan's ballot: its candidate, the name its controls are called by, and the
    /// number the voter has given it, or 0 for none.
    struct PlanRow: Decodable, Equatable, Identifiable {
        let id: String
        let candidate: String
        let party: String
        let name: String
        let pref: Int
    }

    private enum Keys: String, CodingKey { case status }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        switch try c.decode(String.self, forKey: .status) {
        case "error": self = .error
        case "unavailable": self = .unavailable
        case "archived-link": self = .archivedLink
        case "ready": self = .ready(try Ready(from: decoder))
        default:
            throw DecodingError.dataCorruptedError(forKey: .status, in: c, debugDescription: "no such status")
        }
    }

    struct Refused: Error, CustomStringConvertible {
        let description: String
    }

    /// The card the web handed over, refused where the screen could only draw it wrongly: a figure
    /// shown where the panel shows none, a plan on the comparison or none on the plan, or a way to
    /// build, share or save on a card that has none.
    static func decode(_ data: String?) throws -> CardData {
        guard let data else { throw Refused(description: "no card handed over") }
        let card = try JSONDecoder().decode(CardData.self, from: Data(data.utf8))
        guard case let .ready(ready) = card else { return card }
        let rows = ready.panels.flatMap { panel in
            panel.blocks.flatMap { block -> [Row] in
                switch block {
                case let .single(row): return [row]
                case let .group(_, _, rows): return rows
                }
            }
        }
        if rows.contains(where: { $0.showScore != ($0.figure != nil) || ($0.kind != "aligned" && $0.showScore) }) {
            throw Refused(description: "a figure where the panel shows none")
        }
        if (ready.stage == .build) != (ready.plan != nil) {
            throw Refused(description: "a plan out of its stage")
        }
        if ready.stage == .build && (ready.shared || !ready.canVote || !ready.plansEnabled) {
            throw Refused(description: "a plan on a card that may not build one")
        }
        if ready.saveable && (ready.shared || !ready.canVote) {
            throw Refused(description: "a way to save a card that may not be saved")
        }
        if ready.shareWarning && (ready.shared || !ready.canVote) {
            throw Refused(description: "a share warning on a card that may not be shared")
        }
        return card
    }
}
