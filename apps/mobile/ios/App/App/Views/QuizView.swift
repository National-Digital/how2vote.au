import SwiftUI
import UIKit

/// The questionnaire, natively.
///
/// Mirrors `apps/web/src/routes/quiz/+page.svelte`: one question at a time, the answer scale beneath
/// it, a progress bar, and a confirmation beat before advancing. ADR 0018 D10 sets the visual bar at
/// the same design language rather than pixel parity.
///
/// Two properties are load-bearing and neither is cosmetic:
///
///   * **The question block reserves a constant height.** Sizing it to the question would move the
///     answer options between questions, so a voter answering quickly lands on a different option
///     from the one they were reaching for. The web reserves the same space for the same reason.
///   * **Progress is saved through ``QuizState``**, which fails closed without the 18+ declaration
///     (ADR 0011) and writes the record the WebView reads. A voter who leaves mid-quiz and returns
///     — in the app or in a document route — resumes where they were.
struct QuizView: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @StateObject private var model: QuizViewModel

    /// Every word the screen shows or speaks, from the web's quiz page.
    private let wording: QuizWording
    /// The screen to show when the voter leaves the quiz, forwards or backwards.
    private let onExit: (QuizExit) -> Void

    init(model: QuizViewModel, wording: QuizWording, onExit: @escaping (QuizExit) -> Void) {
        _model = StateObject(wrappedValue: model)
        self.wording = wording
        self.onExit = onExit
    }

    var body: some View {
        VStack(spacing: 0) {
            StaleNotice()
            TopBar(
                label: wording.position(model.cursor + 1, of: model.total),
                backLabel: wording.text(model.isEditing ? .backToAnswers : .previous),
                onBack: back,
                trailing: (wording.text(.pause), { onExit(.pause) })
            )
            QuizProgress(
                value: model.cursor + 1,
                total: model.total,
                label: wording.text(.progress),
                spokenValue: wording.position(model.cursor + 1, of: model.total)
            )

            // Scrolls only where the screen is too short for it — a small phone, large Dynamic Type,
            // or a stale-data notice above — so no answer is ever out of reach.
            ScrollView {
                VStack(spacing: 0) {
                    content
                        .frame(maxWidth: .infinity, alignment: .top)
                        .padding(.top, 12)
                        .padding(.bottom, 16)
                    // The whole footer, as on the web's quiz: the authorisation, and the data
                    // licence credit the questions are built on.
                    SiteFooter()
                        .padding(.top, 24)
                }
                .padding(.horizontal, Theme.gutter)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        // The web's ← shortcut. Invisible rather than hidden, which would drop the shortcut too.
        .background {
            Button(wording.text(.previous), action: back)
                .keyboardShortcut(.leftArrow, modifiers: [])
                .opacity(0)
                .accessibilityHidden(true)
        }
        .background(Theme.paper.resolve(scheme))
        .task { await model.load() }
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .loading:
            Text(wording.text(.loading))
                .kicker(Theme.ink2.resolve(scheme))
                .accessibilityAddTraits(.updatesFrequently)

        case .failed:
            // The web's sentence, whose "try again" is its link: here the sentence is the button.
            Button { Task { await model.load() } } label: {
                Text(wording.failed)
                    .kicker(Theme.ink2.resolve(scheme))
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
            .buttonStyle(.plain)

        case let .ready(question):
            questionBody(question)
        }
    }

    private func questionBody(_ question: Question) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                if model.cursor == 0, let provenance = model.provenance {
                    ProvenanceNotice(statement: provenance)
                }
                Text(wording.text(.voted))
                    .kicker(Theme.ink2.resolve(scheme))
                    .padding(.top, 6)
                    .padding(.bottom, 8)
                Text(question.text)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Theme.ink.resolve(scheme))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                ExternalLinkView(
                    title: wording.text(.source),
                    url: model.sourceURL(for: question)
                )
                .font(.caption)
                .padding(.top, 10)
            }
            // Reserved so the options below sit in the same place on every question. A minimum, not
            // a fixed height: at large Dynamic Type sizes the block has to be allowed to grow.
            .frame(minHeight: 210, alignment: .top)

            Text(wording.text(.ask))
                .kicker(Theme.ink2.resolve(scheme))
                .padding(.top, 10)
                .padding(.bottom, 8)

            AnswerOptions(
                options: wording.answers,
                label: wording.answersLabel,
                current: model.currentPoints,
                onAnswer: commit
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func commit(_ points: Int) {
        guard !model.isAdvancing else { return }
        model.record(points)
        announce(points)
        // A beat so the selection is visible before the screen changes — skipped under Reduce Motion,
        // where an unrequested delay reads as the app hanging.
        model.advance(after: reduceMotion ? 0 : Theme.confirmDuration, onExit: onExit)
    }

    /// Tells a VoiceOver user what was recorded and where they are going, as the web's live region does.
    private func announce(_ points: Int) {
        let answer = wording.spoken(points)
        let message = model.isEditing
            ? wording.text(.updated, ["answer": answer])
            : wording.text(.answered, [
                "answer": answer,
                "n": String(min(model.cursor + 2, model.total)),
                "total": String(model.total),
            ])
        UIAccessibility.post(notification: .announcement, argument: message)
    }

    private func back() {
        if let exit = model.stepBack() { onExit(exit) }
    }
}

/// The election's data-provenance disclosure.
///
/// The statement is generated into the dataset manifest, so the quiz and the analysis pages carry
/// the same wording and the same retrieval date and neither can drift from the other. It is a
/// required disclosure, so it is kept plainly legible rather than dimmed like an aside.
struct ProvenanceNotice: View {
    @Environment(\.colorScheme) private var scheme

    let statement: String

    var body: some View {
        Text(statement)
            .font(.footnote)
            .foregroundStyle(Theme.ink.resolve(scheme))
            .fixedSize(horizontal: false, vertical: true)
            .padding(.leading, 12)
            .padding(.vertical, 8)
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(Theme.ink.resolve(scheme))
                    .frame(width: 2)
            }
            .padding(.vertical, 4)
    }
}
