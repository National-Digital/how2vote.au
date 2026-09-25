import Foundation

/// The research survey's wording, from the web's `states/survey` page (ADR 0019 D4b): its top bar,
/// every piece the gate and the questions show or speak, the collection notice for each kind of
/// election, and the Terms acceptance.
///
/// Nothing here is written natively. A page that drops a piece, or whose notice or acceptance no
/// longer marks and links what the screen fills and follows, is refused, and the survey is declined
/// for the WebView's.
struct SurveyWording: Equatable {
    /// The pieces, by the name the page gives each section (`survey-<name>`), with the values each
    /// is filled with.
    enum Piece: String, CaseIterable {
        case ready, archivedTitle, liveTitle, archivedConsent, liveConsent, sensitiveConsent
        case contribute, skipPlan, skipComparison, prefer, progress
        /// The name of the control that closes a document opened over the gate.
        case close

        var values: Set<String> {
            switch self {
            case .archivedConsent, .liveConsent: return ["age"]
            case .close: return ["title"]
            default: return []
            }
        }
    }

    typealias Part = StatesPage.Part

    private let pieces: [Piece: [Part]]
    /// The age each consent names, as the page gives it.
    private let age: String
    private let page: NativeDocument
    private let archivedNotes: [NativeDocument.Block]
    private let liveNotes: [NativeDocument.Block]
    private let termsBlocks: [NativeDocument.Block]
    /// The top bar: no label of its own, and its back button's name.
    let top: NativeDocument.TopBar

    init(_ page: NativeDocument) throws {
        let states = StatesPage(page)
        var pieces: [Piece: [Part]] = [:]
        for piece in Piece.allCases {
            pieces[piece] = try states.parts("survey-\(piece.rawValue)", values: piece.values)
        }
        guard let top = page.top, top.back != nil else { throw states.missing("top bar with a way back") }
        let ages = ["survey-archivedConsent", "survey-liveConsent"].flatMap { StatesPage.marked(in: states.sections[$0] ?? []) }
        guard ages.count == 2, Set(ages.map(\.sample)).count == 1, let age = ages.first?.sample else {
            throw states.missing("consents naming one age")
        }
        // A past election's notice names its year where the page does; any other names none. Each
        // links the privacy policy, and the acceptance the terms, which the screen opens over the gate.
        guard let archived = states.sections["survey-notes-archived"],
              StatesPage.marked(in: archived).map(\.name) == ["year", "year"],
              StatesPage.links(in: archived) == ["/privacy"],
              let live = states.sections["survey-notes-live"],
              StatesPage.marked(in: live).isEmpty,
              StatesPage.links(in: live) == ["/privacy"],
              let terms = states.sections["survey-terms"],
              StatesPage.marked(in: terms).isEmpty,
              StatesPage.links(in: terms) == ["/terms"]
        else {
            throw states.missing("collection notice and Terms acceptance as the screen draws them")
        }

        self.pieces = pieces
        self.age = age
        self.page = page
        self.top = top
        archivedNotes = archived
        liveNotes = live
        termsBlocks = terms
    }

    /// A piece of the wording, with its values filled; a consent with the page's own age.
    func text(_ piece: Piece) -> String {
        StatesPage.fill(pieces[piece] ?? [], ["age": age])
    }

    /// The name of the control that closes a document opened over the gate, for that document.
    func close(_ title: String) -> String {
        StatesPage.fill(pieces[.close] ?? [], ["title": title])
    }

    /// The collection notice for the election compared, laid out as the page draws it.
    func notes(archived: Bool, year: String) -> DocumentLayout {
        layout(archived ? archivedNotes.map { StatesPage.filling($0, ["year": year]) } : liveNotes)
    }

    /// The Terms acceptance, laid out as the page draws it, and as it is read aloud.
    var terms: (layout: DocumentLayout, spoken: String) {
        (layout(termsBlocks), StatesPage.plain(termsBlocks))
    }

    private func layout(_ blocks: [NativeDocument.Block]) -> DocumentLayout {
        DocumentLayout(NativeDocument(
            route: page.route, title: "", crumbs: nil, crumbsLabel: nil, top: nil, brand: nil,
            blocks: blocks, digest: "", spoken: "", drawn: ""
        ))
    }
}

/// The survey's step as the web hands it over (`nativeStep` in `$lib/survey-flow`): the gate and its
/// ticks, or the question shown and its place. The screen draws it; every rule is the web's.
enum SurveyStep: Decodable, Equatable {
    struct Gate: Decodable, Equatable {
        /// What a step back from the gate names, as the web names it.
        let key: String
        let archived: Bool
        let year: String
        let inFlight: Bool
        let consented: Bool
        let sensitive: Bool
        let termsNeeded: Bool
        let terms: Bool
        let canContribute: Bool
    }

    struct Question: Decodable, Equatable {
        /// The question's key, which an answer to it names.
        let key: String
        let label: String
        let note: String
        let options: [String]
        let position: Int
        let total: Int
    }

    case gate(Gate)
    case question(Question)

    /// The step's key, which a request made from it names, so the web refuses one made from a step
    /// it has already moved past.
    var key: String {
        switch self {
        case let .gate(gate): return gate.key
        case let .question(question): return question.key
        }
    }

    /// An answer to a question as the web reads it: the question it answers, and the answer, empty
    /// for none.
    static func answer(_ question: Question, _ option: String) -> String {
        let object = ["key": question.key, "answer": option]
        let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }

    private enum Kind: String, Decodable {
        case gate, question
    }

    private enum Keys: String, CodingKey {
        case step
    }

    init(from decoder: Decoder) throws {
        switch try decoder.container(keyedBy: Keys.self).decode(Kind.self, forKey: .step) {
        case .gate: self = .gate(try Gate(from: decoder))
        case .question: self = .question(try Question(from: decoder))
        }
    }

    struct Invalid: Error, CustomStringConvertible {
        let description: String
    }

    /// The step the web handed over, or a refusal for one the screen could only draw wrongly.
    static func decode(_ data: String?) throws -> SurveyStep {
        guard let data else { throw Invalid(description: "no survey step was handed over") }
        let step = try JSONDecoder().decode(SurveyStep.self, from: Data(data.utf8))
        if case let .question(question) = step {
            guard !question.options.isEmpty, Set(question.options).count == question.options.count,
                  (1...max(1, question.total)).contains(question.position)
            else {
                throw Invalid(description: "a question with no answers, or out of its place")
            }
        }
        if case let .gate(gate) = step, gate.canContribute, !gate.consented {
            throw Invalid(description: "a gate that allows a contribution without consent")
        }
        return step
    }
}
