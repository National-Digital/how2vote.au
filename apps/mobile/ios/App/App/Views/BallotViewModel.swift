import Combine
import Foundation

/// The ballot picker's state: where you vote, then which electorate, then a confirmation.
@MainActor
final class BallotViewModel: ObservableObject {
    enum Step: Equatable {
        case state
        case electorate
        case confirm
    }

    /// The sentinel ballot for a provisional election that ships no electorates. Mirrors
    /// `NATIONAL_BALLOT` in `apps/web/src/lib/data.ts` — the quiz still needs a ballot recorded
    /// before it will run, so an electorate-less election records this one and moves on.
    static let nationalBallot = (state: "AU", electorate: "Australia")

    @Published private(set) var step: Step = .state
    @Published private(set) var chosenState: String?
    @Published private(set) var chosenElectorate: String?
    @Published private(set) var loadFailed = false
    @Published var filter = ""

    private var electorates: [String] = []

    private let listElectorates: (String) throws -> [String]
    private let persistBallot: (String, String) throws -> Void
    /// Whether this election ships a ballot at all.
    let isElectorateLess: Bool

    init(
        isElectorateLess: Bool,
        listElectorates: @escaping (String) throws -> [String],
        persistBallot: @escaping (String, String) throws -> Void
    ) {
        self.isElectorateLess = isElectorateLess
        self.listElectorates = listElectorates
        self.persistBallot = persistBallot
    }

    static func live(electionID: String, engine: JSCEngine) -> BallotViewModel {
        let manifest = ManifestLoader.load(electionID: electionID)
        return BallotViewModel(
            // Fails CLOSED to "there is a ballot": an unreadable manifest must not skip the picker
            // and silently record a national ballot for an election that has real electorates.
            isElectorateLess: manifest?.isElectorateLess ?? false,
            listElectorates: { state in
                let dataset = try QuestionLoader.dataset(electionID: electionID)
                let payload = try engine.electorates(datasetJSON: dataset, stateCode: state)
                struct Row: Decodable { let electorate: String }
                let rows = try JSONDecoder().decode([Row].self, from: Data(payload.utf8))
                return rows.map(\.electorate)
            },
            persistBallot: { state, electorate in
                var record = QuizState.load(electionID: electionID)
                    ?? QuizState.Persisted(
                        state: nil, electorate: nil, answers: [:], cursor: 0,
                        questionIds: [], updatedAt: 0
                    )
                record.state = state
                record.electorate = electorate
                try QuizState.save(record, electionID: electionID)
            }
        )
    }

    /// The electorates matching the search box, in the engine's order.
    var visibleElectorates: [String] {
        let needle = filter.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return electorates }
        return electorates.filter { $0.lowercased().contains(needle) }
    }

    var electorateCount: Int { electorates.count }

    var stepNumber: Int {
        switch step {
        case .state: return 1
        case .electorate: return 2
        case .confirm: return 3
        }
    }

    func pick(state code: String) {
        chosenState = code
        filter = ""
        loadFailed = false
        do {
            electorates = try listElectorates(code)
            step = .electorate
        } catch {
            electorates = []
            loadFailed = true
            step = .electorate
        }
    }

    func pick(electorate name: String) {
        guard chosenState != nil else { return }
        chosenElectorate = name
        step = .confirm
    }

    /// Records the ballot and reports where to go next, or nil if there is nothing to record.
    ///
    /// A refused write does not block the voter: the quiz reads the ballot from the same record, so
    /// a refusal costs them the questionnaire — which is why it is reported rather than swallowed.
    func confirm() -> String? {
        guard let state = chosenState, let electorate = chosenElectorate else { return nil }
        do {
            try persistBallot(state, electorate)
        } catch {
            return nil
        }
        return "/quiz"
    }

    /// Records the sentinel ballot for an election with no electorates to pick.
    func skipToQuestions() -> String? {
        do {
            try persistBallot(Self.nationalBallot.state, Self.nationalBallot.electorate)
        } catch {
            return nil
        }
        return "/quiz"
    }

    /// Steps back, or reports the web path to leave for when there is nowhere left to step.
    func back() -> String? {
        switch step {
        case .confirm:
            chosenElectorate = nil
            step = .electorate
            return nil
        case .electorate:
            chosenState = nil
            electorates = []
            step = .state
            return nil
        case .state:
            return "/"
        }
    }
}
