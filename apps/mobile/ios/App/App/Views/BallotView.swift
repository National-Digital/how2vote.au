import SwiftUI

/// Where you vote: state, then electorate, then a confirmation with the boundary drawn.
///
/// Mirrors `apps/web/src/routes/ballot/+page.svelte`. The electorate list and its order come from
/// the shared engine, not from Swift — `localeCompare` and `String.compare` need not agree at the
/// edges, and a picker that ordered names differently from the web would be a channel difference
/// with nothing behind it.
struct BallotView: View {
    @Environment(\.colorScheme) private var scheme

    @StateObject private var model: BallotViewModel

    private let electionID: String
    /// Map ids the emergency levers allow, resolved by the WebView and handed over (ADR 0018 D10a).
    private let allowedMapIDs: Set<String>
    private let onExit: (String) -> Void

    init(
        model: BallotViewModel,
        electionID: String,
        allowedMapIDs: Set<String>,
        onExit: @escaping (String) -> Void
    ) {
        _model = StateObject(wrappedValue: model)
        self.electionID = electionID
        self.allowedMapIDs = allowedMapIDs
        self.onExit = onExit
    }

    var body: some View {
        VStack(spacing: 0) {
            TopBar(
                label: "Your ballot · \(model.stepNumber) of 3",
                backLabel: "Back",
                onBack: { if let path = model.back() { onExit(path) } }
            )
            QuizProgress(value: model.stepNumber, total: 3)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    switch model.step {
                    case .state: statePicker
                    case .electorate: electoratePicker
                    case .confirm: confirmation
                    }
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
            Text("Where will you vote?")
                .font(.title2.weight(.semibold))
                .foregroundStyle(Theme.ink.resolve(scheme))
                .padding(.vertical, 8)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                ForEach(Jurisdictions.picker, id: \.code) { jurisdiction in
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
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(jurisdiction.name)
                }
            }
            .padding(.top, 8)

            Text("Your answers stay on this device until you choose to share your card.")
                .font(.footnote)
                .foregroundStyle(Theme.ink2.resolve(scheme))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 16)
        }
    }

    private var electoratePicker: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Your federal electorate")
                .font(.title2.weight(.semibold))
                .foregroundStyle(Theme.ink.resolve(scheme))
                .padding(.vertical, 8)

            if model.loadFailed {
                Text("Couldn't load the electorate list.")
                    .font(.footnote)
                    .foregroundStyle(Theme.ink.resolve(scheme))
            } else {
                TextField(
                    "Search \(model.electorateCount) \(model.chosenState ?? "") electorates…",
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
                .accessibilityLabel("Search electorates")

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
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Theme.ink.resolve(scheme))
                        // The row shows the electorate beside the state it is in; read as one
                        // phrase it is the answer to "which electorate is this", rather than two
                        // announcements a voter has to join up.
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(
                            model.chosenState.map { "\(name), \(Jurisdictions.name(for: $0))" }
                                ?? name
                        )
                        Divider().overlay(Theme.line.resolve(scheme))
                    }
                }
                .padding(.top, 8)

                if model.visibleElectorates.isEmpty {
                    Text("No electorate matches “\(model.filter)”.")
                        .font(.footnote)
                        .foregroundStyle(Theme.ink2.resolve(scheme))
                        .padding(.top, 12)
                }

                HStack(spacing: 4) {
                    Text("Not sure?")
                        .font(.footnote)
                        .foregroundStyle(Theme.ink2.resolve(scheme))
                    ExternalLinkView(
                        title: "Look up your electorate on the AEC website",
                        url: URL(string: "https://check.aec.gov.au/")!
                    )
                    .font(.footnote)
                }
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
                Text("Federal electorate in \(Jurisdictions.name(for: state))")
                    .font(.footnote)
                    .foregroundStyle(Theme.ink2.resolve(scheme))
                    .padding(.bottom, 12)

                if let map = StateMapLoader.load(
                    electionID: electionID,
                    stateCode: state,
                    allowedMapIDs: allowedMapIDs
                ) {
                    ElectorateMapView(map: map, electorate: electorate)
                        .padding(.bottom, 16)
                }

                Button("This is my electorate — start") {
                    if let path = model.confirm() { onExit(path) }
                }
                .buttonStyle(PrimaryButton())

                Button("Choose a different electorate") {
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
