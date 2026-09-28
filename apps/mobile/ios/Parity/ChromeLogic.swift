import Foundation

/// Exercises the site-chrome handover and the explorer's session record without a UI.
///
/// The same shape as `QuizLogic`: the SHIPPING model files compiled with `swiftc` and run.
///
/// Build and run from the repository root:
///
///     swiftc -O apps/mobile/ios/App/App/Model/SiteChrome.swift \
///            apps/mobile/ios/App/App/State/NativeState.swift \
///            apps/mobile/ios/App/App/State/QuizState.swift \
///            apps/mobile/ios/Parity/ChromeLogic.swift -o "$TMPDIR/chrome-logic"
///     "$TMPDIR/chrome-logic"
@main
enum ChromeLogic {
    static func main() {
        // The shell claims ownership at launch; without it every durable write is refused.
        NativeState.claimOwnership()
        var failures: [String] = []
        var ran = 0

        for found in [
            decodesTheWebsHandover(),
            declinesWithoutTheAuthorisation(),
            declinesAMalformedOrPartialHandover(),
            keepsAnExplorersProgressInMemoryOnly(),
            stillRefusesAnUndeclaredVisitor(),
            persistsADeclaredAdult(),
            startAgainClearsTheSessionRecord(),
            takesTheWebsCopyAtAHandover(),
            keepsTheNewerNativeRecordOnARepeat(),
            exchangesNothingForADeclaredAdult(),
        ] {
            ran += 1
            failures.append(contentsOf: found)
        }

        guard failures.isEmpty else {
            for failure in failures { print("::error::chrome logic: \(failure)") }
            exit(1)
        }
        print("site chrome and session logic OK — \(ran) rules hold")
    }

    // MARK: - Fixtures

    private static let electionID = "chrome-logic-test"

    private static func handover(authorisation: String = "Authorised by A, B, C.") -> String {
        """
        {"authorisation":"\(authorisation)",
         "credit":[{"text":"© "},{"text":"Org","href":"https://example.org"}],
         "links":[{"label":"Feedback","href":"/contact"},{"label":"Privacy policy","href":"/privacy"}],
         "linkCue":"opens in an in-app browser",
         "stale":{"message":"Old data.","dataVersion":"2025-01-01","prominent":true,"updateUrl":null,
                  "update":"Update","dismiss":"Dismiss"}}
        """
    }

    private static func record(answers: Int) -> QuizState.Persisted {
        QuizState.Persisted(
            state: "ACT",
            electorate: "Bean",
            answers: Dictionary(
                uniqueKeysWithValues: (0..<answers).map { ("\($0 + 1)", .init(points: 5, important: false)) }
            ),
            cursor: answers,
            questionIds: [1, 2, 3],
            updatedAt: 0
        )
    }

    private static func session(eligible: Bool, canExplore: Bool) {
        QuizState.eligibleThisSession = eligible
        QuizState.canExploreThisSession = canExplore
        QuizState.clear(electionID: electionID)
    }

    // MARK: - Rules

    private static func decodesTheWebsHandover() -> [String] {
        guard let chrome = SiteChrome.decode(handover()) else { return ["the web's handover did not decode"] }
        guard chrome.links.first?.href == "/contact", chrome.credit.count == 2,
              chrome.linkCue == "opens in an in-app browser" else {
            return ["the handover decoded without its links or credit"]
        }
        guard chrome.stale?.prominent == true, chrome.stale?.updateUrl == nil,
              chrome.stale?.update == "Update", chrome.stale?.dismiss == "Dismiss" else {
            return ["the stale notice did not survive the handover"]
        }
        return []
    }

    /// A native screen without the s321D authorisation must not be shown: nil makes the shell
    /// decline the route, and the WebView renders it with its own footer.
    private static func declinesWithoutTheAuthorisation() -> [String] {
        if SiteChrome.decode(handover(authorisation: "  ")) != nil {
            return ["a handover with a blank authorisation was accepted"]
        }
        if SiteChrome.decode(nil) != nil { return ["a missing handover was accepted"] }
        return []
    }

    private static func declinesAMalformedOrPartialHandover() -> [String] {
        var failures: [String] = []
        if SiteChrome.decode("{") != nil { failures.append("malformed JSON was accepted") }
        let noLinks = #"{"authorisation":"A","credit":[{"text":"c"}],"links":[],"linkCue":"c","stale":null}"#
        if SiteChrome.decode(noLinks) != nil { failures.append("a handover with no links was accepted") }
        let external = #"{"authorisation":"A","credit":[{"text":"c"}],"links":[{"label":"x","href":"https://x"}],"linkCue":"c"}"#
        if SiteChrome.decode(external) != nil {
            failures.append("a footer link that is not a web route was accepted")
        }
        // An external link's cue is the web's; a handover without it cannot announce one.
        let uncued = #"{"authorisation":"A","credit":[{"text":"c"}],"links":[{"label":"x","href":"/x"}],"linkCue":" "}"#
        if SiteChrome.decode(uncued) != nil { failures.append("a handover with a blank link cue was accepted") }
        let noCue = #"{"authorisation":"A","credit":[{"text":"c"}],"links":[{"label":"x","href":"/x"}]}"#
        if SiteChrome.decode(noCue) != nil { failures.append("a handover without a link cue was accepted") }
        // The notice's controls are worded by the web; a notice without them cannot be drawn.
        let unlabelled = #"{"authorisation":"A","credit":[{"text":"c"}],"links":[{"label":"x","href":"/x"}],"linkCue":"c","#
            + #""stale":{"message":"m","dataVersion":"v","prominent":false,"update":"u","dismiss":" "}}"#
        if SiteChrome.decode(unlabelled) != nil { failures.append("a stale notice with a blank control was accepted") }
        let unworded = #"{"authorisation":"A","credit":[{"text":"c"}],"links":[{"label":"x","href":"/x"}],"linkCue":"c","#
            + #""stale":{"message":"m","dataVersion":"v","prominent":false}}"#
        if SiteChrome.decode(unworded) != nil { failures.append("a stale notice without its controls was accepted") }
        return failures
    }

    /// ADR 0012: an explorer may take the quiz and must not have it persisted.
    private static func keepsAnExplorersProgressInMemoryOnly() -> [String] {
        session(eligible: false, canExplore: true)
        defer { session(eligible: false, canExplore: false) }
        do {
            try QuizState.record(record(answers: 2), electionID: electionID)
        } catch {
            return ["an explorer's progress was refused, so the flow would stall"]
        }
        guard QuizState.current(electionID: electionID)?.answers.count == 2 else {
            return ["an explorer's progress was not readable back"]
        }
        guard NativeState.value(forKey: QuizState.key(for: electionID)) == nil else {
            return ["an explorer's progress was written to durable storage"]
        }
        return []
    }

    private static func stillRefusesAnUndeclaredVisitor() -> [String] {
        session(eligible: false, canExplore: false)
        do {
            try QuizState.record(record(answers: 1), electionID: electionID)
            return ["progress was recorded for a visitor with no declaration"]
        } catch {
            return QuizState.current(electionID: electionID) == nil
                ? []
                : ["a refused write still left progress behind"]
        }
    }

    private static func persistsADeclaredAdult() -> [String] {
        session(eligible: true, canExplore: true)
        defer { session(eligible: false, canExplore: false) }
        do {
            try QuizState.record(record(answers: 3), electionID: electionID)
        } catch {
            return ["a declared adult's progress was refused"]
        }
        guard NativeState.value(forKey: QuizState.key(for: electionID)) != nil,
              QuizState.sessionRecords[electionID] == nil
        else { return ["a declared adult's progress did not go to durable storage"] }
        return []
    }

    private static func encoded(_ record: QuizState.Persisted) -> String {
        String(decoding: (try? JSONEncoder().encode(record)) ?? Data(), as: UTF8.self)
    }

    private static func takesTheWebsCopyAtAHandover() -> [String] {
        session(eligible: false, canExplore: true)
        defer { session(eligible: false, canExplore: false) }
        QuizState.sessionRecords[electionID] = record(answers: 1)
        QuizState.acceptHandover(
            session: encoded(record(answers: 3)), electionID: electionID, eligible: false, repeated: false
        )
        return QuizState.sessionRecords[electionID]?.answers.count == 3
            ? []
            : ["an explorer arriving from a web screen did not get the web's copy of their quiz"]
    }

    private static func keepsTheNewerNativeRecordOnARepeat() -> [String] {
        session(eligible: false, canExplore: true)
        defer { session(eligible: false, canExplore: false) }
        QuizState.sessionRecords[electionID] = record(answers: 3)
        QuizState.acceptHandover(
            session: encoded(record(answers: 1)), electionID: electionID, eligible: false, repeated: true
        )
        return QuizState.sessionRecords[electionID]?.answers.count == 3
            ? []
            : ["a repeat of the screen on display replaced the newer native record with the web's older one"]
    }

    private static func exchangesNothingForADeclaredAdult() -> [String] {
        session(eligible: true, canExplore: true)
        defer { session(eligible: false, canExplore: false) }
        QuizState.sessionRecords[electionID] = nil
        QuizState.acceptHandover(
            session: encoded(record(answers: 2)), electionID: electionID, eligible: true, repeated: false
        )
        return QuizState.sessionRecords[electionID] == nil
            ? []
            : ["a declared adult's progress was taken into the explorer's in-memory record"]
    }

    private static func startAgainClearsTheSessionRecord() -> [String] {
        session(eligible: false, canExplore: true)
        defer { session(eligible: false, canExplore: false) }
        try? QuizState.record(record(answers: 2), electionID: electionID)
        QuizState.clear(electionID: electionID)
        return QuizState.current(electionID: electionID) == nil
            ? []
            : ["start again left an explorer's answers behind"]
    }
}
