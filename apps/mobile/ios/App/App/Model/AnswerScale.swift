import Foundation

/// One row of the answer scale.
struct AnswerOption: Equatable {
    enum Kind: Equatable {
        case answer
        case skip
    }

    let kind: Kind
    /// The scored value. `0` is No Answer, which is what `skip` records.
    let points: Int
    let label: String
    /// Secondary text shown alongside the label, where the scale has any.
    let sub: String?
}

/// The answer scale the quiz presents, mirroring `apps/web/src/lib/answers.ts`.
///
/// One tap encodes direction and strength. The ×10 "extremely important" flag is not set here — it
/// is applied on the review screen by starring an issue, and only ever attaches to the two extremes,
/// exactly as the scoring model allows. "Skip" is a real, quiet option, scored as No Answer.
///
/// The order, the labels and — above all — the label-to-points binding are the web's, not a native
/// restatement of it. `scripts/check-native-answer-scale.mjs` fails the build if the two drift,
/// because a rebinding here would not crash or look wrong: it would score a voter's answers as
/// their opposite, on a screen that still reads correctly.
enum AnswerScale {
    static let options: [AnswerOption] = [
        AnswerOption(kind: .answer, points: 5, label: "Strongly agree", sub: nil),
        AnswerOption(kind: .answer, points: 4, label: "Agree", sub: nil),
        AnswerOption(kind: .answer, points: 3, label: "Equal merits", sub: "both sides have a point"),
        AnswerOption(kind: .answer, points: 2, label: "Disagree", sub: nil),
        AnswerOption(kind: .answer, points: 1, label: "Strongly disagree", sub: nil),
        AnswerOption(kind: .skip, points: 0, label: "Skip — no position on this issue", sub: nil),
    ]

    /// The answers the ×10 "extremely important" lever may attach to.
    ///
    /// Importance only weights the two ends of the scale, which is the scoring model's rule and not
    /// a presentation choice: a star allowed onto a middling answer would multiply a weight the
    /// engine never intended to multiply, and the result would be wrong without looking wrong. The
    /// web enforces it in `record`, in `toggleImportant` and in the review screen's own markup;
    /// `scripts/check-native-answer-scale.mjs` holds this to the same two values.
    static let importanceApplies: Set<Int> = [1, 5]

    /// Whether an answer may carry the ×10 star.
    static func allowsImportance(_ points: Int) -> Bool {
        importanceApplies.contains(points)
    }

    /// Short label for the review screen and VoiceOver announcements. `important` prefixes a star.
    static func label(points: Int, important: Bool = false) -> String {
        let base: [Int: String] = [
            0: "Skipped",
            1: "Strongly disagree",
            2: "Disagree",
            3: "Equal merits",
            4: "Agree",
            5: "Strongly agree",
        ]
        // Out of range is unreachable from `options`, and No Answer is the safe reading of a value
        // the scale does not define — never an opinion the voter did not express.
        let text = base[points] ?? base[0]!
        return important ? "★ \(text)" : text
    }
}
