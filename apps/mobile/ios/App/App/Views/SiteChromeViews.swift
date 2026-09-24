import SwiftUI
import UIKit

/// What a screen's chrome does when it is used. Supplied by the host with the chrome itself.
struct SiteChromeActions {
    /// Leaves for a web route, as a footer link does.
    var exit: (String) -> Void = { _ in }
    /// Records that the voter dismissed the stale-data notice for this dataVersion.
    var dismissStale: (String) -> Void = { _ in }
    /// Asks the web to clear everything this app stores on the device.
    var clearData: () -> Void = {}
}

private struct SiteChromeKey: EnvironmentKey {
    static let defaultValue: SiteChrome? = nil
}

private struct SiteChromeActionsKey: EnvironmentKey {
    static let defaultValue = SiteChromeActions()
}

extension EnvironmentValues {
    var siteChrome: SiteChrome? {
        get { self[SiteChromeKey.self] }
        set { self[SiteChromeKey.self] = newValue }
    }

    var siteChromeActions: SiteChromeActions {
        get { self[SiteChromeActionsKey.self] }
        set { self[SiteChromeActionsKey.self] = newValue }
    }
}

/// The stale-data notice, above a screen's content. Mirrors `StaleDataNotice.svelte`.
struct StaleNotice: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.openURL) private var openURL
    @Environment(\.siteChrome) private var chrome
    @Environment(\.siteChromeActions) private var actions

    @State private var dismissed = false

    /// The data versions whose notice has been announced this session.
    @MainActor private static var announced: Set<String> = []

    var body: some View {
        if let stale = chrome?.stale, !dismissed {
            VStack(alignment: .leading, spacing: 4) {
                Text(stale.message)
                    .font(.footnote)
                    .foregroundStyle((stale.prominent ? Theme.ink : Theme.ink2).resolve(scheme))
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 16) {
                    if let raw = stale.updateUrl, let url = URL(string: raw) {
                        // A system handoff to the store listing, not the in-app browser.
                        Button("Update") { openURL(url) }
                            .foregroundStyle(Theme.ink.resolve(scheme))
                    }
                    Button("Dismiss") {
                        dismissed = true
                        actions.dismissStale(stale.dataVersion)
                    }
                    .foregroundStyle(Theme.ink2.resolve(scheme))
                }
                .font(.footnote)
                .underline()
                .buttonStyle(.plain)
                .frame(minHeight: 44)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Theme.gutter)
            .padding(.top, 10)
            .background(Theme.raise.resolve(scheme))
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill((stale.prominent ? Theme.ink : Theme.line).resolve(scheme))
                    .frame(height: stale.prominent ? 2 : 1)
            }
            .accessibilityElement(children: .contain)
            // The web's notice is a polite live region in the persistent layout, heard once rather than
            // on every page; each native screen is built afresh, so the announcement is remembered.
            .onAppear {
                guard !Self.announced.contains(stale.dataVersion) else { return }
                Self.announced.insert(stale.dataVersion)
                UIAccessibility.post(notification: .announcement, argument: stale.message)
            }
        }
    }
}

/// The site footer, at the end of a screen's scrolling content. Mirrors `Footer.svelte`.
struct SiteFooter: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.siteChrome) private var chrome
    @Environment(\.siteChromeActions) private var actions

    var body: some View {
        if let chrome {
            VStack(spacing: 14) {
                FlowLayout(spacing: 16, lineSpacing: 2) {
                    ForEach(Array(chrome.links.enumerated()), id: \.offset) { _, link in
                        Button(link.label) { actions.exit(link.href) }
                            .font(.caption)
                            .underline()
                            .buttonStyle(.plain)
                            .foregroundStyle(Theme.ink2.resolve(scheme))
                            .frame(minHeight: 44)
                    }
                }
                FlowLayout(spacing: 0, lineSpacing: 0) {
                    ForEach(Array(chrome.credit.enumerated()), id: \.offset) { _, part in
                        if let raw = part.href, let url = URL(string: raw) {
                            ExternalLinkView(title: part.text, url: url)
                        } else {
                            Text(part.text)
                                .foregroundStyle(Theme.ink2.resolve(scheme))
                        }
                    }
                }
                .font(.caption2)
                Text(chrome.authorisation)
                    .font(.caption2)
                    .foregroundStyle(Theme.ink2.resolve(scheme))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 18)
            .padding(.bottom, 12)
            .overlay(alignment: .top) {
                Rectangle().fill(Theme.line.resolve(scheme)).frame(height: 1)
            }
        }
    }
}

/// Lays its children out in rows, wrapping as the width runs out. A child wider than a whole row
/// is offered the row's width, so text wraps within it rather than running off the screen.
struct FlowLayout: Layout {
    var spacing: CGFloat
    var lineSpacing: CGFloat
    var centred = true

    private struct Row {
        var items: [(index: Int, size: CGSize)] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
        var y: CGFloat = 0
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let height = rows.last.map { $0.y + $0.height } ?? 0
        return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: height)
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX + (centred ? max(0, bounds.width - row.width) / 2 : 0)
            for item in row.items {
                subviews[item.index].place(
                    at: CGPoint(x: x, y: bounds.minY + row.y + (row.height - item.size.height) / 2),
                    proposal: ProposedViewSize(item.size)
                )
                x += item.size.width + spacing
            }
        }
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var current = Row()
        var y: CGFloat = 0
        for index in subviews.indices {
            var size = subviews[index].sizeThatFits(.unspecified)
            if size.width > width {
                size = subviews[index].sizeThatFits(ProposedViewSize(width: width, height: nil))
            }
            if !current.items.isEmpty, current.width + spacing + size.width > width {
                current.y = y
                rows.append(current)
                y += current.height + lineSpacing
                current = Row()
            }
            current.width += (current.items.isEmpty ? 0 : spacing) + size.width
            current.height = max(current.height, size.height)
            current.items.append((index, size))
        }
        if !current.items.isEmpty {
            current.y = y
            rows.append(current)
        }
        return rows
    }
}
