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

// MARK: - Rich pieces

extension StatesPage {
    /// The values a page's blocks mark, in reading order.
    static func marked(in blocks: [NativeDocument.Block]) -> [(name: String, sample: String)] {
        func inline(_ node: NativeDocument.Inline) -> [(name: String, sample: String)] {
            switch node {
            case let .value(name, sample): return [(name, sample)]
            case let .strong(c), let .emphasis(c), let .code(c), let .hidden(c), let .aside(_, c),
                 let .link(_, _, _, _, c), let .term(_, c, _):
                return c.flatMap(inline)
            case .text, .lineBreak, .glyph: return []
            }
        }
        return blocks.flatMap { block -> [(name: String, sample: String)] in
            switch block {
            case let .heading(_, _, c), let .paragraph(_, _, c): return c.flatMap(inline)
            case let .section(_, _, c), let .quote(c): return marked(in: c)
            case let .list(_, _, items): return items.flatMap { marked(in: $0) }
            case let .definitions(items): return items.flatMap { $0.term.flatMap(inline) + marked(in: $0.detail) }
            case .electionSwitch, .slot, .logo: return []
            }
        }
    }

    /// A block with each value it marks given, where one is.
    static func filling(_ block: NativeDocument.Block, _ values: [String: String]) -> NativeDocument.Block {
        func inline(_ node: NativeDocument.Inline) -> NativeDocument.Inline {
            switch node {
            case let .value(name, sample): return .value(name: name, sample: values[name] ?? sample)
            case let .strong(c): return .strong(c.map(inline))
            case let .emphasis(c): return .emphasis(c.map(inline))
            case let .code(c): return .code(c.map(inline))
            case let .hidden(c): return .hidden(c.map(inline))
            case let .aside(role, c): return .aside(role: role, content: c.map(inline))
            case let .link(href, external, role, label, c):
                return .link(href: href, external: external, role: role, label: label, content: c.map(inline))
            case .text, .lineBreak, .glyph, .term: return node
            }
        }
        switch block {
        case let .heading(level, id, c): return .heading(level: level, id: id, content: c.map(inline))
        case let .paragraph(role, id, c): return .paragraph(role: role, id: id, content: c.map(inline))
        case let .section(role, id, c): return .section(role: role, id: id, content: c.map { filling($0, values) })
        case let .quote(c): return .quote(c.map { filling($0, values) })
        case let .list(ordered, role, items):
            return .list(ordered: ordered, role: role, items: items.map { $0.map { filling($0, values) } })
        case .definitions, .electionSwitch, .slot, .logo: return block
        }
    }

    /// A piece's text as read aloud: its words, and each value it marks as given.
    static func plain(_ blocks: [NativeDocument.Block]) -> String {
        func inline(_ node: NativeDocument.Inline) -> String {
            switch node {
            case let .text(text), let .glyph(text): return text
            case let .value(_, sample): return sample
            case .lineBreak: return "\n"
            case let .strong(c), let .emphasis(c), let .code(c), let .hidden(c), let .aside(_, c),
                 let .link(_, _, _, _, c), let .term(_, c, _):
                return c.map(inline).joined()
            }
        }
        return blocks.map { block -> String in
            switch block {
            case let .heading(_, _, c), let .paragraph(_, _, c): return c.map(inline).joined()
            case let .section(_, _, c), let .quote(c): return plain(c)
            default: return ""
            }
        }.joined(separator: "\n")
    }

    /// The routes a piece links to, in reading order.
    static func links(in blocks: [NativeDocument.Block]) -> [String] {
        func inline(_ node: NativeDocument.Inline) -> [String] {
            switch node {
            case let .link(href, _, _, _, c): return [href] + c.flatMap(inline)
            case let .strong(c), let .emphasis(c), let .code(c), let .hidden(c), let .aside(_, c): return c.flatMap(inline)
            default: return []
            }
        }
        return blocks.flatMap { block -> [String] in
            switch block {
            case let .heading(_, _, c), let .paragraph(_, _, c): return c.flatMap(inline)
            case let .section(_, _, c), let .quote(c): return links(in: c)
            case let .list(_, _, items): return items.flatMap { links(in: $0) }
            default: return []
            }
        }
    }
}
