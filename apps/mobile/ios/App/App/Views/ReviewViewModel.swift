import Combine
import Foundation

/// The review screen's state.
///
/// Every answer, in question order, with the one lever the screen owns: the ×10 importance star.
/// Kept out of the view for the same reason as ``QuizViewModel`` — the rules here decide what the
/// engine is given, and `apps/mobile/ios/Parity/QuizLogic.swift` exercises them.
@MainActor
final class ReviewViewModel: ObservableObject {
    enum Phase: Equatable {
        case loading
        case ready([Row])
        case failed(Failure)
    }

    /// Why there is nothing to review.
    enum Failure: Equatable {
        /// The questions could not be loaded.
        case unloaded
        /// The election has no questions to show.
        case empty
    }

    /// One question and the answer recorded for it.
    struct Row: Equatable, Identifiable {
        let id: Int
        let position: Int
        let text: String
        /// nil when the question has not been answered at all.
        let points: Int?
        let important: Bool

        /// Whether this answer may carry the ×10 star. The rule is the scoring model's, not the
        /// screen's, so it comes from ``AnswerScale``.
        var allowsImportance: Bool {
            points.map(AnswerScale.allowsImportance) ?? false
        }
    }

    @Published private(set) var phase: Phase = .loading

    private let loadQuestions: () throws -> QuestionSet
    private let persist: (QuizState.Persisted) throws -> Void
    private let restore: () -> QuizState.Persisted?

    private var questions: QuestionSet?
    private var answers: [String: QuizState.StoredAnswer] = [:]
    private var ballotState: String?
    private var ballotElectorate: String?
    private var storedQuestionIDs: [Int] = []

    init(
        loadQuestions: @escaping () throws -> QuestionSet,
        persist: @escaping (QuizState.Persisted) throws -> Void,
        restore: @escaping () -> QuizState.Persisted?
    ) {
        self.loadQuestions = loadQuestions
        self.persist = persist
        self.restore = restore
        // Read before the questions load, so the heading counts from the record as the web's does.
        restoreRecord(restore())
    }

    /// Wires the real engine, dataset and store for one election.
    static func live(electionID: String, engine: JSCEngine) -> ReviewViewModel {
        ReviewViewModel(
            loadQuestions: { try QuestionLoader.load(electionID: electionID, engine: engine) },
            persist: { try QuizState.record($0, electionID: electionID) },
            restore: { QuizState.current(electionID: electionID) }
        )
    }

    /// The questions counted: the loaded set's, or the record's until it loads, as on the web.
    private var questionIDs: [Int] {
        questions?.active.map(\.id) ?? storedQuestionIDs
    }

    /// Only the answers to the questions counted, as on the web: an answer left from a question
    /// since withdrawn is not counted.
    var answered: Int {
        questionIDs.filter { answers[String($0)] != nil }.count
    }

    var total: Int {
        questionIDs.count
    }

    private var rows: [Row] {
        if case let .ready(rows) = phase { return rows }
        return []
    }

    func load() async {
        phase = .loading
        do {
            restoreRecord(restore())
            let set = try loadQuestions()
            questions = set

            guard !set.active.isEmpty else {
                phase = .failed(.empty)
                return
            }
            phase = .ready(build(from: set))
        } catch {
            phase = .failed(.unloaded)
        }
    }

    /// Toggles the ×10 star.
    ///
    /// A no-op unless the recorded answer is an extreme, matching the scoring model, where
    /// importance weights only the two ends of the scale. Enforced here as well as in the view: a
    /// star the screen never draws is still a star a keyboard or Voice Control could reach.
    func toggleImportance(questionID: Int) {
        let key = String(questionID)
        guard let answer = answers[key], AnswerScale.allowsImportance(answer.points) else { return }
        answers[key] = QuizState.StoredAnswer(points: answer.points, important: !answer.important)
        save()
        if let questions { phase = .ready(build(from: questions)) }
    }

    /// Records where the voter wants to change an answer, so the quiz opens on that question.
    ///
    /// The cursor is part of the persisted record, which the quiz screen reads when it opens, so
    /// this is how "edit question 7" survives the trip through the web router.
    func prepareEdit(position: Int) {
        guard let questions, questions.question(at: position) != nil else { return }
        save(cursor: position)
    }

    private func restoreRecord(_ stored: QuizState.Persisted?) {
        answers = stored?.answers ?? [:]
        ballotState = stored?.state
        ballotElectorate = stored?.electorate
        storedQuestionIDs = stored?.questionIds ?? []
    }

    private func build(from set: QuestionSet) -> [Row] {
        set.active.enumerated().map { index, question in
            let answer = answers[String(question.id)]
            return Row(
                id: question.id,
                position: index,
                text: question.text,
                points: answer?.points,
                important: answer?.important ?? false
            )
        }
    }

    private func save(cursor: Int? = nil) {
        guard let questions else { return }
        try? persist(
            QuizState.Persisted(
                state: ballotState,
                electorate: ballotElectorate,
                answers: answers,
                cursor: cursor ?? restore()?.cursor ?? 0,
                questionIds: questions.active.map(\.id),
                // Stamped by `QuizState.save`, which owns the clock so every writer agrees on it.
                updatedAt: 0
            )
        )
    }
}
