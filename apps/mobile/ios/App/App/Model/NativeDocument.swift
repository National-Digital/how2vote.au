import Foundation

/// A page the web prerendered, projected into a closed structure by
/// `scripts/build-native-documents.mjs`.
///
/// The wording is the web's: this type holds no copy of its own. Decoding is closed in both
/// directions — an unknown node, role or field is an error rather than something skipped — so a
/// page the projection learned to emit and this renderer did not learn to draw is declined, and the
/// WebView renders it instead (ADR 0018 D4).
struct NativeDocument: Equatable {
    /// The projection version this renderer draws.
    static let version = 2

    let route: String
    let title: String
    /// A data page's breadcrumb trail, ending at the page itself; nil on a page with a plain top bar.
    let crumbs: [Crumb]?
    let blocks: [Block]
    /// SHA-256 of the document's text, which the layout must reproduce from what it draws.
    let digest: String
    /// What VoiceOver should read, which the simulator test compares with the screen.
    let spoken: String
    /// What the page draws, which the layout must reproduce from the spans it shows — so text marked
    /// hidden by mistake is caught, not merely still spoken.
    let drawn: String

    enum BlockRole: String, Decodable {
        case updated, lede, note, intro, meta, source, evidence, inventory, empty
        case clearData = "clear-data"
    }

    enum InlineRole: String, Decodable {
        case provenance, evidence, primary, secondary
    }

    enum ListRole: String, Decodable {
        case rows, index
    }

    /// A native control that stands in for an interactive part of the page.
    enum Slot: String, Decodable {
        case clearData = "clear-data"
    }

    struct Crumb: Equatable {
        let label: String
        /// The route a crumb leads up to; nil for the current page.
        let href: String?
    }

    struct Definition: Equatable {
        let term: [Inline]
        let id: String?
        let detail: [Block]
    }

    struct SwitchOption: Equatable {
        let label: String
        let href: String
        let current: Bool
    }

    indirect enum Block: Equatable {
        case heading(level: Int, id: String?, content: [Inline])
        case paragraph(role: BlockRole?, id: String?, content: [Inline])
        case list(ordered: Bool, role: ListRole?, items: [[Block]])
        case definitions([Definition])
        case quote([Block])
        case section(role: BlockRole?, id: String?, content: [Block])
        case electionSwitch(label: String, options: [SwitchOption])
        case slot(Slot, controls: [String])
    }

    indirect enum Inline: Equatable {
        case text(String)
        case lineBreak
        case strong([Inline])
        case emphasis([Inline])
        case code([Inline])
        case link(href: String, external: Bool, role: InlineRole?, label: String?, content: [Inline])
        case term(href: String, content: [Inline], definition: [Inline])
        /// Read by VoiceOver, not drawn.
        case hidden([Inline])
        /// Drawn, never heard: the web's ↗ beside an external link.
        case glyph(String)
        case aside(role: InlineRole, content: [Inline])
    }

    enum DecodeError: Error, CustomStringConvertible {
        case version(Int)
        case unknownNode(String)
        case unexpectedFields(node: String, fields: [String])
        case invalid(String)

        var description: String {
            switch self {
            case let .version(v): return "projection version \(v), renderer draws \(NativeDocument.version)"
            case let .unknownNode(t): return "unknown node \"\(t)\""
            case let .unexpectedFields(node, fields):
                return "\(node) carries fields this renderer does not draw: \(fields.joined(separator: ", "))"
            case let .invalid(reason): return reason
            }
        }
    }
}

// MARK: - Decoding

extension NativeDocument: Decodable {
    init(from decoder: Decoder) throws {
        let c = try Strict(decoder, node: "document", fields: ["v", "route", "title", "crumbs", "blocks", "digest", "spoken", "drawn"])
        let v = try c.decode(Int.self, "v")
        guard v == Self.version else { throw DecodeError.version(v) }
        route = try c.decode(String.self, "route")
        title = try c.decode(String.self, "title")
        crumbs = try c.optional([Crumb].self, "crumbs")
        if let crumbs {
            guard crumbs.count >= 2, crumbs.last?.href == nil, crumbs.dropLast().allSatisfy({ $0.href?.hasPrefix("/") == true }) else {
                throw DecodeError.invalid("a breadcrumb trail that does not end at the page")
            }
        }
        blocks = try c.decode([Block].self, "blocks")
        digest = try c.decode(String.self, "digest")
        spoken = try c.decode(String.self, "spoken")
        drawn = try c.decode(String.self, "drawn")
    }
}

extension NativeDocument.Block: Decodable {
    init(from decoder: Decoder) throws {
        let t = try Strict.type(decoder)
        switch t {
        case "heading":
            let c = try Strict(decoder, node: t, fields: ["t", "level", "id", "c"])
            let level = try c.decode(Int.self, "level")
            guard (1...3).contains(level) else { throw NativeDocument.DecodeError.invalid("heading level \(level)") }
            self = .heading(level: level, id: try c.optional(String.self, "id"), content: try c.decode([NativeDocument.Inline].self, "c"))
        case "paragraph":
            let c = try Strict(decoder, node: t, fields: ["t", "role", "id", "c"])
            self = .paragraph(
                role: try c.optional(NativeDocument.BlockRole.self, "role"),
                id: try c.optional(String.self, "id"),
                content: try c.decode([NativeDocument.Inline].self, "c")
            )
        case "list":
            let c = try Strict(decoder, node: t, fields: ["t", "ordered", "role", "items"])
            self = .list(
                ordered: try c.decode(Bool.self, "ordered"),
                role: try c.optional(NativeDocument.ListRole.self, "role"),
                items: try c.decode([[NativeDocument.Block]].self, "items")
            )
        case "definitions":
            let c = try Strict(decoder, node: t, fields: ["t", "items"])
            self = .definitions(try c.decode([NativeDocument.Definition].self, "items"))
        case "quote":
            let c = try Strict(decoder, node: t, fields: ["t", "c"])
            self = .quote(try c.decode([NativeDocument.Block].self, "c"))
        case "section":
            let c = try Strict(decoder, node: t, fields: ["t", "role", "id", "c"])
            self = .section(
                role: try c.optional(NativeDocument.BlockRole.self, "role"),
                id: try c.optional(String.self, "id"),
                content: try c.decode([NativeDocument.Block].self, "c")
            )
        case "switch":
            let c = try Strict(decoder, node: t, fields: ["t", "label", "options"])
            let options = try c.decode([NativeDocument.SwitchOption].self, "options")
            guard options.filter(\.current).count == 1 else {
                throw NativeDocument.DecodeError.invalid("election switch without one current option")
            }
            self = .electionSwitch(label: try c.decode(String.self, "label"), options: options)
        case "slot":
            let c = try Strict(decoder, node: t, fields: ["t", "name", "controls"])
            let controls = try c.decode([String].self, "controls")
            guard !controls.isEmpty else { throw NativeDocument.DecodeError.invalid("a slot with no controls") }
            let name = try c.decode(NativeDocument.Slot.self, "name")
            // The native clear-data control draws one button; a second would be page text it drops.
            if name == .clearData, controls.count != 1 {
                throw NativeDocument.DecodeError.invalid("the clear-data slot holds \(controls.count) controls")
            }
            self = .slot(name, controls: controls)
        default:
            throw NativeDocument.DecodeError.unknownNode(t)
        }
    }
}

extension NativeDocument.Inline: Decodable {
    init(from decoder: Decoder) throws {
        let t = try Strict.type(decoder)
        typealias Inlines = [NativeDocument.Inline]
        switch t {
        case "text":
            let c = try Strict(decoder, node: t, fields: ["t", "s"])
            self = .text(try c.decode(String.self, "s"))
        case "break":
            _ = try Strict(decoder, node: t, fields: ["t"])
            self = .lineBreak
        case "glyph":
            let c = try Strict(decoder, node: t, fields: ["t", "s"])
            self = .glyph(try c.decode(String.self, "s"))
        case "strong", "em", "code", "hidden":
            let c = try Strict(decoder, node: t, fields: ["t", "c"])
            let content = try c.decode(Inlines.self, "c")
            switch t {
            case "strong": self = .strong(content)
            case "em": self = .emphasis(content)
            case "code": self = .code(content)
            default: self = .hidden(content)
            }
        case "link":
            let c = try Strict(decoder, node: t, fields: ["t", "href", "external", "role", "label", "c"])
            self = .link(
                href: try c.decode(String.self, "href"),
                external: try c.decode(Bool.self, "external"),
                role: try c.optional(NativeDocument.InlineRole.self, "role"),
                label: try c.optional(String.self, "label"),
                content: try c.decode(Inlines.self, "c")
            )
        case "term":
            let c = try Strict(decoder, node: t, fields: ["t", "href", "c", "definition"])
            self = .term(
                href: try c.decode(String.self, "href"),
                content: try c.decode(Inlines.self, "c"),
                definition: try c.decode(Inlines.self, "definition")
            )
        case "aside":
            let c = try Strict(decoder, node: t, fields: ["t", "role", "c"])
            self = .aside(role: try c.decode(NativeDocument.InlineRole.self, "role"), content: try c.decode(Inlines.self, "c"))
        default:
            throw NativeDocument.DecodeError.unknownNode(t)
        }
    }
}

extension NativeDocument.Definition: Decodable {
    init(from decoder: Decoder) throws {
        let c = try Strict(decoder, node: "definition", fields: ["term", "id", "detail"])
        term = try c.decode([NativeDocument.Inline].self, "term")
        id = try c.optional(String.self, "id")
        detail = try c.decode([NativeDocument.Block].self, "detail")
    }
}

extension NativeDocument.Crumb: Decodable {
    init(from decoder: Decoder) throws {
        let c = try Strict(decoder, node: "crumb", fields: ["label", "href"])
        label = try c.decode(String.self, "label")
        href = try c.optional(String.self, "href")
    }
}

extension NativeDocument.SwitchOption: Decodable {
    init(from decoder: Decoder) throws {
        let c = try Strict(decoder, node: "switch option", fields: ["label", "href", "current"])
        label = try c.decode(String.self, "label")
        href = try c.decode(String.self, "href")
        current = try c.decode(Bool.self, "current")
    }
}

/// A keyed container that refuses fields it was not told about, which `Decodable` otherwise ignores.
private struct Strict {
    struct Key: CodingKey {
        let stringValue: String
        var intValue: Int? { nil }
        init(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    let container: KeyedDecodingContainer<Key>

    init(_ decoder: Decoder, node: String, fields: Set<String>) throws {
        container = try decoder.container(keyedBy: Key.self)
        let extra = container.allKeys.map(\.stringValue).filter { !fields.contains($0) }
        guard extra.isEmpty else {
            throw NativeDocument.DecodeError.unexpectedFields(node: node, fields: extra.sorted())
        }
    }

    static func type(_ decoder: Decoder) throws -> String {
        try decoder.container(keyedBy: Key.self).decode(String.self, forKey: Key(stringValue: "t"))
    }

    func decode<T: Decodable>(_ type: T.Type, _ key: String) throws -> T {
        try container.decode(type, forKey: Key(stringValue: key))
    }

    func optional<T: Decodable>(_ type: T.Type, _ key: String) throws -> T? {
        try container.decodeIfPresent(type, forKey: Key(stringValue: key))
    }
}

// MARK: - Loading

extension NativeDocument {
    /// A projected page's name: its path without the leading slash, such as `privacy` or
    /// `next/parties/greens`. Anything else is never looked up.
    static func isDocumentName(_ name: String) -> Bool {
        let segments = name.split(separator: "/", omittingEmptySubsequences: false)
        return (1...3).contains(segments.count) && segments.allSatisfy { segment in
            !segment.isEmpty && segment.allSatisfy { ($0.isASCII && ($0.isLowercase || $0.isNumber)) || $0 == "-" }
        }
    }

    /// Reads and checks one projected document from the synced web assets.
    ///
    /// Throws when the file is missing, does not decode, or lays out to text other than the text the
    /// projection recorded — each of which makes the shell decline the route.
    static func load(name: String, bundle: Bundle = .main) throws -> (NativeDocument, DocumentLayout) {
        let parts = name.split(separator: "/").map(String.init)
        let directory = (["public/native-documents"] + parts.dropLast()).joined(separator: "/")
        guard isDocumentName(name), let file = parts.last,
              let url = bundle.url(forResource: file, withExtension: "json", subdirectory: directory)
        else { throw DecodeError.invalid("no projected document \"\(name)\"") }
        return try decodeChecked(Data(contentsOf: url))
    }

    /// Decodes a projected document and lays it out, refusing one whose layout does not reproduce
    /// the projection's text exactly.
    static func decodeChecked(_ data: Data) throws -> (NativeDocument, DocumentLayout) {
        let document = try JSONDecoder().decode(NativeDocument.self, from: data)
        let layout = DocumentLayout(document)
        let problems = layout.verify(against: document)
        guard problems.isEmpty else { throw DecodeError.invalid(problems.joined(separator: "; ")) }
        return (document, layout)
    }
}
