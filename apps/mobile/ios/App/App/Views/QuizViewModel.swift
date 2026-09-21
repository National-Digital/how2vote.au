import Combine
import Foundation

/// The quiz screen's state, and the only place the screen touches the engine or storage.
///
/// Kept out of the view so the rules that matter are reachable without a UI: which question is
/// current, what a recorded answer does to the persisted record, and what happens when the store
/// refuses a write. Every dependency is injected for the same reason.
///
/// It is not yet covered by tests — the project has no XCTest target (ADR 0018 deferred one until
/// native UI made it worth its keep, which this screen is the start of). Stated rather than implied,
/// because "extracted from the view" reads as "tested" and here it is only "testable".
@MainActor
final class QuizViewModel: ObservableObject {
    enum Phase: Equatable {
        case loading
        case ready(Question)
        case failed(String)
    }

    @Published private(set) var phase: Phase = .loading
    @Published private(set) var cursor = 0
    @Published private(set) var isAdvancing = false

    /// Set when the screen was reached from the review screen to change one answer; the quiz then
    /// returns there instead of advancing.
    let isEditing: Bool

    private let provenanceStatement: String?
    private let loadQuestions: () throws -> QuestionSet
    /// Injected so a failing store is exercisable, and so the view model never assumes a write
    /// succeeded — `QuizState.save` refuses before the 18+ declaration, by design.
    private let persist: (QuizState.Persisted) throws -> Void
    /// Injected alongside `persist`, so restoring progress does not reach `UserDefaults` directly.
    private let restore: () -> QuizState.Persisted?

    private var questions: QuestionSet?
    private var answers: [String: QuizState.StoredAnswer] = [:]
    private var ballotState: String?
    private var ballotElectorate: String?

    init(
        isEditing: Bool = false,
        provenanceStatement: String? = nil,
        loadQuestions: @escaping () throws -> QuestionSet,
        persist: @escaping (QuizState.Persisted) throws -> Void,
        restore: @escaping () -> QuizState.Persisted?
    ) {
        self.isEditing = isEditing
        self.provenanceStatement = provenanceStatement
        self.loadQuestions = loadQuestions
        self.persist = persist
        self.restore = restore
    }

    /// Wires the real engine, dataset and store for one election.
    ///
    /// The dependencies above stay injectable; this is the one place that names the concrete ones, so
    /// a change to how state is reached is a change to one function rather than to a call site.
    static func live(electionID: String, engine: JSCEngine, isEditing: Bool = false) -> QuizViewModel {
        QuizViewModel(
            isEditing: isEditing,
            provenanceStatement: ManifestLoader.load(electionID: electionID)?.provenance?.statement,
            loadQuestions: { try QuestionLoader.load(electionID: electionID, engine: engine) },
            persist: { try QuizState.save($0, electionID: electionID) },
            restore: { QuizState.load(electionID: electionID) }
        )
    }

    var total: Int { questions?.total ?? 0 }

    var provenance: String? { provenanceStatement }

    /// The header's position label. Reads as 1-based, as the web's does.
    var positionLabel: String {
        total > 0 ? "Question \(cursor + 1) of \(total)" : "Quiz"
    }

    /// The current question's recorded points, or `nil` when it is unanswered.
    var currentPoints: Int? {
        guard case let .ready(question) = phase else { return nil }
        return answers[String(question.id)]?.points
    }

    /// The parliamentary-votes source for a question, on They Vote For You.
    func sourceURL(for question: Question) -> URL {
        // The id is an integer from the compiled dataset, so it cannot carry a path or a query.
        URL(string: "https://theyvoteforyou.org.au/policies/\(question.id)")
            ?? URL(string: "https://theyvoteforyou.org.au")!
    }

    /// Loads the question set and restores any saved progress.
    func load() async {
        phase = .loading
        do {
            let set = try loadQuestions()
            questions = set

            let stored = restore()
            answers = stored?.answers ?? [:]
            ballotState = stored?.state
            ballotElectorate = stored?.electorate
            // A stored cursor can be past the end after a dataset update withdrew questions, which
            // would otherwise leave the screen permanently on "Loading question…".
            cursor = min(max(0, stored?.cursor ?? 0), max(0, set.total - 1))

            guard let question = set.question(at: cursor) else {
                phase = .failed("There are no questions to show for this election.")
                return
            }
            phase = .ready(question)
        } catch {
            phase = .failed("Couldn't load this election's questions.")
        }
    }

    /// Records an answer to the current question and saves progress.
    ///
    /// A refused write does not lose the answer: the in-memory record still advances the quiz, so a
    /// voter is never blocked by storage. What they lose is resume, which is the right way round.
    func record(_ points: Int) {
        guard case let .ready(question) = phase, let questions else { return }

        let existing = answers[String(question.id)]
        answers[String(question.id)] = QuizState.StoredAnswer(
            points: points,
            // Importance is set on the review screen by starring an issue, never here, so an
            // existing star survives a changed answer.
            important: existing?.important ?? false
        )

        try? persist(
            QuizState.Persisted(
                state: ballotState,
                electorate: ballotElectorate,
                answers: answers,
                cursor: cursor,
                questionIds: questions.active.map(\.id),
                // Stamped by `QuizState.save`, which owns the clock so every writer agrees on it.
                updatedAt: 0
            )
        )
    }

    /// Moves to the next question after a confirmation beat, or leaves the quiz when there is none.
    func advance(after delay: TimeInterval, onExit: @escaping (QuizExit) -> Void) {
        isAdvancing = true
        Task { [weak self] in
            if delay > 0 {
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }
            guard let self else { return }
            self.isAdvancing = false
            if self.isEditing || self.cursor >= self.total - 1 {
                onExit(.review)
                return
            }
            self.setCursor(self.cursor + 1)
        }
    }

    /// Steps back one question, or reports where to go when there is no question to step back to.
    func stepBack() -> QuizExit? {
        if isEditing { return .review }
        if cursor == 0 { return .ballot }
        setCursor(cursor - 1)
        return nil
    }

    private func setCursor(_ index: Int) {
        guard let questions, let question = questions.question(at: index) else { return }
        cursor = index
        phase = .ready(question)
        // The cursor is part of the record: resume has to land on the question the voter left on,
        // not on the last one they answered.
        try? persist(
            QuizState.Persisted(
                state: ballotState,
                electorate: ballotElectorate,
                answers: answers,
                cursor: index,
                questionIds: questions.active.map(\.id),
                updatedAt: 0
            )
        )
    }
}
