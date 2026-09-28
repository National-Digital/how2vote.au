import Foundation

/// What the native landing needs to choose among the web's wording: the election's stage, as the
/// shared engine judges it, and how far the voter has got.
///
/// It holds no copy. The words are the prerendered landing's and the states page's; this decides
/// which of them apply (`LandingComposition`).
@MainActor
struct LandingViewModel {
    struct Election: Decodable, Equatable {
        let id: String
        let phase: String
    }

    let electionID: String
    /// The election's stage — "upcoming", "live" or "archived" — or nil when the engine does not
    /// know the election, in which case the landing keeps the stage it was prerendered at.
    let phase: String?
    let progress: LandingComposition.Progress

    static func live(electionID: String, engine: JSCEngine) -> LandingViewModel {
        let manifest = ManifestLoader.load(electionID: electionID)
        // The stage is a date judgement over the AEC timetable, so it is the engine's, never a
        // second reading here: the two would disagree on precisely the days it matters.
        let elections = (try? engine.elections())
            .flatMap { try? JSONDecoder().decode([Election].self, from: Data($0.utf8)) } ?? []
        return LandingViewModel(
            electionID: electionID,
            phase: elections.first { $0.id == electionID }?.phase,
            progress: progress(
                stored: QuizState.current(electionID: electionID),
                questionCount: manifest?.counts["questions"] ?? 0
            )
        )
    }

    /// A voter with a ballot and some answers is part-way or finished; anyone else is on a first visit.
    static func progress(stored: QuizState.Persisted?, questionCount: Int) -> LandingComposition.Progress {
        guard let stored, stored.state != nil, stored.electorate != nil else { return .fresh }
        // As the web counts: only answers to the recorded questions, once they are known.
        let answered = stored.questionIds.isEmpty
            ? stored.answers.count
            : stored.questionIds.filter { stored.answers[String($0)] != nil }.count
        guard answered > 0 else { return .fresh }
        let total = stored.questionIds.isEmpty ? questionCount : stored.questionIds.count
        return answered >= total && total > 0 ? .complete : .partway(next: answered + 1, total: total)
    }
}
