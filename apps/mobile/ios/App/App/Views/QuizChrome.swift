import SwiftUI

/// The pinned bar at the top of a core screen: back, a position label, and one trailing action.
///
/// Mirrors `apps/web/src/lib/components/TopBar.svelte`. The bar has a resting height and grows from
/// it rather than clipping: at the largest Dynamic Type sizes a fixed bar would cut the label off
/// from exactly the reader who enlarged it (WCAG 2.2 SC 1.4.4).
struct TopBar: View {
    @Environment(\.colorScheme) private var scheme

    let label: String
    let backLabel: String
    let onBack: () -> Void
    /// Trailing action. Omitted when the screen has none.
    var trailing: (title: String, action: () -> Void)?

    var body: some View {
        HStack(spacing: 8) {
            Button(action: onBack) {
                Image(systemName: "chevron.left")
                    .font(.body.weight(.medium))
                    .frame(minWidth: 44, minHeight: 44, alignment: .leading)
            }
            .accessibilityLabel(backLabel)

            Spacer(minLength: 0)

            Text(label)
                .font(.footnote)
                .foregroundStyle(Theme.ink2.resolve(scheme))
                .multilineTextAlignment(.center)

            Spacer(minLength: 0)

            if let trailing {
                Button(trailing.title, action: trailing.action)
                    .font(.footnote)
                    .underline()
                    .frame(minWidth: 44, minHeight: 44, alignment: .trailing)
            } else {
                // Balances the back button so the label stays optically centred.
                Color.clear.frame(width: 44, height: 44)
            }
        }
        .foregroundStyle(Theme.ink2.resolve(scheme))
        .padding(.horizontal, Theme.gutter)
        .padding(.top, 4)
        .frame(minHeight: 56)
    }
}

/// The quiz's progress indicator.
///
/// Mirrors `apps/web/src/lib/components/Progress.svelte`. Announced as a single value to VoiceOver
/// rather than as a decorative bar, because the position in the questionnaire is information — a
/// voter deciding whether to finish now or resume later is acting on it.
struct QuizProgress: View {
    @Environment(\.colorScheme) private var scheme

    let value: Int
    let total: Int

    private var fraction: Double {
        total > 0 ? min(1, max(0, Double(value) / Double(total))) : 0
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Rectangle().fill(Theme.wash.resolve(scheme))
                Rectangle()
                    .fill(Theme.ink.resolve(scheme))
                    .frame(width: geometry.size.width * fraction)
            }
        }
        .frame(height: 3)
        .accessibilityElement()
        .accessibilityLabel("Quiz progress")
        .accessibilityValue(total > 0 ? "Question \(value) of \(total)" : "Loading")
    }
}

/// The answer scale as a column of controls.
///
/// Mirrors `apps/web/src/lib/components/AnswerOptions.svelte`. The options, their order and their
/// points come from ``AnswerScale``, which `scripts/check-native-answer-scale.mjs` holds to the
/// web's — nothing here restates them.
struct AnswerOptions: View {
    @Environment(\.colorScheme) private var scheme

    /// The current answer's points, or `nil` when the question is unanswered.
    let current: Int?
    let onAnswer: (Int) -> Void

    var body: some View {
        VStack(spacing: 7) {
            ForEach(Array(AnswerScale.options.enumerated()), id: \.offset) { _, option in
                switch option.kind {
                case .answer:
                    answerRow(option)
                case .skip:
                    skipRow(option)
                }
            }
        }
    }

    private func isOn(_ option: AnswerOption) -> Bool {
        current == option.points
    }

    private func answerRow(_ option: AnswerOption) -> some View {
        Button {
            onAnswer(option.points)
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(option.label)
                    .font(.callout.weight(.semibold))
                if let sub = option.sub {
                    Spacer(minLength: 8)
                    Text(sub)
                        .font(.caption)
                        .multilineTextAlignment(.trailing)
                        .opacity(isOn(option) ? 0.8 : 1)
                        .foregroundStyle(
                            isOn(option) ? Theme.onFill.resolve(scheme) : Theme.ink2.resolve(scheme)
                        )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(minHeight: 48)
            .background(
                RoundedRectangle(cornerRadius: Theme.radius)
                    .fill(
                        isOn(option) ? Theme.ink.resolve(scheme) : Theme.raise.resolve(scheme)
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radius)
                    .strokeBorder(Theme.rule.resolve(scheme), lineWidth: 1.5)
            )
            .foregroundStyle(
                isOn(option) ? Theme.onFill.resolve(scheme) : Theme.ink.resolve(scheme)
            )
        }
        .buttonStyle(.plain)
        .contentShape(Rectangle())
        // A toggle, not a link: the selected answer has to be perceivable without colour, and
        // `isSelected` is what VoiceOver and Voice Control both read and act on.
        .accessibilityAddTraits(isOn(option) ? [.isButton, .isSelected] : [.isButton])
        .accessibilityLabel(spoken(option))
        .animation(.easeOut(duration: Theme.confirmDuration), value: current)
    }

    private func skipRow(_ option: AnswerOption) -> some View {
        Button {
            onAnswer(option.points)
        } label: {
            Text(option.label)
                .font(.footnote.weight(isOn(option) ? .semibold : .regular))
                .underline()
                .frame(maxWidth: .infinity, minHeight: 44)
                .foregroundStyle(
                    isOn(option) ? Theme.ink.resolve(scheme) : Theme.ink2.resolve(scheme)
                )
        }
        .buttonStyle(.plain)
        .contentShape(Rectangle())
        .accessibilityAddTraits(isOn(option) ? [.isButton, .isSelected] : [.isButton])
    }

    /// The label and its secondary text as one phrase, so a screen reader hears the whole option.
    private func spoken(_ option: AnswerOption) -> String {
        guard let sub = option.sub else { return option.label }
        return "\(option.label), \(sub)"
    }
}
