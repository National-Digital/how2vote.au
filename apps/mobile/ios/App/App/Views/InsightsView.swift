import SwiftUI

/// The survey's published aggregates, by election, cohort and region, in the Insights page's words.
///
/// Mirrors `apps/web/src/routes/insights/+page.svelte`. Every figure is the web's, derived by the
/// page's own functions and handed over with the route; the screen chooses which to show, as the
/// page's buttons do, and closes for election day in the windows the web names. When a close the
/// route was handed in ends, the screen asks the web for the figures it now shows.
struct InsightsView: View {
    let wording: InsightsWording
    let data: InsightsData
    /// Asks the web to offer the route again, with the figures a reopened page reads.
    let onRefresh: () -> Void
    let onExit: (String) -> Void

    @State private var election: String?
    @State private var cohort: String?
    @State private var regions: [String: String?] = [:]
    @State private var refreshed = false

    private var selected: InsightsData.Election? {
        let id = election ?? data.initial
        return data.elections?.first { $0.id == id }
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            let closed = data.closed || data.isClosed(at: context.date)
            DocumentView(
                layout: wording.head(closed: closed, minimum: selected?.stats.map { String($0.minCell) } ?? wording.defaultMinimum),
                anchor: nil,
                onExit: onExit,
                form: AnyView(
                    InsightsFigures(
                        wording: wording,
                        data: data,
                        closed: closed,
                        selected: selected,
                        election: $election,
                        cohort: $cohort,
                        regions: $regions
                    )
                )
            )
            // Handed over closed, with no figures, and now open: the web reads them.
            .task(id: data.closed && !data.isClosed(at: context.date)) {
                guard data.closed, !data.isClosed(at: context.date), !refreshed else { return }
                refreshed = true
                onRefresh()
            }
        }
    }
}

/// Everything beneath the lead: the closing notice, or the choices and the figures they select.
private struct InsightsFigures: View {
    @Environment(\.colorScheme) private var scheme

    let wording: InsightsWording
    let data: InsightsData
    let closed: Bool
    let selected: InsightsData.Election?
    @Binding var election: String?
    @Binding var cohort: String?
    @Binding var regions: [String: String?]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if closed {
                closedNotice
            } else if data.failed {
                quiet(wording.text(.failed), size: .body)
            } else if let elections = data.elections, let selected {
                if elections.count > 1 {
                    Pills(
                        label: wording.text(.elections),
                        options: elections.map { ($0.id, $0.pill, $0.published) },
                        selected: selected.id
                    ) { id in
                        // The election already shown keeps the cohort and regions chosen in it.
                        guard id != selected.id else { return }
                        election = id
                        cohort = nil
                        regions = [:]
                    }
                }
                if let stats = selected.stats, stats.published {
                    published(selected, stats)
                } else {
                    quiet(
                        selected.upcoming ? wording.text(.upcoming, ["election": selected.label]) : wording.text(.empty),
                        size: .body
                    )
                }
            }
        }
    }

    private var closedNotice: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(wording.text(.closedTitle))
                .font(.subheadline.weight(.bold))
                .accessibilityAddTraits(.isHeader)
            Text(closedLine)
                .font(.footnote)
                .foregroundStyle(Theme.ink2.resolve(scheme))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 20)
        .padding(.horizontal, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: Theme.radius).strokeBorder(Theme.rule.resolve(scheme), lineWidth: 1.5))
        .accessibilityElement(children: .combine)
    }

    /// The closing notice with its time set in bold, as the page sets it.
    private var closedLine: AttributedString {
        var time = AttributedString(wording.text(.closedTime))
        time.font = .footnote.weight(.bold)
        time.foregroundColor = Theme.ink.resolve(scheme)
        let (before, after) = wording.closed
        return AttributedString(before) + time + AttributedString(after)
    }

    @ViewBuilder
    private func published(_ election: InsightsData.Election, _ stats: InsightsData.Stats) -> some View {
        let active = stats.cohorts.first { $0.key == cohort } ?? stats.cohorts.first
        if let provenance = election.provenance {
            Text(provenance)
                .font(.footnote)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.leading, 10)
                .overlay(alignment: .leading) { Rectangle().fill(Theme.ink.resolve(scheme)).frame(width: 2) }
        }
        if stats.cohorts.count > 1, let active {
            Pills(
                label: wording.text(.cohorts),
                options: stats.cohorts.map { ($0.key, $0.label, true) },
                selected: active.key,
                small: true
            ) { key in cohort = key }
        }
        quiet(wording.text(.updated, [
            "election": stats.label,
            "date": stats.updated,
            "count": active?.total ?? String(0),
        ]))
        if let active {
            if !active.disclosure.isEmpty {
                quiet(active.disclosure)
                    .padding(.leading, 10)
                    .overlay(alignment: .leading) { Rectangle().fill(Theme.rule.resolve(scheme)).frame(width: 3) }
            }
            if !active.published {
                quiet(wording.text(.withheld), size: .body)
            }
            if !active.parties.isEmpty {
                heading(wording.text(.parties))
                ForEach(active.parties) { party in
                    PartyFigures(wording: wording, party: party, region: regionBinding(party.id))
                }
            }
            if !active.propositions.isEmpty {
                heading(wording.text(.propositions))
                legend
                ForEach(active.propositions) { proposition in
                    PropositionFigures(wording: wording, proposition: proposition)
                }
            }
            if !active.parties.isEmpty || !active.propositions.isEmpty {
                Divider().overlay(Theme.line.resolve(scheme)).padding(.top, 10)
                quiet(wording.text(.footnote))
            }
        }
    }

    private func regionBinding(_ view: String) -> Binding<String?> {
        Binding(get: { regions[view] ?? nil }, set: { regions[view] = $0 })
    }

    private func heading(_ text: String) -> some View {
        Text(text)
            .font(.title3.weight(.semibold))
            .padding(.top, 10)
            .accessibilityAddTraits(.isHeader)
    }

    /// The key to the three shades, as the page draws it: seen, not heard, as each bar is named.
    private var legend: some View {
        HStack(spacing: 16) {
            ForEach(Array([(wording.text(.agree), 1.0), (wording.text(.neutral), 0.5), (wording.text(.disagree), 0.22)].enumerated()), id: \.offset) { _, key in
                HStack(spacing: 6) {
                    RoundedRectangle(cornerRadius: 3).fill(Theme.ink.resolve(scheme)).opacity(key.1).frame(width: 12, height: 12)
                    Text(key.0)
                }
            }
        }
        .font(.caption)
        .foregroundStyle(Theme.ink2.resolve(scheme))
        .accessibilityHidden(true)
    }

    private func quiet(_ text: String, size: Font = .footnote) -> some View {
        Text(text)
            .font(size)
            .foregroundStyle(Theme.ink2.resolve(scheme))
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// A group of buttons, one pressed: the elections, the cohorts, or a view's regions.
private struct Pills: View {
    @Environment(\.colorScheme) private var scheme

    let label: String
    /// Each option's key, its name, and whether it has published figures.
    let options: [(key: String, name: String, published: Bool)]
    let selected: String
    var small = false
    let choose: (String) -> Void

    var body: some View {
        FlowLayout(spacing: small ? 6 : 8, lineSpacing: small ? 6 : 8, centred: false) {
            ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                let on = option.key == selected
                Button { choose(option.key) } label: {
                    Text(option.name)
                        .font((small ? Font.caption : .footnote).weight(.semibold))
                        .padding(.horizontal, small ? 12 : 16)
                        .frame(minHeight: small ? 36 : 40)
                        .foregroundStyle((on ? Theme.onFill : Theme.ink).resolve(scheme))
                        .background(Capsule().fill(on ? Theme.ink.resolve(scheme) : Color.clear))
                        .overlay(
                            Capsule().strokeBorder(
                                Theme.rule.resolve(scheme),
                                style: StrokeStyle(lineWidth: 1.5, dash: option.published || on ? [] : [4, 3])
                            )
                        )
                }
                .buttonStyle(.plain)
                // Pressed or not, as the page's `aria-pressed` reads.
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }
}

/// A party view: its title, its regions where it has more than one, and a bar per cell of each bucket.
private struct PartyFigures: View {
    @Environment(\.colorScheme) private var scheme

    let wording: InsightsWording
    let party: InsightsData.Party
    @Binding var region: String?

    var body: some View {
        let geo = party.geos.first { $0.code == region } ?? party.geos.first
        VStack(alignment: .leading, spacing: 10) {
            Text(party.title)
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            if party.geos.count > 1, let geo {
                Pills(
                    label: wording.text(.regions),
                    options: party.geos.map { ($0.id, $0.national ? wording.text(.national) : $0.label, true) },
                    selected: geo.id,
                    small: true
                ) { id in region = party.geos.first { $0.id == id }?.code }
            }
            if let geo {
                ForEach(geo.buckets) { bucket in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(bucket.label)
                            .font(.caption.weight(.semibold))
                            .accessibilityAddTraits(.isHeader)
                        ForEach(Array(bucket.cells.enumerated()), id: \.offset) { _, cell in
                            VStack(alignment: .leading, spacing: 3) {
                                HStack {
                                    Text(cell.label)
                                    Spacer(minLength: 8)
                                    Text("\(cell.pct)%")
                                        .monospacedDigit()
                                }
                                .font(.footnote)
                                .accessibilityHidden(true)
                                Bar(parts: [(Double(cell.pct), 1)], height: 8)
                                    .accessibilityElement()
                                    .accessibilityAddTraits(.isImage)
                                    .accessibilityLabel(wording.text(.bar, [
                                        "label": cell.label, "pct": String(cell.pct), "shown": String(bucket.shown),
                                    ]))
                            }
                        }
                        Text(wording.text(.of, ["shown": bucket.shownText]))
                            .font(.caption2)
                            .foregroundStyle(Theme.ink2.resolve(scheme))
                    }
                }
            }
        }
        .padding(.top, 6)
    }
}

/// An issue: its proposition, one segmented bar of agree, neutral and disagree, and their shares.
private struct PropositionFigures: View {
    @Environment(\.colorScheme) private var scheme

    let wording: InsightsWording
    let proposition: InsightsData.Proposition

    var body: some View {
        let values = [
            "agree": String(proposition.agree), "neutral": String(proposition.neutral),
            "disagree": String(proposition.disagree),
        ]
        VStack(alignment: .leading, spacing: 6) {
            Text(proposition.title)
                .font(.subheadline)
                .fixedSize(horizontal: false, vertical: true)
            Bar(parts: [(Double(proposition.agree), 1), (Double(proposition.neutral), 0.5), (Double(proposition.disagree), 0.22)], height: 10)
                .accessibilityElement()
                .accessibilityAddTraits(.isImage)
                .accessibilityLabel(wording.text(.split, values.merging(["shown": String(proposition.shown)]) { a, _ in a }))
            Text(wording.text(.tally, values.merging(["shown": proposition.shownText]) { a, _ in a }))
                .font(.caption2)
                .foregroundStyle(Theme.ink2.resolve(scheme))
        }
        .padding(.bottom, 6)
    }
}

/// A bar of shares in one ink, each told apart by its shade alone — never a hue — over a wash.
private struct Bar: View {
    @Environment(\.colorScheme) private var scheme

    /// Each share in per cent, and the shade it is drawn in.
    let parts: [(pct: Double, opacity: Double)]
    let height: CGFloat

    var body: some View {
        // Rounded shares can sum past 100; like the page's flex bar, they then shrink to fit.
        let whole = max(100, parts.map(\.pct).reduce(0, +))
        GeometryReader { proxy in
            HStack(spacing: 0) {
                ForEach(Array(parts.enumerated()), id: \.offset) { _, part in
                    if part.pct > 0 {
                        Rectangle()
                            .fill(Theme.ink.resolve(scheme))
                            .opacity(part.opacity)
                            .frame(width: proxy.size.width * part.pct / whole)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .frame(height: height)
        .background(Theme.wash.resolve(scheme))
        .clipShape(Capsule())
    }
}
