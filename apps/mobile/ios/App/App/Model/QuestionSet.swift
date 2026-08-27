import Foundation

/// One question, as a screen renders it.
struct Question: Decodable, Identifiable, Equatable {
    let id: Int
    let text: String
    let divisionFirst: String
    let divisionLast: String
    let divisionCount: Int
}

/// The questions a screen may present, and the ordering the share codec is positional over.
///
/// Decoded from `JSCEngine.questions(datasetJSON:)`. The two lists are deliberately different and
/// neither is derived from the other: `active` omits withdrawn questions (ADR 0005), while
/// `orderedIds` keeps them so a fragment encoded before a withdrawal still decodes afterwards.
/// Presenting `orderedIds` would show a voter a question that has been withdrawn.
struct QuestionSet: Decodable, Equatable {
    /// ISO date of the latest division the positions are compiled from.
    let dataVersion: String
    let attribution: String
    let active: [Question]
    let orderedIds: [Int]

    /// The presentable question at a cursor position, or `nil` past the end.
    func question(at index: Int) -> Question? {
        active.indices.contains(index) ? active[index] : nil
    }

    var total: Int { active.count }
}

/// Loads an election's question set through the shared engine.
///
/// The dataset is read from the synced web assets, which is the same payload the WebView reads, so
/// the two channels cannot be looking at different data. Decoding the filter natively would put a
/// second implementation of "which questions may be shown" in the app (ADR 0018 D2), so the engine
/// decides and this only decodes the answer.
enum QuestionLoader {
    enum LoadError: Error, CustomStringConvertible {
        case datasetMissing(String)
        case datasetUnreadable(String)
        case payloadUndecodable(String)

        var description: String {
            switch self {
            case let .datasetMissing(id):
                return "the dataset for election \(id) is not in the app bundle"
            case let .datasetUnreadable(reason):
                return "the dataset could not be read: \(reason)"
            case let .payloadUndecodable(reason):
                return "the engine's question payload could not be decoded: \(reason)"
            }
        }
    }

    /// Reads and decodes one election's question set.
    ///
    /// - Parameters:
    ///   - electionID: an election id, e.g. `2025`.
    ///   - engine: the loaded engine.
    ///   - bundle: the bundle to search; defaults to the main app bundle.
    static func load(
        electionID: String,
        engine: JSCEngine,
        bundle: Bundle = .main
    ) throws -> QuestionSet {
        let payload = try engine.questions(datasetJSON: try dataset(electionID: electionID, bundle: bundle))
        do {
            return try JSONDecoder().decode(QuestionSet.self, from: Data(payload.utf8))
        } catch {
            throw LoadError.payloadUndecodable(error.localizedDescription)
        }
    }

    /// The raw compiled dataset for an election, as the engine takes it.
    ///
    /// Shared with the ballot picker, which asks the engine a different question of the same file.
    static func dataset(electionID: String, bundle: Bundle = .main) throws -> String {
        guard let url = bundle.url(
            forResource: "dataset",
            withExtension: "json",
            subdirectory: "public/data/dist/\(electionID)"
        ) else {
            throw LoadError.datasetMissing(electionID)
        }
        do {
            return try String(contentsOf: url, encoding: .utf8)
        } catch {
            throw LoadError.datasetUnreadable(error.localizedDescription)
        }
    }
}
