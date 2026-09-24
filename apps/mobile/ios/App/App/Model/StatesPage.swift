import Foundation

/// A native screen's wording as its states page carries it (ADR 0019 D4b): each piece a template
/// section named by its id, with its values marked.
struct StatesPage {
    enum Part: Equatable {
        case text(String)
        case value(String)
    }

    struct Missing: Error, CustomStringConvertible {
        let screen: String
        let what: String
        var description: String { "the \(screen) wording has no \(what)" }
    }

    /// The screen the page words, by its route: `quiz` for `/states/quiz`.
    let screen: String
    /// Each template section's content, by its id.
    let sections: [String: [NativeDocument.Block]]

    init(_ page: NativeDocument) {
        var sections: [String: [NativeDocument.Block]] = [:]
        func walk(_ blocks: [NativeDocument.Block]) {
            for block in blocks {
                switch block {
                case let .section(.template, id?, content): sections[id] = content
                case let .section(_, _, content): walk(content)
                default: break
                }
            }
        }
        walk(page.blocks)
        screen = page.route.split(separator: "/").last.map(String.init) ?? page.route
        self.sections = sections
    }

    func missing(_ what: String) -> Missing { Missing(screen: screen, what: what) }

    /// A section's single paragraph.
    func paragraph(_ id: String) throws -> [NativeDocument.Inline] {
        guard let content = sections[id], content.count == 1,
              case let .paragraph(_, _, inlines) = content[0]
        else { throw missing("section \(id)") }
        return inlines
    }

    /// A piece's parts, held to the values it is filled with: a page that drops a value, or marks
    /// one the screen does not fill, is refused.
    func parts(_ id: String, values: Set<String>) throws -> [Part] {
        let parts = try paragraph(id).map { inline -> Part in
            switch inline {
            case let .text(text): return .text(text)
            case let .value(name, _): return .value(name)
            default: throw missing("plain wording in \(id)")
            }
        }
        let named = Set(parts.compactMap { part -> String? in
            if case let .value(name) = part { return name }
            return nil
        })
        guard named == values else { throw missing("\(id) with values \(values.sorted())") }
        return parts
    }

    /// A section's definition list, as term and detail pairs of plain text.
    func pairs(_ id: String) throws -> [(term: String, detail: String)] {
        guard let content = sections[id], content.count == 1,
              case let .definitions(items) = content[0], !items.isEmpty
        else { throw missing("list \(id)") }
        return try items.map { item in
            guard item.term.count == 1, case let .text(term) = item.term[0],
                  item.detail.count == 1, case let .paragraph(_, _, inlines) = item.detail[0],
                  inlines.count == 1, case let .text(detail) = inlines[0]
            else { throw missing("plain entries in \(id)") }
            return (term, detail)
        }
    }

    /// Parts with their values filled. Every value a piece names is checked when it is read.
    static func fill(_ parts: [Part], _ values: [String: String]) -> String {
        parts.map { part in
            switch part {
            case let .text(text): return text
            case let .value(name): return values[name] ?? ""
            }
        }.joined()
    }
}
