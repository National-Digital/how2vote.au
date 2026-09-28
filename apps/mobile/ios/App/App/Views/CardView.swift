import SwiftUI
import UIKit

/// The comparison card: the parties' voting-record alignment as evidence, and the plan the voter
/// numbers themselves, in the card page's words.
///
/// Mirrors `apps/web/src/routes/card/+page.svelte`, and draws the card the web's flow holds
/// (`$lib/card-flow`). Every rule is the web's: who may build, share or save, what a suspension
/// withholds, the Terms gate and the share warning. The screen asks, and the web offers the route
/// again with the card as it then stands; a share link is the web's answer to a confirmed warning.
/// The corrections and the terms open over the card, as the page opens them.
struct CardView: View {
    @Environment(\.colorScheme) private var scheme

    let wording: CardWording
    let card: CardData
    /// The documents the card opens over itself, by the route each is linked by.
    let documents: [String: DocumentLayout]
    let onAction: (ScreenAction, String?) -> Void
    /// Asks the web for the link to share once its warning is confirmed: empty for none.
    let onShare: () async -> String
    let onExit: (String) -> Void

    @State private var reading: CardDocument?
    @State private var browsing: CardBrowsed?
    @State private var sharing: CardBrowsed?

    var body: some View {
        VStack(spacing: 0) {
            StaleNotice()
            switch card {
            case .error:
                explained(title: .errorTitle, notes: [.errorNote], action: .errorAction, to: "/ballot")
            case .unavailable:
                explained(title: .unavailableTitle, notes: [.unavailableNote], action: .unavailableAction, to: "/")
            case .archivedLink:
                explained(
                    kicker: .archivedLinkKicker,
                    title: .archivedLinkTitle,
                    notes: [.archivedLinkOld, .archivedLinkNow],
                    action: .archivedLinkAction,
                    to: "/ballot"
                )
            case let .ready(ready):
                TopBar(label: ready.stageLabel, backLabel: wording.text(.home), onBack: { onExit("/") })
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        heading(ready)
                        banners(ready)
                        if let plan = ready.plan {
                            CardPlan(wording: wording, ready: ready, plan: plan, open: open, onAction: onAction)
                        } else {
                            CardComparison(wording: wording, ready: ready, open: open, onAction: onAction) {
                                Task {
                                    let link = await onShare()
                                    if let url = URL(string: link), url.scheme == "https" { sharing = CardBrowsed(url: url) }
                                }
                            }
                        }
                        SiteFooter()
                            .padding(.top, 40)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Theme.gutter)
                    .padding(.vertical, 12)
                }
                // A box being numbered commits as the keyboard goes, as the page's box does on blur.
                .scrollDismissesKeyboard(.immediately)
                // Each stage starts at its top, as the page scrolls to the plan's top.
                .id(ready.stage)
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    if ready.plan != nil { band(archived: ready.archived) }
                }
            }
        }
        .background(Theme.paper.resolve(scheme))
        .foregroundStyle(Theme.ink.resolve(scheme))
        .tint(Theme.ink.resolve(scheme))
        .sheet(item: $reading) { document in
            // Leaving the document for another page leaves the card too, as it does on the web.
            DocumentView(
                layout: document.layout,
                anchor: nil,
                onExit: { href in
                    reading = nil
                    onExit(href)
                },
                onBack: { reading = nil },
                backLabel: wording.text(.close, ["title": document.layout.title])
            )
        }
        .sheet(item: $browsing) { page in
            SafariView(url: page.url).ignoresSafeArea()
        }
        .sheet(item: $sharing) { link in
            CardShareSheet(url: link.url) { sharing = nil }
        }
    }

    /// Opens a link from the card: a document the page opens as a dialog over it, a page on the web,
    /// or a route the web moves to.
    private func open(_ href: String) {
        if let layout = documents[href] {
            reading = CardDocument(href: href, layout: layout)
        } else if let url = URL(string: href), url.scheme == "https" {
            browsing = CardBrowsed(url: url)
        } else if href.hasPrefix("/") {
            onExit(href)
        }
    }

    /// A card the page explains instead of drawing: why, and the way on.
    @ViewBuilder
    private func explained(
        kicker: CardWording.Piece? = nil,
        title: CardWording.Piece,
        notes: [CardWording.Piece],
        action: CardWording.Piece,
        to route: String
    ) -> some View {
        TopBar(label: "", backLabel: wording.text(.home), onBack: { onExit("/") })
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let kicker {
                    Text(wording.text(kicker))
                        .font(.caption.weight(.semibold))
                        .textCase(.uppercase)
                        .kerning(1.1)
                        .foregroundStyle(Theme.ink2.resolve(scheme))
                }
                Text(wording.text(title))
                    .font(.title.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                ForEach(notes, id: \.self) { note in
                    Text(wording.text(note))
                        .font(.subheadline)
                        .foregroundStyle(Theme.ink2.resolve(scheme))
                        .fixedSize(horizontal: false, vertical: true)
                }
                Button(wording.text(action)) { onExit(route) }
                    .buttonStyle(PrimaryButton())
                    .padding(.top, 8)
                SiteFooter()
                    .padding(.top, 40)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Theme.gutter)
            .padding(.vertical, 28)
        }
    }

    private func heading(_ ready: CardData.Ready) -> some View {
        (Text(ready.heading) + Text(ready.stateSuffix).font(.subheadline).foregroundStyle(Theme.ink2.resolve(scheme)))
            .font(.title.weight(.semibold))
            .fixedSize(horizontal: false, vertical: true)
            .padding(.bottom, 12)
            .accessibilityAddTraits(.isHeader)
    }

    /// The historical-use warning and the under-review notice, on both stages.
    @ViewBuilder
    private func banners(_ ready: CardData.Ready) -> some View {
        if ready.archived {
            CardNote(layout: wording.layout(.archive, ["label": ready.label, "year": ready.year]), open: open)
        }
        if ready.correction {
            CardNote(layout: wording.layout(.correction), open: open)
        }
    }

    /// The authorisation that travels with the plan's pixels, pinned while the plan is on screen.
    private func band(archived: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if archived {
                Text(wording.text(.bandMarker))
                    .font(.footnote.weight(.bold))
                    .textCase(.uppercase)
            }
            Text(wording.text(.bandAuthorisation))
                .font(.caption)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Theme.gutter)
        .padding(.vertical, 10)
        .foregroundStyle(Theme.onFill.resolve(scheme))
        .background(Theme.ink.resolve(scheme))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(wording.text(.bandLabel))
        .accessibilityIdentifier("card-band")
    }
}

/// The comparison: what it shows, each chamber's parties, the way on, and the evidence behind it.
private struct CardComparison: View {
    @Environment(\.colorScheme) private var scheme

    let wording: CardWording
    let ready: CardData.Ready
    let open: (String) -> Void
    let onAction: (ScreenAction, String?) -> Void
    let onShare: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ProjectedBlocks(layout: wording.layout(.hint(parliament: ready.electorateLess)), onLink: open)
                .font(.subheadline)
            Text(wording.text(.qualifier))
                .font(.footnote)
                .foregroundStyle(Theme.ink2.resolve(scheme))
                .fixedSize(horizontal: false, vertical: true)

            ForEach(Array(ready.panels.enumerated()), id: \.offset) { index, panel in
                CardPanel(
                    wording: wording,
                    panel: panel,
                    number: ready.electorateLess ? nil : index + 1,
                    open: open
                )
            }

            ProjectedBlocks(layout: vintage, onLink: open)
                .font(.footnote)
                .foregroundStyle(Theme.ink2.resolve(scheme))

            if ready.canVote {
                actions
            } else {
                CardNote(
                    layout: wording.layout(
                        .advocacy(parliament: ready.electorateLess),
                        ["age": wording.age, "electorate": ready.electorate]
                    ),
                    open: open
                )
            }

            if ready.terms.shown { termsGate }
            if ready.shareWarning { shareWarning }

            if ready.saveable {
                VStack(alignment: .leading, spacing: 6) {
                    Button(wording.text(ready.saved ? .savedOn : .save)) { onAction(.cardSave, nil) }
                        .buttonStyle(CardGhostButton())
                        .accessibilityAddTraits(ready.saved ? [.isSelected] : [])
                    ProjectedBlocks(layout: wording.layout(.saveNote(saved: ready.saved)), onLink: open)
                        .font(.footnote)
                        .foregroundStyle(Theme.ink2.resolve(scheme))
                }
            }

            why

            if ready.shared {
                Button(wording.text(.makeOwn)) { onAction(.cardFresh, nil) }
                    .font(.subheadline.weight(.semibold))
                    .underline()
                    .buttonStyle(.plain)
                    .frame(minHeight: 44)
            } else {
                Button(wording.text(.changeAnswers)) { open("/review") }
                    .font(.subheadline.weight(.semibold))
                    .underline()
                    .buttonStyle(.plain)
                    .frame(minHeight: 44)
            }
        }
    }

    private var vintage: DocumentLayout {
        let withdrawn: CardWording.Paragraph.Withdrawn = ready.withdrawn == 0 ? .none : ready.withdrawn == 1 ? .one : .many
        return wording.layout(
            .vintage(archived: ready.archived, withdrawn: withdrawn),
            ["vintage": ready.vintage, "year": ready.year, "n": String(ready.withdrawn)]
        )
    }

    @ViewBuilder private var actions: some View {
        VStack(alignment: .leading, spacing: 10) {
            if ready.shared {
                Text(wording.text(.shared))
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2.resolve(scheme))
                    .fixedSize(horizontal: false, vertical: true)
            } else if ready.plansEnabled {
                Button(ready.build) { onAction(.cardBuild, nil) }
                    .buttonStyle(PrimaryButton())
            } else {
                Text(wording.text(.plansClosed))
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2.resolve(scheme))
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !ready.shared {
                Button(wording.text(.share)) { onAction(.cardShare, nil) }
                    .buttonStyle(CardGhostButton())
            }
        }
    }

    /// The Terms gate, before a build or a share: the box is the web's to tick, and only a ticked box
    /// accepts.
    private var termsGate: some View {
        VStack(alignment: .leading, spacing: 12) {
            ProjectedBlocks(layout: wording.layout(.termsIntro), onLink: open)
                .font(.subheadline)
            CardCheckbox(on: ready.terms.ticked, label: wording.text(.termsLabel)) {
                onAction(.cardTermsTick, $0 ? "1" : "0")
            }
            HStack(spacing: 10) {
                Button(wording.text(.termsAccept)) { onAction(.cardTermsAccept, nil) }
                    .buttonStyle(PrimaryButton())
                    .disabled(!ready.terms.ticked)
                    .opacity(ready.terms.ticked ? 1 : 0.45)
                Button(wording.text(.termsCancel)) { onAction(.cardTermsCancel, nil) }
                    .buttonStyle(CardGhostButton())
            }
        }
        .padding(14)
        .overlay(RoundedRectangle(cornerRadius: Theme.radius).strokeBorder(Theme.rule.resolve(scheme), lineWidth: 1.5))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(wording.text(.termsGroup))
    }

    /// The warning before a link leaves the device: it cannot be recalled.
    private var shareWarning: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(wording.text(.shareWarningTitle))
                .font(.subheadline.weight(.bold))
            ProjectedBlocks(layout: wording.layout(.shareWarning), onLink: open)
                .font(.subheadline)
            HStack(spacing: 10) {
                Button(wording.text(.copyLink), action: onShare)
                    .buttonStyle(PrimaryButton())
                Button(wording.text(.cancel)) { onAction(.cardShareCancel, nil) }
                    .buttonStyle(CardGhostButton())
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: Theme.radius).fill(Theme.raise.resolve(scheme)))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(wording.text(.shareWarning))
    }

    /// The evidence behind each party's figure, one party at a time.
    @ViewBuilder private var why: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(wording.text(ready.why ? .whyHide : .whyShow)) { onAction(.cardWhy, nil) }
                .font(.subheadline.weight(.semibold))
                .underline()
                .buttonStyle(.plain)
                .frame(minHeight: 44)
            if ready.why {
                ProjectedBlocks(layout: wording.layout(.whyNote), onLink: open)
                    .font(.footnote)
                    .foregroundStyle(Theme.ink2.resolve(scheme))
                ForEach(ready.evidence) { party in
                    DisclosureGroup {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(party.lines) { line in
                                HStack(alignment: .firstTextBaseline, spacing: 8) {
                                    Text(line.agreement)
                                        .font(.caption2.weight(.bold))
                                        .textCase(.uppercase)
                                        .foregroundStyle(Theme.ink2.resolve(scheme))
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(line.question)
                                            .font(.footnote)
                                            .fixedSize(horizontal: false, vertical: true)
                                        Button(wording.text(.record)) { open(line.href) }
                                            .font(.footnote)
                                            .underline()
                                            .buttonStyle(.plain)
                                            .accessibilityLabel(line.label)
                                    }
                                }
                            }
                        }
                        .padding(.top, 6)
                    } label: {
                        Text(party.summary)
                            .font(.subheadline.weight(.semibold))
                    }
                }
            }
        }
    }
}

/// One chamber's alignment panel: the parties in the order they stand, each with its figure only
/// where the panel shows one.
private struct CardPanel: View {
    @Environment(\.colorScheme) private var scheme

    let wording: CardWording
    let panel: CardData.Panel
    let number: Int?
    let open: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            CardChamberHead(title: panel.title, subtitle: panel.subtitle, number: number)
            Text(panel.caption)
                .font(.subheadline.weight(.semibold))
                .accessibilityAddTraits(.isHeader)
            ProjectedBlocks(layout: wording.layout(.panelLabel(ballotOrdered: panel.ballotOrdered)), onLink: open)
                .font(.footnote)
                .foregroundStyle(Theme.ink2.resolve(scheme))
            if panel.blocks.isEmpty {
                Text(wording.text(.panelEmpty))
                    .font(.footnote)
                    .foregroundStyle(Theme.ink2.resolve(scheme))
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(panel.blocks.enumerated()), id: \.offset) { _, block in
                        switch block {
                        case let .single(row):
                            CardPanelRow(row: row)
                        case let .group(label, note, rows):
                            VStack(alignment: .leading, spacing: 4) {
                                Text(label).font(.footnote.weight(.bold))
                                Text(note)
                                    .font(.caption)
                                    .foregroundStyle(Theme.ink2.resolve(scheme))
                                    .fixedSize(horizontal: false, vertical: true)
                                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                                    CardPanelRow(row: row)
                                }
                            }
                            .padding(.vertical, 6)
                        }
                    }
                }
            }
            Text(wording.text(.qualifier))
                .font(.caption)
                .foregroundStyle(Theme.ink2.resolve(scheme))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 8)
    }
}

private struct CardPanelRow: View {
    @Environment(\.colorScheme) private var scheme

    let row: CardData.Row

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(row.name)
                .font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
            if row.showScore, let figure = row.figure {
                Text(figure).font(.subheadline.weight(.bold)).monospacedDigit()
                Text(row.badge).font(.caption).foregroundStyle(Theme.ink2.resolve(scheme))
            } else {
                Text(row.badge).font(.caption).foregroundStyle(Theme.ink2.resolve(scheme))
            }
        }
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) { Divider().overlay(Theme.line.resolve(scheme)) }
        // Read as the page reads it: the party's recorded voting, not the candidate's position.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(row.spoken)
    }
}

/// A chamber's heading: its number on the ballot, its name and its paper.
private struct CardChamberHead: View {
    @Environment(\.colorScheme) private var scheme

    let title: String
    let subtitle: String
    let number: Int?

    var body: some View {
        HStack(spacing: 10) {
            Group {
                if let number {
                    Text(String(number)).font(.caption.weight(.bold))
                } else {
                    Image(systemName: "checkmark").font(.caption.weight(.bold))
                }
            }
            .frame(width: 24, height: 24)
            .overlay(Circle().strokeBorder(Theme.onFill.resolve(scheme), lineWidth: 1.5))
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.subheadline.weight(.bold))
                Text(subtitle).font(.caption)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .foregroundStyle(Theme.onFill.resolve(scheme))
        .background(RoundedRectangle(cornerRadius: Theme.radius).fill(Theme.ink.resolve(scheme)))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// The plan: the acknowledgement, each chamber's ballot in its official order for the voter to
/// number, and the footer that travels with it.
private struct CardPlan: View {
    @Environment(\.colorScheme) private var scheme

    let wording: CardWording
    let ready: CardData.Ready
    let plan: CardData.Plan
    let open: (String) -> Void
    let onAction: (ScreenAction, String?) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            CardNote(layout: wording.layout(.ack(archived: ready.archived), ["year": ready.year]), open: open)

            CardChamberHead(title: plan.house.title, subtitle: plan.house.subtitle, number: 1)
            rows(plan.house.rows, ballot: .house)
            status(plan.house.status)

            CardChamberHead(title: plan.senate.title, subtitle: plan.senate.subtitle, number: 2)
            senateMethod
            Text(wording.text(.senateOneMethod))
                .font(.footnote)
                .foregroundStyle(Theme.ink2.resolve(scheme))
                .fixedSize(horizontal: false, vertical: true)
            switch plan.senate.view {
            case .above:
                rows(plan.senate.above, ballot: .above)
                status(plan.senate.aboveStatus)
            case .below:
                ForEach(Array(plan.senate.below.enumerated()), id: \.offset) { _, group in
                    Text(group.label)
                        .font(.caption.weight(.bold))
                        .textCase(.uppercase)
                        .foregroundStyle(Theme.ink2.resolve(scheme))
                    rows(group.rows, ballot: .below)
                }
                status(plan.senate.belowStatus)
            }

            ProjectedBlocks(
                layout: wording.layout(
                    .foot(archived: ready.archived),
                    [
                        "built": plan.built, "label": ready.label, "data": plan.dataVersion,
                        "version": plan.version, "attribution": plan.attribution,
                    ]
                ),
                onLink: open
            )
            .font(.caption)
            .foregroundStyle(Theme.ink2.resolve(scheme))

            Button(wording.text(.backToCompare)) { afterEditing { onAction(.cardCompare, nil) } }
                .buttonStyle(CardGhostButton())
        }
    }

    private func rows(_ rows: [CardData.PlanRow], ballot: CardPlanBallot) -> some View {
        VStack(spacing: 0) {
            ForEach(rows) { row in
                CardPlanRowView(wording: wording, row: row, total: rows.count) { request in
                    onAction(request.action, request.value(ballot: ballot, id: row.id))
                }
            }
        }
    }

    /// Runs a step that removes the boxes once any box being typed in has let go of its number, so
    /// the number reaches the web before the step does, as the page's box commits before a click.
    private func afterEditing(_ step: @escaping () -> Void) {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        DispatchQueue.main.async(execute: step)
    }

    private func status(_ text: String) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(Theme.ink2.resolve(scheme))
            .fixedSize(horizontal: false, vertical: true)
    }

    /// Above or below the line: one method only, as the page offers it.
    private var senateMethod: some View {
        HStack(spacing: 0) {
            ForEach([CardData.Line.above, .below], id: \.self) { line in
                let on = plan.senate.view == line
                Button { afterEditing { onAction(.cardSenate, line.rawValue) } } label: {
                    Text(wording.text(line == .above ? .above : .below))
                        .font(.subheadline.weight(on ? .semibold : .regular))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(on ? Theme.ink.resolve(scheme) : Color.clear)
                        .foregroundStyle(on ? Theme.onFill.resolve(scheme) : Theme.ink.resolve(scheme))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? [.isButton, .isSelected] : [.isButton])
            }
        }
        .overlay(RoundedRectangle(cornerRadius: Theme.radius).strokeBorder(Theme.line2.resolve(scheme), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(wording.text(.senateMethod))
    }
}

/// One of the plan's three ballots, as the web names it: the House, and the Senate above or below
/// the line.
private enum CardPlanBallot: String {
    case house, above, below
}

/// What a plan row asks of the web: a number typed, or a move up or down.
private enum CardPlanRequest {
    case rank(Int?)
    case up
    case down

    var action: ScreenAction {
        switch self {
        case .rank: return .cardRank
        case .up: return .cardUp
        case .down: return .cardDown
        }
    }

    /// The row the request is about, named as the web names it: its ballot, its id, and the number.
    func value(ballot: CardPlanBallot, id: String) -> String {
        var object: [String: Any] = ["ballot": ballot.rawValue, "id": id]
        // A box emptied clears its number, which the web reads as none given.
        if case let .rank(n) = self { object["n"] = n.map { $0 as Any } ?? NSNull() }
        let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }
}

/// One row of the plan's ballot: a blank box the voter numbers, typed or moved — never dragged.
private struct CardPlanRowView: View {
    @Environment(\.colorScheme) private var scheme

    let wording: CardWording
    let row: CardData.PlanRow
    let total: Int
    let onRequest: (CardPlanRequest) -> Void

    @State private var typed = ""
    /// Whether the voter has typed in the box since it last showed the web's number: only an edit
    /// commits, as the page's box sends only on a change.
    @State private var edited = false
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 12) {
            TextField(String(), text: Binding(get: { typed }, set: { typed = $0; edited = true }))
                .keyboardType(.numberPad)
                .multilineTextAlignment(.center)
                .font(.title3.weight(.bold).monospacedDigit())
                .frame(width: 48, height: 48)
                .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Theme.ink.resolve(scheme), lineWidth: 1.5))
                .focused($focused)
                .onSubmit(commit)
                .onChange(of: focused) { _, now in if !now { commit() } }
                .accessibilityLabel(wording.text(.preferenceFor, ["name": row.name]))
            VStack(alignment: .leading, spacing: 2) {
                Text(row.candidate).font(.subheadline.weight(.semibold))
                Text(row.party).font(.caption).foregroundStyle(Theme.ink2.resolve(scheme))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            VStack(spacing: 4) {
                Button { onRequest(.up) } label: {
                    Image(systemName: "arrow.up").frame(width: 44, height: 30)
                }
                .accessibilityLabel(wording.text(.higher, ["name": row.name]))
                Button { onRequest(.down) } label: {
                    Image(systemName: "arrow.down").frame(width: 44, height: 30)
                }
                .accessibilityLabel(wording.text(.lower, ["name": row.name]))
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) { Divider().overlay(Theme.line.resolve(scheme)) }
        .onAppear { typed = shown }
        // The box shows the number the web holds, focused or not, as the page's does: a move made
        // while it is focused, or another box's number shifting it, is never undone on leaving it.
        .onChange(of: row.pref) { _, _ in
            typed = shown
            edited = false
        }
    }

    /// The box as the web holds it: the row's number, or empty for none.
    private var shown: String { row.pref == 0 ? String() : String(row.pref) }

    /// Sends the number typed, as the page's box commits on leaving it; an emptied box clears it.
    private func commit() {
        guard edited else { return }
        edited = false
        let trimmed = typed.trimmingCharacters(in: .whitespaces)
        guard trimmed != shown else { return }
        if trimmed.isEmpty {
            onRequest(.rank(nil))
        } else if let n = Int(trimmed) {
            onRequest(.rank(n))
        } else {
            typed = shown
        }
    }
}

/// A projected paragraph set apart from the card, as the page sets its notes.
private struct CardNote: View {
    @Environment(\.colorScheme) private var scheme

    let layout: DocumentLayout
    let open: (String) -> Void

    var body: some View {
        ProjectedBlocks(layout: layout, onLink: open)
            .font(.subheadline)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: Theme.radius).fill(Theme.raise.resolve(scheme)))
            .overlay(RoundedRectangle(cornerRadius: Theme.radius).strokeBorder(Theme.rule.resolve(scheme), lineWidth: 1))
            .padding(.bottom, 12)
    }
}

/// A checkbox, as the page's is: read as a switch, set by asking the web.
private struct CardCheckbox: View {
    @Environment(\.colorScheme) private var scheme

    let on: Bool
    let label: String
    let set: (Bool) -> Void

    var body: some View {
        Button { set(!on) } label: {
            HStack(alignment: .top, spacing: 10) {
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
                Text(label)
                    .font(.footnote)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityRepresentation {
            Toggle(isOn: Binding(get: { on }, set: { set($0) })) { Text(label) }
        }
    }
}

/// The outlined button the page uses beside its filled one.
private struct CardGhostButton: ButtonStyle {
    @Environment(\.colorScheme) private var scheme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.callout.weight(.semibold))
            .foregroundStyle(Theme.ink.resolve(scheme))
            .frame(maxWidth: .infinity, minHeight: 50)
            .overlay(RoundedRectangle(cornerRadius: Theme.radius).strokeBorder(Theme.rule.resolve(scheme), lineWidth: 1.5))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

/// The system share sheet, for the link the web answers a confirmed warning with.
private struct CardShareSheet: UIViewControllerRepresentable {
    let url: URL
    /// Clears the sheet once the system's controller has closed itself, as it does after an activity.
    let onDone: () -> Void

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        controller.completionWithItemsHandler = { _, _, _, _ in onDone() }
        return controller
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

private struct CardDocument: Identifiable {
    let href: String
    let layout: DocumentLayout
    var id: String { href }
}

private struct CardBrowsed: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}
