import Foundation

/// The review screen's wording, from the web's `states/review` page (ADR 0019 D4b): every piece the
/// screen shows or speaks, and the short label each answer is read back by.
///
/// Nothing here is written natively. A page that drops a piece, marks other values in one, or names
/// no answers is refused, and the review is declined for the WebView's.
struct ReviewWording: Equatable {
    /// The pieces the screen uses, by the name the page gives each section (`review-<name>`), with
    /// the values each is filled with.
    enum Piece: String, CaseIterable {
        case title, back, progress, all, some, loading, failed, retry, unanswered, star, glyph
        case compare, edit, empty, importance, multiplier

        var values: Set<String> {
            switch self {
            case .all: return ["total"]
            case .some: return ["recorded", "total"]
            case .failed: return ["retry"]
            case .star: return ["question"]
            default: return []
            }
        }
    }

    typealias Part = StatesPage.Part

    /// Each answer's short label, by the points it records.
    let answers: [Int: String]
    private let skipped: String
    private let pieces: [Piece: [Part]]

    init(_ page: NativeDocument) throws {
        let states = StatesPage(page)
        var pieces: [Piece: [Part]] = [:]
        for piece in Piece.allCases {
            pieces[piece] = try states.parts("review-\(piece.rawValue)", values: piece.values)
        }

        var answers: [Int: String] = [:]
        for pair in try states.pairs("review-answers") {
            guard let points = Int(pair.term), answers[points] == nil else {
                throw states.missing("answers named once each by their points")
            }
            answers[points] = pair.detail
        }
        // A skip is the reading of any value the scale does not define, so it must be named.
        guard let skipped = answers[0] else { throw states.missing("label for a skip") }

        self.answers = answers
        self.skipped = skipped
        self.pieces = pieces
    }

    /// A piece of the wording, with its values filled.
    func text(_ piece: Piece, _ values: [String: String] = [:]) -> String {
        StatesPage.fill(pieces[piece] ?? [], values)
    }

    /// The heading, which reports completeness rather than implying it, by the web's rule.
    func headline(answered: Int, total: Int) -> String {
        answered == total
            ? text(.all, ["total": String(total)])
            : text(.some, ["recorded": String(answered), "total": String(total)])
    }

    /// The load failure, with its retry in place.
    var failed: String { text(.failed, ["retry": text(.retry)]) }

    /// How an answer is read back: its short label, or the unanswered piece when there is none.
    ///
    /// A value the page names no label for reads as a skip — never an opinion the voter did not
    /// express.
    func label(points: Int?) -> String {
        guard let points else { return text(.unanswered) }
        return answers[points] ?? skipped
    }
}
