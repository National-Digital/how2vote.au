import Combine
import Foundation

/// The landing screen's state: which election, what it is, and where the voter left off.
@MainActor
final class LandingViewModel: ObservableObject {
    /// One election, as the toggle offers it.
    struct Election: Decodable, Equatable, Identifiable {
        let id: String
        let year: Int
        let label: String
        let shortLabel: String
        let current: Bool
        /// `upcoming`, `live` or `archived`, judged by the engine against the AEC timetable.
        let phase: String
    }

    /// Where the voter is in a run they have already started.
    enum Progress: Equatable {
        case fresh
        case partway(answered: Int, total: Int)
        case complete
    }

    @Published private(set) var elections: [Election] = []
    @Published private(set) var progress: Progress = .fresh

    let electionID: String

    private let loadElections: () throws -> [Election]
    private let questionCount: Int
    private let electorateCount: Int
    private let restore: () -> QuizState.Persisted?

    init(
        electionID: String,
        questionCount: Int,
        electorateCount: Int,
        loadElections: @escaping () throws -> [Election],
        restore: @escaping () -> QuizState.Persisted?
    ) {
        self.electionID = electionID
        self.questionCount = questionCount
        self.electorateCount = electorateCount
        self.loadElections = loadElections
        self.restore = restore
    }

    static func live(electionID: String, engine: JSCEngine) -> LandingViewModel {
        let manifest = ManifestLoader.load(electionID: electionID)
        return LandingViewModel(
            electionID: electionID,
            questionCount: manifest?.counts["questions"] ?? 0,
            electorateCount: manifest?.counts["electorates"] ?? 0,
            loadElections: {
                let payload = try engine.elections()
                return try JSONDecoder().decode([Election].self, from: Data(payload.utf8))
            },
            restore: { QuizState.load(electionID: electionID) }
        )
    }

    var election: Election? {
        elections.first { $0.id == electionID }
    }

    /// A provisional comparison: an election that has not been announced, so there is no ballot,
    /// no candidates and no printable plan.
    var isUpcoming: Bool {
        election?.phase == "upcoming"
    }

    /// A historical demonstration — the election has been held.
    var isArchived: Bool {
        election?.phase == "archived"
    }

    /// True where the election ships no electorates, so the flow has no ballot step.
    var isElectorateLess: Bool {
        electorateCount == 0
    }

    var questions: Int { questionCount }

    /// What the screen says the comparison is. Registered copy, never composed here.
    var lede: String {
        guard let election, !isUpcoming else {
            return LegalCopy.landingLedeUpcoming(String(questionCount))
        }
        return LegalCopy.landingLedeElection(String(questionCount), String(election.year))
    }

    /// The caveat this election needs, or nil where it needs none.
    var caveat: String? {
        if isUpcoming { return LegalCopy.landingProvisional }
        if isArchived { return LegalCopy.landingArchived }
        return nil
    }

    /// The step rail, which loses its ballot step where there is no ballot to pick.
    var steps: [(name: String, detail: String)] {
        let compare = isArchived ? "Review the record" : "See how you compare"
        if isElectorateLess {
            return [
                ("1 · Answer", "\(questionCount) questions, ~5 min"),
                ("2 · Compare", compare),
            ]
        }
        return [
            ("1 · Ballot", "Find your electorate"),
            ("2 · Answer", "\(questionCount) questions, ~5 min"),
            ("3 · Compare", compare),
        ]
    }

    func load() async {
        elections = (try? loadElections()) ?? []
        progress = readProgress()
    }

    /// Reads how far a previous run got, so the screen can offer to resume it (WCAG 3.3.7).
    private func readProgress() -> Progress {
        guard let stored = restore(), stored.state != nil, stored.electorate != nil else {
            return .fresh
        }
        let answered = stored.answers.count
        guard answered > 0 else { return .fresh }
        let total = stored.questionIds.isEmpty ? questionCount : stored.questionIds.count
        return answered >= total && total > 0 ? .complete : .partway(answered: answered, total: total)
    }
}
