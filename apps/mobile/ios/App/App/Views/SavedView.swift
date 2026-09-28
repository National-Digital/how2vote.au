import SwiftUI

/// The cards a voter saved on this device, each reopened by a tap, and the controls that delete them.
///
/// Mirrors `apps/web/src/routes/saved/+page.svelte`. The cards are the web's to hold (ADR 0018 D3):
/// they are handed over with the route, a card opens on the web, and deleting asks the web, which
/// offers the route again with what it then holds.
struct SavedView: View {
    @Environment(\.colorScheme) private var scheme

    /// Every word the screen shows or speaks, as the web's saved page words it.
    let wording: SavedWording
    let cards: [SavedCard]
    /// Asks the web to change the cards it holds.
    let onAction: (ScreenAction, String?) -> Void
    /// Where the voter is going: a web path the router moves to.
    let onExit: (String) -> Void

    @State private var confirming = false

    var body: some View {
        VStack(spacing: 0) {
            StaleNotice()
            TopBar(label: wording.text(.title), backLabel: wording.text(.back), onBack: { onExit("/") })
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text(wording.text(.title))
                        .font(.largeTitle.weight(.semibold))
                        .padding(.top, 8)
                        .padding(.bottom, 14)
                        .accessibilityAddTraits(.isHeader)

                    if cards.isEmpty {
                        empty
                    } else {
                        list
                    }

                    // The one global device-data control, shown whether or not any card is saved.
                    ProjectedBlocks(layout: wording.clearData)
                        .padding(.top, 20)

                    SiteFooter()
                        .padding(.top, 40)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Theme.gutter)
                .padding(.bottom, 24)
            }
        }
        .background(Theme.paper.resolve(scheme))
        .foregroundStyle(Theme.ink.resolve(scheme))
        .tint(Theme.ink.resolve(scheme))
    }

    @ViewBuilder private var empty: some View {
        Text(wording.text(.none))
            .font(.body)
            .padding(.bottom, 10)
        Text(howTo)
            .font(.subheadline)
            .foregroundStyle(Theme.ink2.resolve(scheme))
            .fixedSize(horizontal: false, vertical: true)
            .padding(.bottom, 16)
        Button(wording.text(.build)) { onExit("/ballot") }
            .buttonStyle(PrimaryButton())
    }

    /// The how-to with the button it names set in bold, as the page sets it.
    private var howTo: AttributedString {
        var action = AttributedString(wording.text(.action))
        action.font = .subheadline.weight(.semibold)
        action.foregroundColor = Theme.ink.resolve(scheme)
        let (before, after) = wording.how
        return AttributedString(before) + action + AttributedString(after)
    }

    @ViewBuilder private var list: some View {
        Text(wording.text(.kept))
            .font(.subheadline)
            .foregroundStyle(Theme.ink2.resolve(scheme))
            .fixedSize(horizontal: false, vertical: true)
            .padding(.bottom, 16)

        VStack(spacing: 0) {
            Divider().overlay(Theme.line.resolve(scheme))
            ForEach(cards) { card in
                SavedCardRow(card: card, wording: wording, onOpen: { onExit(card.url) }) {
                    onAction(.savedRemove, card.url)
                }
                Divider().overlay(Theme.line.resolve(scheme))
            }
        }

        clearAll
            .padding(.top, 18)
    }

    @ViewBuilder private var clearAll: some View {
        if confirming {
            FlowLayout(spacing: 10, lineSpacing: 4, centred: false) {
                Text(wording.text(.ask, ["count": String(cards.count)]))
                    .font(.footnote)
                    .foregroundStyle(Theme.ink2.resolve(scheme))
                Button(wording.text(.confirm)) {
                    confirming = false
                    onAction(.savedClear, nil)
                }
                .font(.footnote.weight(.semibold))
                .underline()
                .frame(minHeight: 44)
                Button(wording.text(.cancel)) { confirming = false }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.ink2.resolve(scheme))
                    .underline()
                    .frame(minHeight: 44)
            }
            .buttonStyle(.plain)
        } else {
            Button(wording.text(.clear)) { confirming = true }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.ink2.resolve(scheme))
                .underline()
                .buttonStyle(.plain)
                .frame(minHeight: 44)
        }
    }
}

/// One saved card: its electorate and when it was saved, opening the card, and its delete button.
private struct SavedCardRow: View {
    @Environment(\.colorScheme) private var scheme

    let card: SavedCard
    let wording: SavedWording
    let onOpen: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Button(action: onOpen) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(card.electorate)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Theme.ink.resolve(scheme))
                    Text(wording.text(.meta, ["state": card.state, "date": card.date]))
                        .font(.caption)
                        .foregroundStyle(Theme.ink2.resolve(scheme))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            // A link to the card, as the page's row is.
            .accessibilityRemoveTraits(.isButton)
            .accessibilityAddTraits(.isLink)

            Button(action: onDelete) {
                Text(wording.text(.remove))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.ink2.resolve(scheme))
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.radius)
                            .strokeBorder(Theme.line2.resolve(scheme), lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
            .accessibilityLabel(wording.text(.removal, ["electorate": card.electorate]))
        }
    }
}
