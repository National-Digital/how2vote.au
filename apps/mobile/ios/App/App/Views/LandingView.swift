import SwiftUI
import UIKit

/// The first screen: what this is, and the way in.
///
/// Mirrors `apps/web/src/lib/components/Landing.svelte`. Every claim it makes about the comparison —
/// what it is built from, that the method is public, what a provisional or historical comparison
/// means — is `LegalCopy`, generated from `docs/legal/native-copy.json` and held verbatim to the web
/// component. None of it is authored here, so the first screen of the app cannot say something the
/// web's registers have not reviewed.
struct LandingView: View {
    @Environment(\.colorScheme) private var scheme

    @StateObject private var model: LandingViewModel

    /// True for a visitor who may enter the quiz — an adult, or an under-18 exploring this session.
    /// Anyone else is sent to the age gate, which is the WebView's (ADR 0011).
    private let canExplore: Bool
    private let onExit: (String) -> Void
    private let onToggleTheme: () -> Void

    init(
        model: LandingViewModel,
        canExplore: Bool,
        onToggleTheme: @escaping () -> Void,
        onExit: @escaping (String) -> Void
    ) {
        _model = StateObject(wrappedValue: model)
        self.canExplore = canExplore
        self.onToggleTheme = onToggleTheme
        self.onExit = onExit
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                electionPicker
                headline
                lede
                trust
                steps
                callsToAction
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Theme.gutter)
            .padding(.bottom, 24)
        }
        .background(Theme.paper.resolve(scheme))
        .task { await model.load() }
    }

    /// The lockup's cap height, tracking Dynamic Type from the body metric.
    private var wordmarkHeight: CGFloat {
        UIFontMetrics(forTextStyle: .body).scaledValue(for: 20)
    }

    private var header: some View {
        HStack {
            // The drawn mark, not the name as text — see `Wordmark`. Scaled from the body metric
            // so it grows with Dynamic Type instead of staying a fixed 20pt while the page around
            // it doubles.
            Wordmark(height: wordmarkHeight, color: Theme.ink.resolve(scheme))
            Spacer()
            Button(action: onToggleTheme) {
                Image(systemName: scheme == .dark ? "moon" : "sun.max")
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.ink2.resolve(scheme))
            .accessibilityLabel(
                scheme == .dark ? "Switch to light theme" : "Switch to dark theme"
            )
        }
        .padding(.top, 8)
    }

    private var electionPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Federal election")
                .kicker(Theme.ink2.resolve(scheme))
            HStack(spacing: 0) {
                ForEach(model.elections) { election in
                    let selected = election.id == model.electionID
                    Button {
                        onExit(election.current ? "/" : "/\(election.id)")
                    } label: {
                        Text(election.shortLabel)
                            .font(.subheadline.weight(selected ? .semibold : .regular))
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .background(selected ? Theme.ink.resolve(scheme) : Color.clear)
                            .foregroundStyle(
                                selected ? Theme.onFill.resolve(scheme) : Theme.ink.resolve(scheme)
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(election.label)
                    .accessibilityAddTraits(selected ? [.isButton, .isSelected] : [.isButton])
                }
            }
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radius)
                    .strokeBorder(Theme.line2.resolve(scheme), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
        }
        .padding(.top, 12)
    }

    private var headline: some View {
        Text("How do your views compare?")
            .font(.largeTitle.weight(.semibold))
            .foregroundStyle(Theme.ink.resolve(scheme))
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 16)
    }

    private var lede: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(model.lede)
                .font(.body)
                .foregroundStyle(Theme.ink2.resolve(scheme))
                .fixedSize(horizontal: false, vertical: true)
            if let caveat = model.caveat {
                Text(caveat)
                    .font(.body)
                    .foregroundStyle(Theme.ink2.resolve(scheme))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.top, 12)
    }

    private var trust: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(
                [
                    LegalCopy.landingTrustRecords,
                    LegalCopy.landingTrustEvenHanded,
                    LegalCopy.landingTrustNoAccount,
                ],
                id: \.self
            ) { claim in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text("✓")
                        .font(.caption)
                        .foregroundStyle(Theme.ink2.resolve(scheme))
                        .accessibilityHidden(true)
                    Text(claim)
                        .font(.subheadline)
                        .foregroundStyle(Theme.ink.resolve(scheme))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(.top, 20)
    }

    private var steps: some View {
        HStack(alignment: .top, spacing: 16) {
            ForEach(model.steps, id: \.name) { step in
                VStack(alignment: .leading, spacing: 2) {
                    Rectangle()
                        .fill(Theme.ink.resolve(scheme))
                        .frame(height: 1)
                        .padding(.bottom, 6)
                    Text(step.name)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Theme.ink.resolve(scheme))
                    Text(step.detail)
                        .font(.caption)
                        .foregroundStyle(Theme.ink2.resolve(scheme))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.top, 24)
    }

    @ViewBuilder private var callsToAction: some View {
        VStack(spacing: 8) {
            switch model.progress {
            case let .partway(answered, total):
                Button("Continue — question \(answered + 1) of \(total)") { onExit("/quiz") }
                    .buttonStyle(PrimaryButton())
                startAgain
            case .complete:
                Button("See my comparison") { onExit("/card") }
                    .buttonStyle(PrimaryButton())
                startAgain
            case .fresh:
                Button("See how my views compare") { begin() }
                    .buttonStyle(PrimaryButton())
                Button("How the matching works") { onExit("/methodology") }
                    .font(.footnote)
                    .underline()
                    .foregroundStyle(Theme.ink2.resolve(scheme))
                    .frame(minHeight: 44)
            }
        }
        .padding(.top, 24)
    }

    private var startAgain: some View {
        Button("Start again") { begin() }
            .font(.footnote)
            .underline()
            .foregroundStyle(Theme.ink2.resolve(scheme))
            .frame(minHeight: 44)
    }

    /// Begins a fresh run.
    ///
    /// The reset has to happen before leaving: a returner who chose "start again" and landed
    /// mid-quiz on their old answers would have been ignored. The age gate is the WebView's, so an
    /// undeclared visitor goes there rather than being asked again here (ADR 0011).
    private func begin() {
        QuizState.clear(electionID: model.electionID)
        onExit(canExplore ? "/ballot" : "/start")
    }
}
