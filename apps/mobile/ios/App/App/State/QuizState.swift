import Foundation

/// The in-progress quiz, in the exact shape the web persists (ADR 0018 D3).
///
/// The format is not ours to choose. The same answers are read by the WebView — for the document
/// routes, the D8 compliance islands, and the D4 fallback — and a share link is reconstructed from
/// the same ids, so the native core writes precisely what `apps/web/src/lib/quiz.svelte.ts` writes:
/// the same key, the same fields, the same 30-day resume window.
///
/// **The age-first gate applies here too** (ADR 0011). The web refuses to persist any quiz state
/// until the 18+ eligibility declaration is recorded, and a native path that skipped that check
/// would be a bypass of the gate rather than a second implementation of it. The eligibility bit is
/// deliberately excluded from the durable native mirror — restoring it cannot tell eviction from a
/// deliberate deletion, and healing it wrongly would re-confirm the gate on a minor's behalf — so it
/// is not readable from Preferences by design. The native core therefore holds eligibility as
/// SESSION state only, handed to it by the WebView that owns the gate, and `save` fails closed
/// without it. Nothing new is persisted, and the gate keeps its single implementation.
enum QuizState {
    /// Per-election key. `v2` namespaces progress by election id: each election asks different
    /// questions, so switching election swaps to that election's own answers rather than mixing them.
    static let keyPrefix = "how2vote:quiz:v2:"

    /// Resume is offered for 30 days, after which stored progress is discarded rather than restored.
    static let maxAgeMilliseconds: Int64 = 30 * 24 * 60 * 60 * 1000

    enum QuizError: Error, CustomStringConvertible {
        case notEligible
        case encodingFailed

        var description: String {
            switch self {
            case .notEligible:
                return "refused to persist quiz state before the 18+ eligibility declaration "
                    + "(docs/adr/0011) — the age-first gate precedes any quiz state"
            case .encodingFailed:
                return "the quiz state could not be encoded"
            }
        }
    }

    /// One recorded answer. Points 0 is an explicit skip; importance is the ×10 lever, which the
    /// scoring model applies only at the extremes.
    struct StoredAnswer: Codable, Equatable {
        var points: Int
        var important: Bool
    }

    /// The persisted record, field-for-field with the web's `Persisted` type.
    ///
    /// `answers` is keyed by question id. JSON object keys are strings, so the ids are carried as
    /// strings here and parsed back — which is what `JSON.stringify` produces from the web's
    /// `Record<number, StoredAnswer>`, and so what a WebView reader expects to find.
    struct Persisted: Codable, Equatable {
        var state: String?
        var electorate: String?
        var answers: [String: StoredAnswer]
        var cursor: Int
        var questionIds: [Int]
        var updatedAt: Int64
    }

    /// Whether the 18+ declaration has been recorded for this session, as reported by the WebView
    /// that owns the gate. Never persisted natively.
    static var eligibleThisSession = false

    /// Whether this session is an under-18 explorer's (ADR 0012), who may take the quiz but must not
    /// have it persisted. Reported by the WebView alongside eligibility.
    static var canExploreThisSession = false

    /// An explorer's progress, held in memory for this session only — the native side of the web's
    /// in-memory quiz — and exchanged with the WebView at each handover so the two agree.
    static var sessionRecords: [String: Persisted] = [:]

    static func key(for electionID: String) -> String { keyPrefix + electionID }

    /// Takes the WebView's copy of an explorer's in-memory quiz at a handover (ADR 0012).
    ///
    /// The web's copy is current when the voter arrives from a web screen. On a repeat of the screen
    /// already showing, the native record may be newer, so it is kept. A declared adult's progress is
    /// in durable storage, which both sides read, so nothing is exchanged.
    static func acceptHandover(session: String?, electionID: String, eligible: Bool, repeated: Bool) {
        guard !eligible, !repeated else { return }
        sessionRecords[electionID] = session.flatMap {
            try? JSONDecoder().decode(Persisted.self, from: Data($0.utf8))
        }
    }

    /// Reads stored progress, discarding anything older than the resume window.
    ///
    /// An unreadable or expired record degrades to "no progress" rather than an error: the same
    /// fail-open-to-fresh-start behaviour the web has, because a corrupt record must never be the
    /// reason a voter cannot begin.
    static func load(electionID: String, now: Int64 = nowMilliseconds()) -> Persisted? {
        guard let raw = NativeState.value(forKey: key(for: electionID)),
              let data = raw.data(using: .utf8),
              let stored = try? JSONDecoder().decode(Persisted.self, from: data)
        else { return nil }

        guard now - stored.updatedAt <= maxAgeMilliseconds else {
            try? NativeState.remove(forKey: key(for: electionID))
            return nil
        }
        return stored
    }

    /// Writes progress, stamping `updatedAt`. Fails closed without the eligibility declaration.
    static func save(
        _ persisted: Persisted,
        electionID: String,
        now: Int64 = nowMilliseconds()
    ) throws {
        guard eligibleThisSession else { throw QuizError.notEligible }

        var record = persisted
        record.updatedAt = now
        guard let data = try? JSONEncoder().encode(record),
              let json = String(data: data, encoding: .utf8)
        else { throw QuizError.encodingFailed }

        try NativeState.set(json, forKey: key(for: electionID))
    }

    /// Reads progress from wherever this session keeps it: storage for a declared adult, memory for
    /// an explorer.
    static func current(electionID: String, now: Int64 = nowMilliseconds()) -> Persisted? {
        eligibleThisSession ? load(electionID: electionID, now: now) : sessionRecords[electionID]
    }

    /// Records progress where this session keeps it. An explorer's goes to memory; anyone else
    /// without the declaration is refused by `save`.
    static func record(
        _ persisted: Persisted,
        electionID: String,
        now: Int64 = nowMilliseconds()
    ) throws {
        if !eligibleThisSession, canExploreThisSession {
            var session = persisted
            session.updatedAt = now
            sessionRecords[electionID] = session
            return
        }
        try save(persisted, electionID: electionID, now: now)
    }

    /// Discards this election's stored progress.
    ///
    /// Mirrors `reset()` in `apps/web/src/lib/quiz.svelte.ts`: "Start again" must leave nothing
    /// behind, or a voter who deliberately started over would find their old answers waiting on the
    /// next launch. Unlike a write, this needs no eligibility declaration — refusing to let someone
    /// clear their own answers would be the wrong way to fail.
    static func clear(electionID: String) {
        sessionRecords[electionID] = nil
        try? NativeState.remove(forKey: key(for: electionID))
    }

    /// Milliseconds since the Unix epoch, the units the web's `Date.now()` writes.
    static func nowMilliseconds() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }
}
