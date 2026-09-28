import SwiftUI

/// The optional research survey: the opt-in gate, then the demographic questions, in the survey
/// page's words.
///
/// Mirrors `apps/web/src/routes/survey/+page.svelte`, and draws the step the web's survey is on.
/// Every tick, answer and step is the web's to take (`$lib/survey-flow`): the screen asks, and the
/// web offers the route again at the step it then shows. Consent is never held here, and nothing is
/// uploaded from here. The privacy policy and the terms open over the gate, as the page opens them,
/// so reading them does not leave the survey.
struct SurveyView: View {
    @Environment(\.colorScheme) private var scheme

    let wording: SurveyWording
    let step: SurveyStep
    /// The documents the gate opens over itself, by the route each is linked by.
    let documents: [String: DocumentLayout]
    let onAction: (ScreenAction, String?) -> Void
    let onExit: (String) -> Void

    @State private var reading: ReadDocument?

    var body: some View {
        VStack(spacing: 0) {
            StaleNotice()
            TopBar(label: wording.top.label, backLabel: wording.top.back ?? "", onBack: { onAction(.surveyBack, step.key) })
            if case let .question(question) = step {
                QuizProgress(
                    value: question.position,
                    total: question.total,
                    label: wording.text(.progress),
                    spokenValue: (Double(question.position) / Double(max(1, question.total))).formatted(.percent.precision(.fractionLength(0)))
                )
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    switch step {
                    case let .gate(gate): SurveyGate(wording: wording, gate: gate, open: open, onAction: onAction, onExit: onExit)
                    case let .question(question): SurveyQuestion(wording: wording, question: question, onAction: onAction)
                    }
                    SiteFooter()
                        .padding(.top, 40)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Theme.gutter)
                .padding(.vertical, 12)
            }
            // Each step starts at its top, as each question does on the page.
            .id(step.key)
        }
        .background(Theme.paper.resolve(scheme))
        .foregroundStyle(Theme.ink.resolve(scheme))
        .tint(Theme.ink.resolve(scheme))
        .sheet(item: $reading) { document in
            // Leaving the document for another page leaves the survey too, as it does on the web.
            DocumentView(
                layout: document.layout,
                anchor: nil,
                onExit: { href in
                    reading = nil
                    onExit(href)
                },
                onBack: { reading = nil },
                // It closes the document, as the page's dialog does, so it is named as that dialog names it.
                backLabel: wording.close(document.layout.title)
            )
        }
    }

    /// Opens a document the gate links over the gate; any other route is left for.
    private func open(_ href: String) {
        if let layout = documents[href] {
            reading = ReadDocument(href: href, layout: layout)
        } else {
            onExit(href)
        }
    }
}

private struct ReadDocument: Identifiable {
    let href: String
    let layout: DocumentLayout
    var id: String { href }
}

/// The opt-in gate: what is collected, the three decisions, and the two ways on.
private struct SurveyGate: View {
    @Environment(\.colorScheme) private var scheme

    let wording: SurveyWording
    let gate: SurveyStep.Gate
    let open: (String) -> Void
    let onAction: (ScreenAction, String?) -> Void
    let onExit: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(wording.text(.ready))
                .font(.caption.weight(.semibold))
                .textCase(.uppercase)
                .kerning(1.4)
                .foregroundStyle(Theme.ink2.resolve(scheme))
            Text(wording.text(gate.archived ? .archivedTitle : .liveTitle))
                .font(.title.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.vertical, 10)
                .accessibilityAddTraits(.isHeader)
            ProjectedBlocks(layout: wording.notes(archived: gate.archived, year: gate.year), onLink: open)
                .font(.footnote)
                .foregroundStyle(Theme.ink2.resolve(scheme))
                .padding(.bottom, 12)

            ConsentBox(on: gate.consented, spoken: wording.text(gate.archived ? .archivedConsent : .liveConsent)) {
                onAction(.surveyConsent, $0 ? "1" : "0")
            } label: {
                Text(wording.text(gate.archived ? .archivedConsent : .liveConsent))
            }
            // Separate, and not required to contribute: left unticked, those questions are not asked.
            ConsentBox(on: gate.sensitive, spoken: wording.text(.sensitiveConsent)) {
                onAction(.surveySensitive, $0 ? "1" : "0")
            } label: {
                Text(wording.text(.sensitiveConsent))
            }
            if gate.termsNeeded {
                let terms = wording.terms
                // Its label is heard as well as the box: it holds the link to the terms.
                ConsentBox(on: gate.terms, spoken: terms.spoken, labelHeard: true) {
                    onAction(.surveyTerms, $0 ? "1" : "0")
                } label: {
                    ProjectedBlocks(layout: terms.layout, onLink: open)
                }
            }

            VStack(spacing: 10) {
                // Inert until the web's own rule allows a contribution.
                Button(wording.text(.contribute)) { onAction(.surveyContribute, nil) }
                    .buttonStyle(PrimaryButton())
                    .disabled(!gate.canContribute)
                    .opacity(gate.canContribute ? 1 : 0.45)
                // Never gated: skipping research uploads nothing, and goes straight to the plan.
                Button(wording.text(gate.inFlight ? .skipPlan : .skipComparison)) { onExit("/card") }
                    .font(.callout.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .overlay(RoundedRectangle(cornerRadius: Theme.radius).strokeBorder(Theme.rule.resolve(scheme), lineWidth: 1.5))
                    .buttonStyle(.plain)
            }
            .padding(.top, 20)
        }
    }
}

/// One of the gate's checkboxes, ticked as the web holds it, asking the web to change it.
private struct ConsentBox<Label: View>: View {
    @Environment(\.colorScheme) private var scheme

    let on: Bool
    /// What VoiceOver reads for it.
    let spoken: String
    /// Whether VoiceOver also reaches the label, for one that holds a link.
    var labelHeard = false
    let set: (Bool) -> Void
    @ViewBuilder let label: () -> Label

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Button { set(!on) } label: {
                RoundedRectangle(cornerRadius: 4)
                    .strokeBorder(Theme.ink.resolve(scheme), lineWidth: 1.5)
                    .background(RoundedRectangle(cornerRadius: 4).fill(on ? Theme.ink.resolve(scheme) : Color.clear))
                    .overlay {
                        if on {
                            Image(systemName: "checkmark")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(Theme.onFill.resolve(scheme))
                        }
                    }
                    .frame(width: 22, height: 22)
                    .frame(width: 44, height: 44, alignment: .topLeading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            // A checkbox, as the page's is: read as a switch, on or off, set by the same action.
            .accessibilityRepresentation {
                Toggle(isOn: Binding(get: { on }, set: { set($0) })) { Text(spoken) }
            }
            label()
                .font(.footnote)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)
                .accessibilityHidden(!labelHeard)
        }
        .padding(.vertical, 4)
    }
}

/// A demographic question: its answers, and a way to give none.
private struct SurveyQuestion: View {
    @Environment(\.colorScheme) private var scheme

    let wording: SurveyWording
    let question: SurveyStep.Question
    let onAction: (ScreenAction, String?) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(question.label)
                .font(.title2.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .frame(minHeight: 60, alignment: .topLeading)
                .accessibilityAddTraits(.isHeader)
            // Always drawn, empty where there is no note, so the answers keep their place.
            Text(question.note)
                .font(.footnote)
                .foregroundStyle(Theme.ink2.resolve(scheme))
                .frame(minHeight: 18, alignment: .topLeading)
            FlowLayout(spacing: 8, lineSpacing: 8, centred: false) {
                ForEach(question.options, id: \.self) { option in
                    Button { onAction(.surveyChoose, SurveyStep.answer(question, option)) } label: {
                        Text(option)
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 16)
                            .frame(minHeight: 44)
                            .background(Capsule().fill(Theme.raise.resolve(scheme)))
                            .overlay(Capsule().strokeBorder(Theme.rule.resolve(scheme), lineWidth: 1.5))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.top, 14)
            // After every question's answers, whatever the question: answering is always optional.
            Button(wording.text(.prefer)) { onAction(.surveyChoose, SurveyStep.answer(question, "")) }
                .font(.footnote)
                .underline()
                .foregroundStyle(Theme.ink2.resolve(scheme))
                .buttonStyle(.plain)
                .frame(minHeight: 44)
                .padding(.top, 18)
        }
    }
}
