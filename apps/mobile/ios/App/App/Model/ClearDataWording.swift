import Foundation

/// The "clear all my data" control's confirmation, from the web's `states/clear-data` page (ADR 0019
/// D4b): the question, its two answers, and the confirming button's label while the wipe runs.
///
/// Nothing here is written natively. A page that drops a piece is refused, and the page that holds
/// the control is declined for the WebView's.
struct ClearDataWording: Equatable {
    /// The pieces, by the name the page gives each section (`clear-<name>`).
    enum Piece: String, CaseIterable {
        case ask, confirm, clearing, cancel
    }

    private let pieces: [Piece: String]

    init(_ page: NativeDocument) throws {
        let states = StatesPage(page)
        var pieces: [Piece: String] = [:]
        for piece in Piece.allCases {
            pieces[piece] = StatesPage.fill(try states.parts("clear-\(piece.rawValue)", values: []), [:])
        }
        self.pieces = pieces
    }

    func text(_ piece: Piece) -> String {
        pieces[piece] ?? ""
    }

    /// Whether a page holds the control, and so cannot be drawn without this wording.
    static func isNeeded(by page: NativeDocument) -> Bool {
        func holds(_ blocks: [NativeDocument.Block]) -> Bool {
            blocks.contains { block in
                switch block {
                case .slot(.clearData, _, _): return true
                case let .section(_, _, content), let .quote(content): return holds(content)
                case let .list(_, _, items): return items.contains(where: holds)
                case let .definitions(entries): return entries.contains { holds($0.detail) }
                default: return false
                }
            }
        }
        return holds(page.blocks)
    }
}
