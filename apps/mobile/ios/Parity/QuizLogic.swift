import Combine
import Foundation

/// Exercises the quiz and review view models' rules without a UI.
///
/// The project has no XCTest target, and adding one means a native target, a build phase and a
/// scheme in `project.pbxproj` to carry a handful of assertions. `EngineParity` already established
/// the cheaper shape for this repository — compile the real types with `swiftc` and run them — and
/// this is the same trick applied to the view model. It compiles the SHIPPING files, so the types
/// under test are the ones the app uses, not copies.
///
/// It deliberately does not touch the views: they are iOS-only (`UIViewControllerRepresentable`,
/// `SFSafariViewController`), so a command-line harness cannot build them. That is why ``QuizExit``
/// lives in the model layer.
///
/// Build and run from the repository root:
///
///     swiftc -O apps/mobile/ios/App/App/Model/QuizExit.swift \
///            apps/mobile/ios/App/App/Model/QuestionSet.swift \
///            apps/mobile/ios/App/App/Model/AnswerScale.swift \
///            apps/mobile/ios/App/App/Model/Manifest.swift \
///            apps/mobile/ios/App/App/State/NativeState.swift \
///            apps/mobile/ios/App/App/State/QuizState.swift \
///            apps/mobile/ios/App/App/Engine/JSCEngine.swift \
///            apps/mobile/ios/App/App/Views/QuizViewModel.swift \
///            apps/mobile/ios/App/App/Views/ReviewViewModel.swift \
///            apps/mobile/ios/Parity/QuizLogic.swift -o "$TMPDIR/quiz-logic"
///     "$TMPDIR/quiz-logic"
@main
enum QuizLogic {
    // Called in sequence rather than held in a table of closures: a `static let` array of
    // `@MainActor` closures is exactly what strict concurrency checking rejects, and a harness that
    // only builds under one language mode is a harness that stops running.
    static func main() async {
        var failures: [String] = []
        var ran = 0

        for found in [
            await resumesWhereTheVoterLeft(),
            await clampsACursorPastTheEnd(),
            await keepsAStarredIssueStarred(),
            await advancesEvenWhenTheStoreRefuses(),
            await recordsTheActiveQuestionIds(),
            await leavesForTheBallotFromTheFirstQuestion(),
            await returnsToReviewWhenEditingOneAnswer(),
            await reportsNoQuestionsRatherThanHanging(),
            await refusesTheStarOnAMiddlingAnswer(),
            await starsAnExtremeAnswer(),
            await opensTheQuizOnTheQuestionBeingChanged(),
            await reportsHowManyAreAnswered(),
            await keepsTheAnswersWhenTheBallotIsSet(),
            await recordsTheSentinelWhereThereIsNoBallot(),
            await stepsBackThroughThePickerBeforeLeaving(),
        ] {
            ran += 1
            failures.append(contentsOf: found)
        }

        guard failures.isEmpty else {
            for failure in failures { print("::error::quiz logic: \(failure)") }
            exit(1)
        }
        print("quiz and review logic OK — \(ran) rules hold")
    }

    // MARK: - Fixtures

    private static func questionSet(count: Int, withdrawnID: Int? = nil) -> QuestionSet {
        var ordered = (1...max(1, count)).map { $0 }
        if let withdrawnID { ordered.append(withdrawnID) }
        return QuestionSet(
            dataVersion: "2025-03-28",
            attribution: "test",
            active: (1...max(1, count)).map {
                Question(
                    id: $0,
                    text: "Question \($0)",
                    divisionFirst: "2011-06-15",
                    divisionLast: "2024-06-26",
                    divisionCount: 24
                )
            },
            orderedIds: ordered
        )
    }

    private static func emptySet() -> QuestionSet {
        QuestionSet(dataVersion: "2025-03-28", attribution: "test", active: [], orderedIds: [])
    }

    /// A recorder standing in for the store, so what the view model WOULD have written is inspectable.
    @MainActor private final class Store {
        var written: [QuizState.Persisted] = []
        var refuses = false
        var stored: QuizState.Persisted?

        func persist(_ record: QuizState.Persisted) throws {
            if refuses { throw QuizState.QuizError.notEligible }
            written.append(record)
        }

        func restore() -> QuizState.Persisted? { stored }
    }

    @MainActor private static func model(
        set: QuestionSet,
        store: Store,
        isEditing: Bool = false
    ) -> QuizViewModel {
        QuizViewModel(
            isEditing: isEditing,
            provenanceStatement: nil,
            loadQuestions: { set },
            persist: { try store.persist($0) },
            restore: { store.restore() }
        )
    }

    private static func record(
        cursor: Int,
        answers: [String: QuizState.StoredAnswer] = [:]
    ) -> QuizState.Persisted {
        QuizState.Persisted(
            state: "ACT",
            electorate: "Bean",
            answers: answers,
            cursor: cursor,
            questionIds: [],
            updatedAt: 0
        )
    }

    // MARK: - Checks

    /// A voter who stopped on question 4 must come back to question 4, not to the start.
    @MainActor private static func resumesWhereTheVoterLeft() async -> [String] {
        let store = Store()
        store.stored = record(cursor: 3)
        let subject = model(set: questionSet(count: 10), store: store)
        await subject.load()

        guard subject.cursor == 3 else {
            return ["resume landed on question \(subject.cursor + 1), not the one the voter left on"]
        }
        return []
    }

    /// A stored cursor can outlive the questions it pointed into — a dataset update that withdrew
    /// questions leaves it past the end. Unclamped, the screen has no question and shows the loader
    /// for ever, with the voter's answers intact and unreachable.
    @MainActor private static func clampsACursorPastTheEnd() async -> [String] {
        let store = Store()
        store.stored = record(cursor: 40)
        let subject = model(set: questionSet(count: 10), store: store)
        await subject.load()

        guard subject.cursor == 9 else {
            return ["a cursor past the end resolved to \(subject.cursor), not the last question"]
        }
        guard case .ready = subject.phase else {
            return ["a cursor past the end left the screen without a question"]
        }
        return []
    }

    /// Importance is set on the review screen and is the ×10 lever in scoring. Changing an answer
    /// must not silently clear it, or a voter's most strongly held issue quietly stops counting.
    @MainActor private static func keepsAStarredIssueStarred() async -> [String] {
        let store = Store()
        store.stored = record(cursor: 0, answers: ["1": QuizState.StoredAnswer(points: 5, important: true)])
        let subject = model(set: questionSet(count: 3), store: store)
        await subject.load()
        subject.record(4)

        guard let written = store.written.last, let answer = written.answers["1"] else {
            return ["a recorded answer was not written"]
        }
        guard answer.points == 4 else { return ["the changed answer was not recorded"] }
        guard answer.important else { return ["changing an answer cleared its importance star"] }
        return []
    }

    /// `QuizState.save` refuses before the 18+ declaration, by design. A refused write must cost
    /// resume, never the answer or the quiz: a voter must not be stuck on one question because
    /// storage said no.
    @MainActor private static func advancesEvenWhenTheStoreRefuses() async -> [String] {
        let store = Store()
        store.refuses = true
        let subject = model(set: questionSet(count: 3), store: store)
        await subject.load()
        subject.record(5)

        guard subject.currentPoints == 5 else {
            return ["a refused write lost the answer the voter had just given"]
        }
        guard store.written.isEmpty else { return ["a refused write was recorded anyway"] }
        return []
    }

    /// The record names the questions the answers belong to, and it must name the PRESENTABLE set —
    /// the share ordering keeps withdrawn ids and is a different list on purpose.
    @MainActor private static func recordsTheActiveQuestionIds() async -> [String] {
        let store = Store()
        let subject = model(set: questionSet(count: 3, withdrawnID: 99), store: store)
        await subject.load()
        subject.record(3)

        guard let written = store.written.last else { return ["no record was written"] }
        guard written.questionIds == [1, 2, 3] else {
            return ["the record names \(written.questionIds), not the presentable questions"]
        }
        return []
    }

    /// Back from the first question leaves the quiz for the ballot, rather than doing nothing.
    @MainActor private static func leavesForTheBallotFromTheFirstQuestion() async -> [String] {
        let store = Store()
        let subject = model(set: questionSet(count: 3), store: store)
        await subject.load()

        guard subject.stepBack() == .ballot else {
            return ["back from the first question did not leave for the ballot"]
        }
        return []
    }

    /// Reached from the review screen to change one answer, the quiz returns there instead of
    /// walking the voter through the rest of the questionnaire again.
    @MainActor private static func returnsToReviewWhenEditingOneAnswer() async -> [String] {
        let store = Store()
        let subject = model(set: questionSet(count: 10), store: store, isEditing: true)
        await subject.load()

        guard subject.stepBack() == .review else {
            return ["editing one answer did not return to the review screen"]
        }
        return []
    }

    // MARK: - Review

    @MainActor private static func review(
        set: QuestionSet,
        store: Store
    ) -> ReviewViewModel {
        ReviewViewModel(
            loadQuestions: { set },
            persist: { try store.persist($0) },
            restore: { store.restore() }
        )
    }

    /// The ×10 lever weights only the two ends of the scale. A star on a middling answer would
    /// multiply a weight the scoring model does not, and the result would be wrong without looking
    /// wrong — so the model refuses it as well as the screen not drawing it.
    @MainActor private static func refusesTheStarOnAMiddlingAnswer() async -> [String] {
        let store = Store()
        store.stored = record(cursor: 0, answers: ["1": QuizState.StoredAnswer(points: 3, important: false)])
        let subject = review(set: questionSet(count: 3), store: store)
        await subject.load()
        subject.toggleImportance(questionID: 1)

        if let written = store.written.last, written.answers["1"]?.important == true {
            return ["a middling answer was starred — the ×10 lever applies only to the extremes"]
        }
        return []
    }

    @MainActor private static func starsAnExtremeAnswer() async -> [String] {
        let store = Store()
        store.stored = record(cursor: 0, answers: ["1": QuizState.StoredAnswer(points: 5, important: false)])
        let subject = review(set: questionSet(count: 3), store: store)
        await subject.load()
        subject.toggleImportance(questionID: 1)

        guard store.written.last?.answers["1"]?.important == true else {
            return ["starring a strongly-held answer did not record it"]
        }
        return []
    }

    /// "Change question 7" survives the trip out through the web router only because the cursor is
    /// part of the persisted record the quiz screen reads when it opens.
    @MainActor private static func opensTheQuizOnTheQuestionBeingChanged() async -> [String] {
        let store = Store()
        store.stored = record(cursor: 0)
        let subject = review(set: questionSet(count: 10), store: store)
        await subject.load()
        subject.prepareEdit(position: 6)

        guard store.written.last?.cursor == 6 else {
            return ["changing an answer did not point the quiz at that question"]
        }
        return []
    }

    /// The heading reports completeness rather than implying it.
    @MainActor private static func reportsHowManyAreAnswered() async -> [String] {
        let store = Store()
        store.stored = record(cursor: 0, answers: ["1": QuizState.StoredAnswer(points: 5, important: false)])
        let subject = review(set: questionSet(count: 3), store: store)
        await subject.load()

        guard subject.headline == "1 of 3 answered." else {
            return ["the review heading reads \(subject.headline) for one of three answers"]
        }
        return []
    }

    // MARK: - Ballot

    @MainActor private static func ballot(
        store: Store,
        isElectorateLess: Bool = false,
        electorates: [String] = ["Bean", "Canberra", "Fenner"]
    ) -> BallotViewModel {
        BallotViewModel(
            isElectorateLess: isElectorateLess,
            listElectorates: { _ in electorates },
            persistBallot: { state, electorate in
                var record = store.restore()
                    ?? QuizState.Persisted(
                        state: nil, electorate: nil, answers: [:], cursor: 0,
                        questionIds: [], updatedAt: 0
                    )
                record.state = state
                record.electorate = electorate
                try store.persist(record)
            }
        )
    }

    /// Picking a ballot must not throw away answers already given — a voter who changes their
    /// electorate mid-run would otherwise silently lose the questionnaire they had filled in.
    @MainActor private static func keepsTheAnswersWhenTheBallotIsSet() async -> [String] {
        let store = Store()
        store.stored = record(cursor: 4, answers: ["1": QuizState.StoredAnswer(points: 5, important: true)])
        let subject = ballot(store: store)

        subject.pick(state: "ACT")
        subject.pick(electorate: "Bean")
        guard subject.confirm() == "/quiz" else { return ["confirming a ballot did not open the quiz"] }

        guard let written = store.written.last else { return ["no ballot was recorded"] }
        guard written.state == "ACT", written.electorate == "Bean" else {
            return ["the ballot recorded was \(written.state ?? "nil")/\(written.electorate ?? "nil")"]
        }
        guard written.answers["1"]?.important == true, written.cursor == 4 else {
            return ["setting a ballot discarded answers already given"]
        }
        return []
    }

    /// A provisional election ships no electorates, so there is nothing to pick — but the quiz
    /// still refuses to run without a ballot recorded, so the sentinel has to be written.
    @MainActor private static func recordsTheSentinelWhereThereIsNoBallot() async -> [String] {
        let store = Store()
        let subject = ballot(store: store, isElectorateLess: true)

        guard subject.skipToQuestions() == "/quiz" else {
            return ["an election with no electorates did not go on to the questions"]
        }
        guard store.written.last?.electorate == BallotViewModel.nationalBallot.electorate else {
            return ["the sentinel national ballot was not recorded, so the quiz would bounce back"]
        }
        return []
    }

    /// Back walks the picker's own steps before it leaves the screen.
    @MainActor private static func stepsBackThroughThePickerBeforeLeaving() async -> [String] {
        let store = Store()
        let subject = ballot(store: store)
        subject.pick(state: "ACT")
        subject.pick(electorate: "Bean")

        if subject.back() != nil { return ["back from the confirmation left the screen"] }
        if subject.step != .electorate { return ["back from the confirmation did not return to the list"] }
        if subject.back() != nil { return ["back from the list left the screen"] }
        if subject.step != .state { return ["back from the list did not return to the state picker"] }
        guard subject.back() == "/" else { return ["back from the first step did not leave for home"] }
        return []
    }

    /// An election with no presentable questions must say so, not sit on the loader.
    @MainActor private static func reportsNoQuestionsRatherThanHanging() async -> [String] {
        let store = Store()
        let subject = model(set: emptySet(), store: store)
        await subject.load()

        guard case .failed = subject.phase else {
            return ["an election with no questions left the screen loading"]
        }
        return []
    }
}
