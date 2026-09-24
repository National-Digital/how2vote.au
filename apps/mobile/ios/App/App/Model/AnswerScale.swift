import Foundation

/// What the answer scale means beyond its wording, mirroring `apps/web/src/lib/answers.ts`.
///
/// The options themselves — their order, labels and the points each records — are not here: the
/// quiz reads them from the web's own page (``QuizWording``), where each answer names its points,
/// and the review reads each answer's short label from its own (``ReviewWording``). A second copy
/// of either would be one more place for "Strongly agree" to be read back as its opposite, on a
/// screen that still reads correctly.
///
/// The ×10 "extremely important" flag is applied on the review screen by starring an issue, and
/// only ever attaches to the two extremes, exactly as the scoring model allows.
/// `scripts/check-native-answer-scale.mjs` holds what is here to the web's.
enum AnswerScale {
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
}
