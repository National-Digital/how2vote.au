import SwiftUI

/// Where you vote: state, then electorate, then a confirmation with the boundary drawn.
///
/// Mirrors `apps/web/src/routes/ballot/+page.svelte`, in the web's words: every piece of wording,
/// the states offered and their order are ``BallotWording``'s, read from the page. The electorate list and its order come from
/// the shared engine, not from Swift — `localeCompare` and `String.compare` need not agree at the
/// edges, and a picker that ordered names differently from the web would be a channel difference
/// with nothing behind it.
struct BallotView: View {
    @Environment(\.colorScheme) private var scheme

    @StateObject private var model: BallotViewModel

    private let wording: BallotWording
    private let electionID: String
    /// Map ids the emergency levers allow, resolved by the WebView and handed over (ADR 0018 D10a).
    private let allowedMapIDs: Set<String>
    private let onExit: (String) -> Void

    init(
        model: BallotViewModel,
        wording: BallotWording,
        electionID: String,
        allowedMapIDs: Set<String>,
        onExit: @escaping (String) -> Void
    ) {
        _model = StateObject(wrappedValue: model)
        self.wording = wording
        self.electionID = electionID
        self.allowedMapIDs = allowedMapIDs
        self.onExit = onExit
    }

    var body: some View {
        VStack(spacing: 0) {
            StaleNotice()
            TopBar(
                label: wording.position(model.stepNumber, of: 3),
                backLabel: wording.text(.back),
                onBack: { if let path = model.back() { onExit(path) } }
            )
            QuizProgress(
                value: model.stepNumber,
                total: 3,
                label: wording.text(.progress),
                spokenValue: wording.position(model.stepNumber, of: 3)
            )

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    switch model.step {
                    case .state: statePicker
                    case .electorate: electoratePicker
                    case .confirm: confirmation
                    }

                    if model.saveFailed {
                        Text(wording.text(.unsaved))
                            .font(.footnote)
                            .foregroundStyle(Theme.ink.resolve(scheme))
                            .padding(.top, 12)
                            .accessibilityAddTraits(.updatesFrequently)
                    }

                    SiteFooter()
                        .padding(.top, 24)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Theme.gutter)
                .padding(.bottom, 20)
            }
        }
        .background(Theme.paper.resolve(scheme))
        .task {
            // A provisional election ships no ballot, so there is nothing to pick: record the
            // sentinel and move on before any picker can flash.
            if model.isElectorateLess, let path = model.skipToQuestions() { onExit(path) }
        }
    }

    private var statePicker: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(wording.text(.pick))
                .font(.title2.weight(.semibold))
                .foregroundStyle(Theme.ink.resolve(scheme))
                .padding(.vertical, 8)
                .accessibilityAddTraits(.isHeader)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                ForEach(wording.states, id: \.code) { jurisdiction in
                    Button {
                        model.pick(state: jurisdiction.code)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(jurisdiction.code)
                                .font(.headline)
                            Text(jurisdiction.name)
                                .font(.caption)
                                .foregroundStyle(Theme.ink2.resolve(scheme))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                        .padding(12)
                        .background(
                            RoundedRectangle(cornerRadius: Theme.radius)
                                .fill(Theme.raise.resolve(scheme))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: Theme.radius)
                                .strokeBorder(Theme.line.resolve(scheme), lineWidth: 1)
                        )
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.ink.resolve(scheme))
                    // One element reading the jurisdiction's name. Left to its children, VoiceOver
                    // announces the code and then the name, and reads an initialism like "ACT" as
                    // a word.
                    .accessibilityLabel(jurisdiction.name)
                }
            }
            .padding(.top, 8)

            Text(wording.text(.device))
                .font(.footnote)
                .foregroundStyle(Theme.ink2.resolve(scheme))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 16)
        }
    }

    private var electoratePicker: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(wording.text(.electorate))
                .font(.title2.weight(.semibold))
                .foregroundStyle(Theme.ink.resolve(scheme))
                .padding(.vertical, 8)
                .accessibilityAddTraits(.isHeader)

            if model.loadFailed {
                // The web's sentence, whose "try again" retries: one control, read as the page reads.
                Button {
                    if let state = model.chosenState { model.pick(state: state) }
                } label: {
                    Text(wording.failed)
                        .font(.footnote)
                        .foregroundStyle(Theme.ink.resolve(scheme))
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(minHeight: 44, alignment: .leading)
                }
                .buttonStyle(.plain)
            } else {
                TextField(
                    wording.text(.search, ["count": String(model.electorateCount), "code": model.chosenState ?? ""]),
                    text: $model.filter
                )
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.words)
                .padding(12)
                .background(
                    RoundedRectangle(cornerRadius: Theme.radius).fill(Theme.raise.resolve(scheme))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.radius)
                        .strokeBorder(Theme.line.resolve(scheme), lineWidth: 1)
                )
                .accessibilityLabel(wording.text(.searchLabel))

                LazyVStack(spacing: 0) {
                    ForEach(model.visibleElectorates, id: \.self) { name in
                        Button {
                            model.pick(electorate: name)
                        } label: {
                            HStack {
                                Text(name)
                                    .font(.subheadline.weight(.semibold))
                                Spacer(minLength: 8)
                                Text(model.chosenState ?? "")
                                    .font(.caption)
                                    .foregroundStyle(Theme.ink2.resolve(scheme))
                            }
                            .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                            // The whole row takes the tap, not only its words: a plain button is
                            // otherwise hit only where it draws, and the gap between the two is empty.
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Theme.ink.resolve(scheme))
                        // The row shows the electorate beside the state it is in; read as one
                        // phrase it is the answer to "which electorate is this", rather than two
                        // announcements a voter has to join up.
                        .accessibilityLabel(
                            model.chosenState.map { "\(name), \(wording.name(for: $0))" }
                                ?? name
                        )
                        Divider().overlay(Theme.line.resolve(scheme))
                    }
                }
                .padding(.top, 8)

                if model.visibleElectorates.isEmpty {
                    Text(wording.text(.none, ["filter": model.filter]))
                        .font(.footnote)
                        .foregroundStyle(Theme.ink2.resolve(scheme))
                        .padding(.top, 12)
                }

                FlowLayout(spacing: 4, lineSpacing: 0, centred: false) {
                    let unsure = wording.around(.unsure)
                    Text(unsure.before.trimmingCharacters(in: .whitespaces))
                        .foregroundStyle(Theme.ink2.resolve(scheme))
                    ExternalLinkView(title: wording.text(.lookup), url: wording.lookupURL)
                    Text(unsure.after.trimmingCharacters(in: .whitespaces))
                        .foregroundStyle(Theme.ink2.resolve(scheme))
                }
                .font(.footnote)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 16)
            }
        }
    }

    @ViewBuilder private var confirmation: some View {
        if let state = model.chosenState, let electorate = model.chosenElectorate {
            VStack(alignment: .leading, spacing: 0) {
                Text(electorate)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(Theme.ink.resolve(scheme))
                    .padding(.vertical, 8)
                    .accessibilityAddTraits(.isHeader)
                Text(wording.text(.located, ["state": wording.name(for: state)]))
                    .font(.footnote)
                    .foregroundStyle(Theme.ink2.resolve(scheme))
                    .padding(.bottom, 12)

                if let map = StateMapLoader.load(
                    electionID: electionID,
                    stateCode: state,
                    allowedMapIDs: allowedMapIDs
                ) {
                    ElectorateMapView(
                        map: map,
                        electorate: electorate,
                        label: wording.text(.map, ["state": wording.name(for: state), "electorate": electorate])
                    )
                        .padding(.bottom, 16)
                }

                Button(wording.text(.start)) {
                    if let path = model.confirm() { onExit(path) }
                }
                .buttonStyle(PrimaryButton())

                Button(wording.text(.different)) {
                    _ = model.back()
                }
                .font(.footnote)
                .underline()
                .foregroundStyle(Theme.ink2.resolve(scheme))
                .frame(maxWidth: .infinity, minHeight: 44)
            }
        }
    }
}
