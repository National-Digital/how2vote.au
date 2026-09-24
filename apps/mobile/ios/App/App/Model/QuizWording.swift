import Foundation

/// The quiz's wording, from the web's `states/quiz` page (ADR 0019 D4b): every piece the screen
/// shows or speaks, the answer spoken for each answer, and the answer scale with the points each
/// answer records.
///
/// Nothing here is written natively. A page that drops a piece, marks other values in one, or
/// changes the scale's points is refused, and the quiz is declined for the WebView's.
struct QuizWording: Equatable {
    /// The pieces the screen uses, by the name the page gives each section (`quiz-<name>`), with
    /// the values each is filled with.
    enum Piece: String, CaseIterable {
        case position, previous, backToAnswers, pause, progress, loading, failed, retry
        case voted, source, ask, answered, updated

        var values: Set<String> {
            switch self {
            case .position: return ["n", "total"]
            case .failed: return ["retry"]
            case .answered: return ["answer", "n", "total"]
            case .updated: return ["answer"]
            default: return []
            }
        }
    }

    /// One answer as the page offers it.
    struct Answer: Equatable {
        /// What it records: `0` is a skip, scored as No Answer.
        let points: Int
        let label: String
        let sub: String?
        var isSkip: Bool { points == 0 }
    }

    typealias Part = StatesPage.Part

    let answers: [Answer]
    /// The answer group's accessible name, as the page names the group.
    let answersLabel: String
    private let pieces: [Piece: [Part]]
    private let spoken: [Int: String]

    init(_ page: NativeDocument) throws {
        let states = StatesPage(page)
        var answers: (label: String, controls: [NativeDocument.Control])?
        func walk(_ blocks: [NativeDocument.Block]) {
            for block in blocks {
                switch block {
                case .section(.template, _, _): break
                case let .section(_, _, content): walk(content)
                case let .slot(.quizAnswer, label?, controls): answers = (label, controls)
                default: break
                }
            }
        }
        walk(page.blocks)

        var pieces: [Piece: [Part]] = [:]
        for piece in Piece.allCases {
            pieces[piece] = try states.parts("quiz-\(piece.rawValue)", values: piece.values)
        }
        var spoken: [Int: String] = [:]
        for points in 0...5 {
            let found = try states.parts("quiz-spoken-\(points)", values: [])
            guard case let .text(text)? = found.first, found.count == 1 else {
                throw states.missing("answer spoken for \(points)")
            }
            spoken[points] = text
        }

        guard let answers else { throw states.missing("answer scale") }
        // The points are the page's own, read from each answer's `value`: the web's binding of
        // label to points, never a native restatement of it.
        self.answers = try answers.controls.map { control in
            guard let action = control.action, let points = Int(action), (0...5).contains(points) else {
                throw states.missing("points for \(control.label)")
            }
            return Answer(points: points, label: control.text(), sub: control.sub)
        }
        answersLabel = answers.label
        self.pieces = pieces
        self.spoken = spoken
    }

    /// A piece of the wording, with its values filled. A piece's values are checked when the page is
    /// read, so every value it names is one of those given.
    func text(_ piece: Piece, _ values: [String: String] = [:]) -> String {
        StatesPage.fill(pieces[piece] ?? [], values)
    }

    func position(_ n: Int, of total: Int) -> String {
        text(.position, ["n": String(n), "total": String(total)])
    }

    /// The load failure, with its retry in place.
    var failed: String { text(.failed, ["retry": text(.retry)]) }

    /// An answer as the quiz announces it.
    func spoken(_ points: Int) -> String { spoken[points] ?? spoken[0] ?? "" }
}
