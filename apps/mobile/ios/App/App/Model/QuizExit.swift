import Foundation

/// Where the quiz hands control back to.
///
/// A model type rather than a view one, so the quiz's exit rules can be exercised without importing
/// SwiftUI — the screen itself is iOS-only and cannot be compiled by a command-line harness.
enum QuizExit: Equatable {
    /// The voter finished, or edited one answer from the review screen.
    case review
    /// The voter went back from the first question.
    case ballot
    /// The voter chose to stop for now. Progress is already saved.
    case pause
}
