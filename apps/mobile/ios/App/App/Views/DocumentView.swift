import SwiftUI
import UIKit

/// A document page — the privacy policy, the terms, the method — drawn from the web's own
/// prerendered output.
///
/// Draws a `DocumentLayout` and nothing else: every word comes from the projection, which
/// `DocumentLayout.verify` has already held to the page's text. The screen adds only the chrome the
/// projection leaves to it — the top bar, the stale notice and the footer — and the native
/// counterpart of each control slot.
struct DocumentView: View {
    @Environment(\.colorScheme) private var scheme

    let layout: DocumentLayout
    /// The fragment the voter followed a link to, scrolled into view on arrival.
    let anchor: String?
    /// The brand bar's theme toggle: its name in each theme, from the page, and what it asks for.
    var theme: (labels: LandingComposition.ThemeLabels, toggle: () -> Void)?
    let onExit: (String) -> Void

    @State private var scrollTarget: String?
    @State private var term: TermSelection?
    @State private var browsing: BrowsedPage?
    /// A page opened from inside a definition, shown once the definition's sheet is down.
    @State private var browsingAfterTerm: BrowsedPage?

    var body: some View {
        VStack(spacing: 0) {
            StaleNotice()
            if let crumbs = layout.crumbs {
                Breadcrumbs(crumbs: crumbs, label: layout.crumbsLabel ?? "", onExit: onExit)
            } else if let top = layout.top {
                ProjectedTopBar(top: top) { onExit("/") }
            } else if let brand = layout.brand {
                BrandBar(brand: brand, theme: theme)
            }
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        DocumentBlocks(blocks: layout.blocks, layout: layout, onExit: onExit)
                            .accessibilityElement(children: .contain)
                            .accessibilityIdentifier("native-document")
                        SiteFooter()
                            .padding(.top, 40)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Theme.gutter)
                    .padding(.bottom, 24)
                }
                .onAppear {
                    // A new screen, as the web's live region announces the gate's change of state.
                    UIAccessibility.post(notification: .screenChanged, argument: nil)
                    guard let anchor else { return }
                    DispatchQueue.main.async { proxy.scrollTo(anchor, anchor: .top) }
                }
                .onChange(of: scrollTarget) { _, target in
                    guard let target else { return }
                    withAnimation { proxy.scrollTo(target, anchor: .top) }
                    scrollTarget = nil
                }
            }
        }
        .background(Theme.paper.resolve(scheme))
        .foregroundStyle(Theme.ink.resolve(scheme))
        .tint(Theme.ink.resolve(scheme))
        .environment(\.openURL, OpenURLAction { url in follow(url) })
        .sheet(item: $term, onDismiss: {
            browsing = browsingAfterTerm
            browsingAfterTerm = nil
        }) { selection in
            // A sheet does not inherit the environment it is attached outside, so a link inside a
            // definition is followed here too.
            TermSheet(term: layout.terms[selection.index], layout: layout) { href in
                term = nil
                onExit(href)
            }
            .environment(\.openURL, OpenURLAction { url in follow(url) })
        }
        .sheet(item: $browsing) { page in
            SafariView(url: page.url).ignoresSafeArea()
        }
    }

    /// Follows a link drawn in running text. Internal routes go back to the web, which stays the
    /// router (ADR 0018 D4a); a fragment on this page scrolls to it.
    private func follow(_ url: URL) -> OpenURLAction.Result {
        switch DocumentURL(url) {
        case let .link(index):
            guard layout.links.indices.contains(index) else { return .discarded }
            let link = layout.links[index]
            // A link followed from inside a definition closes it first.
            let inTerm = term != nil
            term = nil
            if link.href.hasPrefix("#") {
                scrollTarget = String(link.href.dropFirst())
            } else if !link.external {
                onExit(link.href)
            } else if let target = URL(string: link.href), ["http", "https"].contains(target.scheme) {
                if inTerm {
                    browsingAfterTerm = BrowsedPage(url: target)
                } else {
                    browsing = BrowsedPage(url: target)
                }
            } else if let target = URL(string: link.href), ["mailto", "tel"].contains(target.scheme) {
                // mailto: and tel: belong to the system; no other scheme is handed on.
                UIApplication.shared.open(target)
            }
            return .handled
        case let .term(index):
            guard layout.terms.indices.contains(index) else { return .discarded }
            term = TermSelection(index: index)
            return .handled
        case nil:
            return .discarded
        }
    }
}

private struct TermSelection: Identifiable {
    let index: Int
    var id: Int { index }
}

private struct BrowsedPage: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

/// The links a run carries, addressed by their index in the layout rather than by their target, so
/// following one is always a decision made here and never a URL the system opens on its own.
enum DocumentURL: Equatable {
    case link(Int)
    case term(Int)

    static let scheme = "x-how2vote-document"
    /// The identifier of a drawn glyph that is not the page's text.
    static let decoration = "document-decoration"

    init?(_ url: URL) {
        guard url.scheme == Self.scheme, let host = url.host, let index = Int(url.lastPathComponent) else {
            return nil
        }
        switch host {
        case "link": self = .link(index)
        case "term": self = .term(index)
        default: return nil
        }
    }

    var url: URL {
        switch self {
        case let .link(i): return URL(string: "\(Self.scheme)://link/\(i)")!
        case let .term(i): return URL(string: "\(Self.scheme)://term/\(i)")!
        }
    }
}

/// Part of a projected page drawn inside a native screen, as the document screen draws it: the
/// clear-data section of the saved cards' page. It holds no links or terms, so nothing in it is for
/// a tap to follow.
struct ProjectedBlocks: View {
    let layout: DocumentLayout

    var body: some View {
        DocumentBlocks(blocks: layout.blocks, layout: layout, onExit: { _ in })
    }
}

/// A sequence of laid-out blocks.
private struct DocumentBlocks: View {
    let blocks: [DocumentLayout.Block]
    let layout: DocumentLayout
    let onExit: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                DocumentBlock(block: block, layout: layout, onExit: onExit)
            }
        }
    }
}

private struct DocumentBlock: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.clearDataWording) private var clearData

    let block: DocumentLayout.Block
    let layout: DocumentLayout
    let onExit: (String) -> Void

    var body: some View {
        switch block {
        case let .heading(level, id, run):
            RunText(run: run, layout: layout)
                .font(Self.headingFont(level))
                .padding(.top, level == 1 ? 8 : 14)
                .accessibilityAddTraits(.isHeader)
                .anchor(id)
        case let .paragraph(role, id, run):
            RunText(run: run, layout: layout)
                .font(Self.paragraphFont(role))
                .italic(role == .empty)
                .foregroundStyle(Self.isQuiet(role) ? Theme.ink2.resolve(scheme) : Theme.ink.resolve(scheme))
                .anchor(id)
        case let .list(ordered, role, items):
            DocumentList(ordered: ordered, role: role, items: items, layout: layout, onExit: onExit)
        case let .definitions(items):
            VStack(alignment: .leading, spacing: 16) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    VStack(alignment: .leading, spacing: 6) {
                        RunText(run: item.term, layout: layout)
                            .font(.headline)
                        DocumentBlocks(blocks: item.detail, layout: layout, onExit: onExit)
                    }
                    .anchor(item.id)
                }
            }
        case let .quote(content):
            HStack(alignment: .top, spacing: 12) {
                Rectangle().fill(Theme.line2.resolve(scheme)).frame(width: 2)
                DocumentBlocks(blocks: content, layout: layout, onExit: onExit)
            }
        case let .section(role, id, content):
            if role == .clearData {
                DocumentBlocks(blocks: content, layout: layout, onExit: onExit)
                    .padding(16)
                    .background(Theme.raise.resolve(scheme))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.radius)
                            .strokeBorder(Theme.line2.resolve(scheme), lineWidth: 1)
                    )
                    .anchor(id)
            } else {
                DocumentBlocks(blocks: content, layout: layout, onExit: onExit)
                    .anchor(id)
            }
        case let .electionSwitch(label, options):
            ElectionSwitch(label: label, options: options, onExit: onExit)
        case let .slot(slot, controls):
            switch slot {
            case .clearData:
                if let wording = clearData {
                    ClearDataControl(label: controls.first { $0.action == "clear" }?.text() ?? "", wording: wording)
                }
            case .ageDeclare, .ageContinue, .landingFresh, .landingResume, .landingComplete:
                SlotButtons(slot: slot, controls: controls, onExit: onExit)
            case .themeLight, .themeDark:
                // The brand bar draws the theme toggle; these carry only its names.
                EmptyView()
            case .quizAnswer:
                // The quiz draws its answers itself, from its wording.
                EmptyView()
            }
        case let .logo(label):
            Wordmark(height: UIFontMetrics(forTextStyle: .body).scaledValue(for: 20), color: Theme.ink.resolve(scheme), label: label)
                .padding(.bottom, 8)
        }
    }

    private static func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: return .largeTitle.weight(.semibold)
        case 2: return .title2.weight(.semibold)
        default: return .headline
        }
    }

    private static func paragraphFont(_ role: NativeDocument.BlockRole?) -> Font {
        switch role {
        case .lede, .intro: return .title3
        case .updated, .note, .meta, .source, .evidence: return .footnote
        case .kicker: return .caption2.weight(.semibold)
        case .inventory, .empty, .clearData, .picker, .stage, .template, nil: return .body
        }
    }

    private static func isQuiet(_ role: NativeDocument.BlockRole?) -> Bool {
        switch role {
        case .updated, .meta, .source, .evidence, .empty, .kicker: return true
        case .lede, .intro, .note, .inventory, .clearData, .picker, .stage, .template, nil: return false
        }
    }
}

private struct DocumentList: View {
    @Environment(\.colorScheme) private var scheme

    let ordered: Bool
    let role: NativeDocument.ListRole?
    let items: [[DocumentLayout.Block]]
    let layout: DocumentLayout
    let onExit: (String) -> Void

    var body: some View {
        if role == .steps {
            // The landing's step rail: columns under a rule, as `.steps` lays them out.
            HStack(alignment: .top, spacing: 16) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    VStack(alignment: .leading, spacing: 2) {
                        Rectangle().fill(Theme.ink.resolve(scheme)).frame(height: 1).padding(.bottom, 4)
                        // The step's name on a line of its own above its detail, as `.steps b` is.
                        if case let .paragraph(_, _, run)? = item.first, item.count == 1,
                           let (name, detail) = run.splitting(after: \.strong) {
                            RunText(run: name, layout: layout).font(.caption.weight(.semibold))
                            RunText(run: detail, layout: layout).font(.caption)
                        } else {
                            DocumentBlocks(blocks: item, layout: layout, onExit: onExit)
                                .font(.caption)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        } else {
            list
        }
    }

    private var list: some View {
        VStack(alignment: .leading, spacing: role == .index ? 4 : 8) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                if role == .rows {
                    VStack(alignment: .leading, spacing: 0) {
                        if index > 0 { Rectangle().fill(Theme.line.resolve(scheme)).frame(height: 1).padding(.bottom, 8) }
                        DocumentBlocks(blocks: item, layout: layout, onExit: onExit)
                    }
                } else if role == .index {
                    DocumentBlocks(blocks: item, layout: layout, onExit: onExit)
                } else if role == .claims, case let .paragraph(_, _, run)? = item.first, item.count == 1,
                          let (tick, claim) = run.splitting(after: \.decorative) {
                    // The page's own tick is the marker, set apart from the claim as `.tick` is.
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        ListMarker(.text(tick.visible))
                        RunText(run: claim, layout: layout)
                    }
                } else {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        ListMarker(ordered ? .text("\(index + 1).") : .disc)
                        DocumentBlocks(blocks: item, layout: layout, onExit: onExit)
                    }
                }
            }
        }
    }
}

/// A list item's marker: drawn, never heard.
private struct ListMarker: View {
    enum Kind {
        /// The page's own marker text, or an ordered item's number.
        case text(String)
        /// An unordered item's disc, drawn as the web's `list-style` draws it rather than written.
        case disc
    }

    @Environment(\.colorScheme) private var scheme
    /// The disc's size and lift above the baseline, scaled with the text beside it.
    @ScaledMetric(relativeTo: .body) private var disc: CGFloat = 6

    let kind: Kind

    init(_ kind: Kind) {
        self.kind = kind
    }

    var body: some View {
        marker
            .foregroundStyle(Theme.ink2.resolve(scheme))
            .accessibilityHidden(true)
            // UI tests see elements VoiceOver skips; this marks the one drawn glyph a document screen
            // adds, so the on-screen check can skip it too.
            .accessibilityIdentifier(DocumentURL.decoration)
    }

    private var marker: Text {
        switch kind {
        case let .text(text):
            return Text(text)
        case .disc:
            // Labelled empty, so the symbol's own name is not what a UI test reads for it.
            return Text(Image(systemName: "circle.fill"))
                .accessibilityLabel(Text(verbatim: ""))
                .font(.system(size: disc))
                .baselineOffset(disc * 0.6)
        }
    }
}

/// One run of text, drawn span by span. Hidden spans are not drawn; when VoiceOver should hear
/// something other than what is drawn, it is given the run's spoken text.
private struct RunText: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.openURL) private var openURL

    let run: DocumentLayout.Run
    let layout: DocumentLayout

    var body: some View {
        let text = Text(attributed)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
        if layout.needsSpokenLabel(run) {
            text.accessibilityLabel(layout.spoken(run))
                // The spoken label replaces the inline links and terms, so each is offered as an
                // action instead — a glossary term as much as a link.
                .accessibilityActions {
                    ForEach(Array(linkIndices.enumerated()), id: \.offset) { _, index in
                        Button(layout.links[index].label ?? plainText(of: index)) {
                            openURL(DocumentURL.link(index).url)
                        }
                    }
                    ForEach(Array(termIndices.enumerated()), id: \.offset) { _, index in
                        Button(layout.terms[index].text) {
                            openURL(DocumentURL.term(index).url)
                        }
                    }
                }
        } else {
            text
        }
    }

    private var linkIndices: [Int] {
        var seen: [Int] = []
        for span in run.spans { if let l = span.link, !seen.contains(l) { seen.append(l) } }
        return seen
    }

    private var termIndices: [Int] {
        var seen: [Int] = []
        for span in run.spans { if let t = span.term, !seen.contains(t) { seen.append(t) } }
        return seen
    }

    private func plainText(of link: Int) -> String {
        // What VoiceOver hears of the link: its hidden text, and not the glyph drawn beside it.
        run.spans.filter { $0.link == link && !$0.decorative }.map(\.text).joined()
    }

    private var attributed: AttributedString {
        var out = AttributedString()
        for span in run.spans where !span.hidden {
            var piece = AttributedString(span.text)
            var intent: InlinePresentationIntent = []
            if span.strong { intent.insert(.stronglyEmphasized) }
            if span.emphasis { intent.insert(.emphasized) }
            if span.code { intent.insert(.code) }
            if !intent.isEmpty { piece.inlinePresentationIntent = intent }
            if span.muted { piece.foregroundColor = Theme.ink2.resolve(scheme) }
            if let l = span.link {
                piece.link = DocumentURL.link(l).url
                piece.underlineStyle = Text.LineStyle(pattern: .solid)
                if layout.links[l].primary { piece.inlinePresentationIntent = intent.union(.stronglyEmphasized) }
            } else if let t = span.term {
                piece.link = DocumentURL.term(t).url
                piece.underlineStyle = Text.LineStyle(pattern: .dot)
            }
            out += piece
        }
        return out
    }
}

/// A glossary term's definition, opened from the term — the web's popover.
private struct TermSheet: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    let term: DocumentLayout.Term
    let layout: DocumentLayout
    let onGlossary: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            RunText(run: term.definition, layout: layout)
                .font(.body)
            HStack(spacing: 20) {
                Button(term.more) { onGlossary(term.href) }
                    .underline()
                Spacer()
                Button(term.close) { dismiss() }
            }
            .font(.subheadline)
            .frame(minHeight: 44)
        }
        .padding(Theme.gutter)
        .frame(maxWidth: .infinity, alignment: .leading)
        .foregroundStyle(Theme.ink.resolve(scheme))
        .background(Theme.raise.resolve(scheme))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(term.label)
        .presentationDetents([.medium])
    }
}

private struct ElectionSwitch: View {
    @Environment(\.colorScheme) private var scheme

    let label: String
    let options: [NativeDocument.SwitchOption]
    let onExit: (String) -> Void

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                Button { onExit(option.href) } label: {
                    Text(option.label)
                        .font(.subheadline.weight(option.current ? .semibold : .regular))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(option.current ? Theme.ink.resolve(scheme) : Color.clear)
                        .foregroundStyle(option.current ? Theme.onFill.resolve(scheme) : Theme.ink.resolve(scheme))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(option.current ? [.isButton, .isSelected] : [.isButton])
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: Theme.radius)
                .strokeBorder(Theme.line2.resolve(scheme), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }
}

/// The privacy policy's "clear all my data" control — `ClearMyData.svelte`'s buttons.
///
/// The clearing is the web's: it owns the keys (ADR 0018 D3) and already clears the durable copy the
/// native core reads, so this asks for it rather than doing it a second way.
private struct ClearDataControl: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.siteChromeActions) private var actions

    /// The resting button's label, from the page.
    let label: String
    /// The confirmation's wording, from `states/clear-data`.
    let wording: ClearDataWording

    @State private var confirming = false
    @State private var clearing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if confirming {
                Text(wording.text(.ask))
                    .font(.subheadline.weight(.semibold))
                Button(wording.text(clearing ? .clearing : .confirm)) {
                    clearing = true
                    actions.slotAction(.clearData, "clear")
                }
                .buttonStyle(PrimaryButton())
                .disabled(clearing)
                Button(wording.text(.cancel)) { confirming = false }
                    .underline()
                    .frame(minHeight: 44)
                    .disabled(clearing)
            } else {
                Button(label) { confirming = true }
                    .underline()
                    .frame(minHeight: 44)
            }
        }
        .foregroundStyle(Theme.ink.resolve(scheme))
    }
}

private extension View {
    /// Marks the view as a fragment a link can scroll to, when the page gives it an id.
    @ViewBuilder func anchor(_ id: String?) -> some View {
        if let id { self.id(id) } else { self }
    }
}

/// A page's plain top bar, as `TopBar.svelte` draws it: its label, and a back button named as the
/// page names it.
private struct ProjectedTopBar: View {
    @Environment(\.colorScheme) private var scheme

    let top: NativeDocument.TopBar
    let onBack: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            if let back = top.back {
                Button(action: onBack) {
                    Image(systemName: "chevron.left")
                        .font(.body.weight(.medium))
                        .frame(minWidth: 44, minHeight: 44, alignment: .leading)
                }
                .accessibilityLabel(back)
            }
            Spacer(minLength: 0)
            Text(top.label)
                .font(.footnote)
                .foregroundStyle(Theme.ink2.resolve(scheme))
            Spacer(minLength: 0)
            Color.clear.frame(width: 44, height: 44)
        }
        .foregroundStyle(Theme.ink2.resolve(scheme))
        .padding(.horizontal, Theme.gutter)
        .padding(.top, 4)
        .frame(minHeight: 56)
    }
}

/// A data page's breadcrumb trail, as `Breadcrumb.svelte` draws it: links up, then the page.
private struct Breadcrumbs: View {
    @Environment(\.colorScheme) private var scheme

    let crumbs: [NativeDocument.Crumb]
    let label: String
    let onExit: (String) -> Void

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Array(crumbs.enumerated()), id: \.offset) { index, crumb in
                if index > 0 {
                    // The web's separator is drawn by its stylesheet, not written in the page.
                    Image(systemName: "chevron.right")
                        .imageScale(.small)
                        .foregroundStyle(Theme.ink2.resolve(scheme))
                        .accessibilityHidden(true)
                }
                if let href = crumb.href {
                    Button(crumb.label) { onExit(href) }
                        .underline()
                        .buttonStyle(.plain)
                        .lineLimit(1)
                } else {
                    Text(crumb.label)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .accessibilityAddTraits(.isStaticText)
                }
            }
            Spacer(minLength: 0)
        }
        .font(.caption)
        .foregroundStyle(Theme.ink2.resolve(scheme))
        .padding(.horizontal, Theme.gutter)
        .frame(minHeight: 44)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }
}

/// A slot's buttons, labelled from the page. Pressing one asks the web to do what the page's own
/// button does — by the action the page names on it — and the first is the page's primary action.
/// One press is enough: the buttons stand down until the screen that answers it is drawn, so a second
/// tap cannot race the first round trip.
private struct SlotButtons: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.siteChromeActions) private var actions

    let slot: NativeDocument.Slot
    let controls: [NativeDocument.Control]
    let onExit: (String) -> Void

    @State private var pressed = false

    private func press(_ control: NativeDocument.Control) {
        guard !pressed, let action = control.action else { return }
        pressed = true
        actions.slotAction(slot, action)
    }

    var body: some View {
        VStack(spacing: 10) {
            ForEach(Array(controls.enumerated()), id: \.offset) { index, control in
                let label = control.text()
                if let href = control.href {
                    // A link on the page: it goes where the page's link goes.
                    Button(label) { onExit(href) }
                        .font(.footnote)
                        .underline()
                        .foregroundStyle(Theme.ink2.resolve(scheme))
                        .frame(minHeight: 44)
                        // Announced as the page's link is, not as a button.
                        .accessibilityRemoveTraits(.isButton)
                        .accessibilityAddTraits(.isLink)
                } else if index == 0 {
                    Button(label) { press(control) }
                        .buttonStyle(PrimaryButton())
                } else {
                    Button(label) { press(control) }
                        .font(.callout.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 50)
                        .overlay(
                            RoundedRectangle(cornerRadius: Theme.radius)
                                .strokeBorder(Theme.rule.resolve(scheme), lineWidth: 1.5)
                        )
                        .foregroundStyle(Theme.ink.resolve(scheme))
                }
            }
        }
        .padding(.top, 8)
        .disabled(pressed)
    }
}

/// The landing's bar, as its `<header>` draws it: the wordmark and the theme toggle.
private struct BrandBar: View {
    @Environment(\.colorScheme) private var scheme

    let brand: NativeDocument.Brand
    let theme: (labels: LandingComposition.ThemeLabels, toggle: () -> Void)?

    var body: some View {
        HStack {
            Wordmark(height: UIFontMetrics(forTextStyle: .body).scaledValue(for: 20), color: Theme.ink.resolve(scheme), label: brand.logo)
            Spacer()
            if brand.theme, let theme {
                Button(action: theme.toggle) {
                    Image(systemName: scheme == .dark ? "moon" : "sun.max")
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.ink2.resolve(scheme))
                .accessibilityLabel(scheme == .dark ? theme.labels.dark : theme.labels.light)
                // The web's toggle announces its state (`aria-pressed`): pressed while dark.
                .accessibilityAddTraits(scheme == .dark ? .isSelected : [])
            }
        }
        .padding(.horizontal, Theme.gutter)
        .padding(.top, 8)
    }
}

private struct ClearDataWordingKey: EnvironmentKey {
    static let defaultValue: ClearDataWording? = nil
}

extension EnvironmentValues {
    /// The clear-data confirmation's wording, handed to a page that holds the control.
    var clearDataWording: ClearDataWording? {
        get { self[ClearDataWordingKey.self] }
        set { self[ClearDataWordingKey.self] = newValue }
    }
}
