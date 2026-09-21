import Foundation
import JavaScriptCore

/// Errors raised while loading or calling the shared scoring engine.
enum JSCEngineError: Error, CustomStringConvertible {
    case bundleMissing
    case bundleUnreadable(String)
    case evaluationFailed(String)
    case globalMissing
    case versionMismatch(expected: Int, found: Int)
    case callFailed(function: String, message: String)

    var description: String {
        switch self {
        case .bundleMissing:
            return "the engine bundle is not in the app bundle — the web build did not carry it"
        case let .bundleUnreadable(reason):
            return "the engine bundle could not be read: \(reason)"
        case let .evaluationFailed(message):
            return "the engine bundle failed to evaluate: \(message)"
        case .globalMissing:
            return "the engine bundle evaluated but exposed no How2VoteEngine global"
        case let .versionMismatch(expected, found):
            return "engine bundle API version \(found) does not match the \(expected) this build expects"
        case let .callFailed(function, message):
            return "engine call \(function) failed: \(message)"
        }
    }
}

/// The shared scoring engine, running in JavaScriptCore.
///
/// The native core does not reimplement scoring, ballot ordering or card construction in Swift. Two
/// implementations of that logic would eventually disagree about the same answers, which is the one
/// kind of drift a voting tool cannot carry, so there is a single engine — `packages/engine` — and
/// this type is a view over it. `scripts/check-engine-bundle.mjs` proves the bundle reproduces the
/// committed golden artifacts byte for byte before it ever reaches a device.
///
/// The boundary is JSON in, JSON out. JavaScriptCore can marshal live objects, but doing so would
/// spread the engine's internal shape across Swift call sites, where a change to a type becomes a
/// silent native breakage rather than a compile error. Strings keep the contract narrow and
/// versioned.
///
/// Instances are not thread-safe: a `JSContext` must be used from one thread at a time. Hold one per
/// consumer, or serialise access.
final class JSCEngine {
    /// The bundle contract this build was written against; must match `NATIVE_API_VERSION`.
    static let expectedAPIVersion = 4

    private let context: JSContext
    private let engine: JSValue

    /// Loads and evaluates the engine bundle.
    ///
    /// The bundle ships inside the synced web assets rather than as its own Xcode resource, so it
    /// travels with the web build that produced it and cannot fall out of step with it.
    ///
    /// - Parameter bundle: the bundle to search; defaults to the main app bundle.
    convenience init(bundle: Bundle = .main) throws {
        guard let url = bundle.url(
            forResource: "how2vote-engine",
            withExtension: "js",
            subdirectory: "public"
        ) else {
            throw JSCEngineError.bundleMissing
        }
        try self.init(scriptURL: url)
    }

    /// Loads the engine from an explicit script URL.
    init(scriptURL: URL) throws {
        let source: String
        do {
            source = try String(contentsOf: scriptURL, encoding: .utf8)
        } catch {
            throw JSCEngineError.bundleUnreadable(error.localizedDescription)
        }

        guard let context = JSContext() else {
            throw JSCEngineError.evaluationFailed("could not create a JSContext")
        }

        // A JSContext reports a thrown exception through this handler rather than by returning nil,
        // so without it an engine error becomes a silently undefined result.
        var thrown: String?
        context.exceptionHandler = { _, exception in
            thrown = exception?.toString() ?? "unknown JavaScript exception"
        }

        context.evaluateScript(source, withSourceURL: scriptURL)
        if let thrown {
            throw JSCEngineError.evaluationFailed(thrown)
        }

        guard let engine = context.objectForKeyedSubscript("How2VoteEngine"),
              !engine.isUndefined, !engine.isNull else {
            throw JSCEngineError.globalMissing
        }

        // A stale bundle paired with a newer binary would otherwise fail by producing a subtly wrong
        // card rather than by refusing to start.
        let found = Int(engine.objectForKeyedSubscript("NATIVE_API_VERSION")?.toInt32() ?? -1)
        guard found == Self.expectedAPIVersion else {
            throw JSCEngineError.versionMismatch(expected: Self.expectedAPIVersion, found: found)
        }

        self.context = context
        self.engine = engine
    }

    /// Builds a printable card. Returns the serialised card, byte-identical to the web's for the
    /// same inputs.
    ///
    /// - Parameters:
    ///   - datasetJSON: a compiled election dataset (`data/dist/<id>/dataset.json`).
    ///   - requestJSON: `{ state, electorate, answers, suspended?, ballotSeed? }`.
    func card(datasetJSON: String, requestJSON: String) throws -> String {
        try call("card", [datasetJSON, requestJSON])
    }

    /// The questions a screen may present, and the ordering the share codec is positional over.
    ///
    /// Returns `{ dataVersion, attribution, active[], orderedIds[] }`. `active` is the presentable
    /// set and `orderedIds` is the dataset's full ordering — the two differ once a question is
    /// withdrawn, and the native side must not derive either from the other.
    func questions(datasetJSON: String) throws -> String {
        try call("questions", [datasetJSON])
    }

    /// The elections a landing screen offers, and the stage each is at.
    ///
    /// The stage is a date judgement over an AEC timetable, and it decides what a screen may say —
    /// a provisional comparison or a historical one. Read from the engine so the two channels
    /// cannot disagree about it on the days it matters most.
    func elections(nowISO: String = "") throws -> String {
        try call("elections", [nowISO])
    }

    /// The electorates in one state, in the order a picker lists them.
    ///
    /// The ordering is the engine's, not Swift's: `localeCompare` and `String.compare` need not
    /// agree at the edges, and a picker that ordered names differently from the web would be a
    /// visible channel difference with no reason behind it.
    func electorates(datasetJSON: String, stateCode: String) throws -> String {
        try call("electorates", [datasetJSON, stateCode])
    }

    /// The printed ballot paper for one electorate: candidates in ballot order, no scoring applied.
    func ballotPaper(datasetJSON: String, selectionJSON: String) throws -> String {
        try call("ballotPaper", [datasetJSON, selectionJSON])
    }

    /// Per-party match percentages for the evidence view, as a key-sorted JSON object.
    func percentages(answersJSON: String, questionsJSON: String, mergesJSON: String = "[]") throws -> String {
        try call("percentages", [answersJSON, questionsJSON, mergesJSON])
    }

    /// Encodes a card into a share fragment, without the leading `#`.
    func share(cardJSON: String, orderedIDsJSON: String, electionID: String) throws -> String {
        try call("share", [cardJSON, orderedIDsJSON, electionID])
    }

    /// Decodes a share fragment, returning the decoded share as JSON or the JSON `null`.
    func unshare(
        fragment: String,
        orderedIDsByElectionJSON: String,
        dataVersionsByElectionJSON: String = "{}"
    ) throws -> String {
        try call("unshare", [fragment, orderedIDsByElectionJSON, dataVersionsByElectionJSON])
    }

    /// Invokes an engine function, turning a JavaScript throw into a Swift error.
    private func call(_ function: String, _ arguments: [String]) throws -> String {
        var thrown: String?
        context.exceptionHandler = { _, exception in
            thrown = exception?.toString() ?? "unknown JavaScript exception"
        }

        guard let target = engine.objectForKeyedSubscript(function), !target.isUndefined else {
            throw JSCEngineError.callFailed(function: function, message: "not exported by the bundle")
        }

        let result = target.call(withArguments: arguments)
        if let thrown {
            throw JSCEngineError.callFailed(function: function, message: thrown)
        }
        guard let string = result?.toString(), result?.isString == true else {
            throw JSCEngineError.callFailed(function: function, message: "did not return a string")
        }
        return string
    }
}
