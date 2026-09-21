import SwiftUI

/// Every answer, with the one lever this screen owns.
///
/// Mirrors `apps/web/src/routes/review/+page.svelte`. Tapping a row reopens that question in the
/// quiz; the star marks an issue as extremely important, and only ever on the two ends of the scale,
/// which is the scoring model's rule rather than this screen's (``AnswerScale/allowsImportance(_:)``).
struct ReviewView: View {
    @Environment(\.colorScheme) private var scheme

    @StateObject private var model: ReviewViewModel

    /// Where the voter is going: a web path the router moves to.
    private let onExit: (String) -> Void
    /// Whether the voter may build a plan — 18+ only, so an under-18 explorer goes straight to the
    /// comparison and is never offered the research survey (ADR 0008/0012).
    private let canVote: Bool

    init(model: ReviewViewModel, canVote: Bool, onExit: @escaping (String) -> Void) {
        _model = StateObject(wrappedValue: model)
        self.canVote = canVote
        self.onExit = onExit
    }

    var body: some View {
        VStack(spacing: 0) {
            TopBar(
                label: "Review your answers",
                backLabel: "Back to the questions",
                onBack: { onExit("/quiz") }
            )
            QuizProgress(value: 1, total: 1)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text(model.headline)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Theme.ink.resolve(scheme))
                        .padding(.top, 8)
                        .padding(.bottom, 4)

                    Text(LegalCopy.importanceWeighting)
                        .font(.footnote)
                        .foregroundStyle(Theme.ink2.resolve(scheme))
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.bottom, 10)

                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Theme.gutter)
                .padding(.bottom, 20)
            }

            // One label, two destinations: the optional research survey is 18+ only (ADR 0008/0012),
            // so an under-18 explorer goes straight to their comparison and is never offered it.
            Button("See how I compare") {
                onExit(canVote ? "/survey" : "/card")
            }
            .buttonStyle(PrimaryButton())
            .padding(.horizontal, Theme.gutter)
            .padding(.bottom, 12)
        }
        .background(Theme.paper.resolve(scheme))
        .task { await model.load() }
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .loading:
            Text("Loading your answers…")
                .font(.footnote)
                .foregroundStyle(Theme.ink2.resolve(scheme))
                .accessibilityAddTraits(.updatesFrequently)

        case let .failed(message):
            Text(message)
                .font(.callout)
                .foregroundStyle(Theme.ink.resolve(scheme))

        case let .ready(rows):
            LazyVStack(spacing: 0) {
                ForEach(rows) { row in
                    ReviewRow(row: row, onEdit: edit, onStar: model.toggleImportance)
                    Divider().overlay(Theme.line.resolve(scheme))
                }
            }
        }
    }

    private func edit(_ row: ReviewViewModel.Row) {
        model.prepareEdit(position: row.position)
        // `edit` mode: answering this one question returns here, rather than walking the rest.
        onExit("/quiz?edit=1")
    }
}

/// One answered question.
private struct ReviewRow: View {
    @Environment(\.colorScheme) private var scheme

    let row: ReviewViewModel.Row
    let onEdit: (ReviewViewModel.Row) -> Void
    let onStar: (Int) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Button {
                onEdit(row)
            } label: {
                HStack(alignment: .top, spacing: 10) {
                    Text("\(row.position + 1)")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(Theme.ink2.resolve(scheme))
                        .frame(minWidth: 20, alignment: .trailing)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.text)
                            .font(.subheadline)
                            .foregroundStyle(Theme.ink.resolve(scheme))
                            .fixedSize(horizontal: false, vertical: true)
                        Text(row.answerLabel)
                            .font(.caption)
                            .foregroundStyle(Theme.ink2.resolve(scheme))
                            .opacity(row.points == nil || row.points == 0 ? 0.7 : 1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 12)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Changes this answer")

            if row.allowsImportance {
                Button {
                    onStar(row.id)
                } label: {
                    Text("★")
                        .font(.body)
                        .foregroundStyle(
                            row.important ? Theme.ink.resolve(scheme) : Theme.ink2.resolve(scheme)
                        )
                        .opacity(row.important ? 1 : 0.45)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(LegalCopy.importanceMultiplier)
                .accessibilityValue(row.important ? "On" : "Off")
                .accessibilityAddTraits(row.important ? [.isButton, .isSelected] : [.isButton])
            } else {
                // Keeps every row's text on the same left edge whether or not it can be starred.
                Color.clear.frame(width: 44, height: 44)
            }
        }
    }
}

/// The filled call-to-action used at the foot of a core screen.
struct PrimaryButton: ButtonStyle {
    @Environment(\.colorScheme) private var scheme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.callout.weight(.semibold))
            .foregroundStyle(Theme.onFill.resolve(scheme))
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(
                RoundedRectangle(cornerRadius: Theme.radius)
                    .fill(Theme.ink.resolve(scheme))
            )
            .opacity(configuration.isPressed ? 0.85 : 1)
    }
}
