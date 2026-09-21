import Foundation

/// Proves the engine produces the committed golden artifacts under JavaScriptCore.
///
/// `scripts/check-engine-bundle.mjs` already asserts the same thing on Linux, where the bundle runs
/// on Node's engine. That leaves one gap this harness closes: the app does not run on Node. Two
/// JavaScript engines can agree on every specification detail and still differ on the ones that are
/// implementation-defined — number formatting, property enumeration order, collation in
/// `localeCompare` — and every one of those would change the bytes of a card without changing any
/// logic. Running the same fixtures through JavaScriptCore is what turns "the engine is correct"
/// into "the engine is correct where it actually executes".
///
/// It is a command-line harness rather than an XCTest target on purpose. The claim under test needs
/// a handful of assertions and the real `JSCEngine`; a test target would add a native target, a build phase
/// and a scheme to the Xcode project to carry them. Compiling this together with `JSCEngine.swift`
/// exercises the shipping bridge itself, so the class is covered by more than the compiler.
///
/// Build and run from the repository root:
///
///     swiftc -O apps/mobile/ios/App/App/Engine/JSCEngine.swift \
///            apps/mobile/ios/Parity/EngineParity.swift -o "$TMPDIR/parity"
///     "$TMPDIR/parity"
@main
enum EngineParity {
    /// Repository-root-relative inputs. Overridden by the first argument when given.
    private static let bundlePath = "packages/engine/dist-native/how2vote-engine.js"
    private static let goldenDir = "packages/engine/src/__golden__"
    private static let dataDir = "data/dist"

    static func main() {
        let root = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
        do {
            let engine = try JSCEngine(scriptURL: url(root, bundlePath))
            var failures: [String] = []

            // Golden names are spelled out rather than interpolated: `check-engine-bundle.mjs`
            // compares the artifacts covered here against the ones it covers itself, and a
            // constructed name is invisible to that comparison.
            for (electionID, name) in [
                ("2025", "card-2025-bean.json"),
                ("2019", "card-2019-bean.json"),
            ] {
                let dataset = try read(url(root, "\(dataDir)/\(electionID)/dataset.json"))
                let produced = try engine.card(
                    datasetJSON: dataset,
                    requestJSON: try cardRequest(dataset: dataset)
                )
                if produced != (try read(url(root, "\(goldenDir)/\(name)"))) {
                    failures.append(
                        "\(name): JavaScriptCore does not reproduce the committed golden card — "
                            + "the iOS channel would show a different result from the web"
                    )
                }
            }

            let dataset2025 = try read(url(root, "\(dataDir)/2025/dataset.json"))
            let paper = try engine.ballotPaper(
                datasetJSON: dataset2025,
                selectionJSON: #"{"state":"ACT","electorate":"Bean"}"#
            )
            if paper != (try read(url(root, "\(goldenDir)/ballot-paper-2025-act.json"))) {
                failures.append(
                    "ballot-paper-2025-act.json: JavaScriptCore does not reproduce the committed "
                        + "ballot order"
                )
            }

            // `questions` has no golden: no committed dataset withdraws a question, so an artifact
            // captured from real data cannot tell the presentable set apart from the share ordering
            // (`native.test.ts` pins that distinction on a synthetic dataset). What this adds is the
            // half Node cannot give — that the call evaluates under JavaScriptCore and returns a
            // self-consistent payload, rather than throwing on a device after passing on Linux.
            let payload = try engine.questions(datasetJSON: dataset2025)
            failures.append(contentsOf: try checkQuestions(payload))

            guard failures.isEmpty else {
                for failure in failures { print("::error::engine parity: \(failure)") }
                exit(1)
            }
            print(
                "engine parity OK — JavaScriptCore reproduces 3 golden artifacts byte for byte, "
                    + "and serves a self-consistent question set"
            )
        } catch {
            print("::error::engine parity: \(error)")
            exit(1)
        }
    }

    /// Faults in the question payload that would reach a screen as missing or unshareable questions.
    private static func checkQuestions(_ payload: String) throws -> [String] {
        guard
            let root = try JSONSerialization.jsonObject(with: Data(payload.utf8)) as? [String: Any],
            let active = root["active"] as? [[String: Any]],
            let orderedIDs = root["orderedIds"] as? [Int]
        else {
            return ["questions: JavaScriptCore returned a payload the native side cannot decode"]
        }

        var failures: [String] = []
        if active.isEmpty {
            failures.append("questions: the presentable set is empty — the quiz would have nothing to ask")
        }
        // The share payload is positional over `orderedIds`, so a presentable question missing from
        // it is an answer that cannot be encoded — and the card that follows would be short of it.
        let ordered = Set(orderedIDs)
        for question in active where !ordered.contains(question["id"] as? Int ?? -1) {
            failures.append(
                "questions: question \(question["id"] ?? "?") is presentable but absent from the "
                    + "share ordering — an answer to it could not be encoded"
            )
        }
        if (root["dataVersion"] as? String)?.isEmpty ?? true {
            failures.append("questions: the payload carries no data vintage")
        }
        return failures
    }

    /// The fixed answer recipe the golden artifacts were captured with: the first twelve dataset
    /// questions, points cycling 1...5, the first and sixth marked important.
    ///
    /// Restated here rather than shared, so the native path is driven from its own description of
    /// the recipe. If this and `golden-output.test.ts` ever disagree about what the recipe is, the
    /// artifacts differ and this fails — which is the point of running it at all.
    private static func cardRequest(dataset: String) throws -> String {
        guard
            let root = try JSONSerialization.jsonObject(with: Data(dataset.utf8)) as? [String: Any],
            let questions = root["questions"] as? [String: Any],
            let list = questions["questions"] as? [[String: Any]]
        else {
            throw ParityError.malformedDataset
        }

        let answers: [[String: Any]] = list.prefix(12).enumerated().map { index, question in
            [
                "id": question["id"] as? Int ?? -1,
                "points": (index % 5) + 1,
                "important": index == 0 || index == 5,
            ]
        }
        let request: [String: Any] = [
            "state": "ACT", "electorate": "Bean", "answers": answers,
        ]
        let data = try JSONSerialization.data(withJSONObject: request)
        guard let json = String(data: data, encoding: .utf8) else { throw ParityError.encodingFailed }
        return json
    }

    private static func url(_ root: String, _ path: String) -> URL {
        URL(fileURLWithPath: root).appendingPathComponent(path)
    }

    private static func read(_ url: URL) throws -> String {
        try String(contentsOf: url, encoding: .utf8)
    }

    enum ParityError: Error, CustomStringConvertible {
        case malformedDataset
        case encodingFailed

        var description: String {
            switch self {
            case .malformedDataset: return "the dataset does not carry questions.questions[]"
            case .encodingFailed: return "the card request could not be encoded as UTF-8"
            }
        }
    }
}
