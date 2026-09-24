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
    static let version = 4

    /// The node kinds this renderer draws, by the names the projection writes. `DocumentLogic`
    /// holds these, and the role and slot cases, to `apps/mobile/ios/native-contract.json`.
    static let blockKinds = ["heading", "paragraph", "list", "definitions", "quote", "section", "switch", "slot", "logo"]
    static let inlineKinds = ["text", "break", "strong", "em", "code", "link", "term", "hidden", "aside", "glyph"]

    let route: String
    let title: String
    /// A data page's breadcrumb trail, ending at the page itself; nil on a page with a plain top bar.
    let crumbs: [Crumb]?
    /// The trail's accessible name.
    let crumbsLabel: String?
    /// A page's plain top bar; nil on a page with a breadcrumb trail or a brand bar.
    let top: TopBar?
    /// The landing's bar — the wordmark and the theme toggle; nil on every other page.
    let brand: Brand?
    let blocks: [Block]
    /// SHA-256 of the document's text, which the layout must reproduce from what it draws.
    let digest: String
    /// What VoiceOver should read, which the simulator test compares with the screen.
    let spoken: String
    /// What the page draws, which the layout must reproduce from the spans it shows — so text marked
    /// hidden by mistake is caught, not merely still spoken.
    let drawn: String

    enum BlockRole: String, Decodable, CaseIterable {
        case updated, lede, note, intro, meta, source, evidence, inventory, empty, kicker, picker, stage
        case clearData = "clear-data"
    }

    enum InlineRole: String, Decodable, CaseIterable {
        case provenance, evidence, primary, secondary, caveat
    }

    enum ListRole: String, Decodable, CaseIterable {
        case rows, index, claims, steps
    }

    /// A native control that stands in for an interactive part of the page.
    enum Slot: String, Decodable, CaseIterable {
        case clearData = "clear-data"
        case ageDeclare = "age-declare"
        case ageContinue = "age-continue"
        case landingFresh = "landing-fresh"
        case landingResume = "landing-resume"
        case landingComplete = "landing-complete"
        case themeLight = "theme-light"
        case themeDark = "theme-dark"

        /// The actions its buttons carry — `SLOT_ACTIONS` in `build-native-documents.mjs`. A link
        /// carries a route instead.
        var actions: [String] {
            switch self {
            case .clearData: return ["clear"]
            case .ageDeclare: return ["adult", "minor"]
            case .ageContinue: return ["continue"]
            case .landingFresh: return ["start"]
            case .landingResume: return ["resume", "start"]
            case .landingComplete: return ["card", "start"]
            case .themeLight, .themeDark: return ["theme"]
            }
        }

        /// Whether its controls may include a link to a route beside its buttons.
        var allowsLinks: Bool { self == .landingFresh }
    }

    struct Brand: Equatable {
        /// The wordmark's accessible name.
        let logo: String
        let theme: Bool
    }

    /// One control of a slot, labelled as the page labels it.
    struct Control: Equatable {
        /// The label, with each `{name}` standing for a value the page marked.
        let label: String
        /// What a button does, as the page names it; nil for a link.
        let action: String?
        /// The route a link leads to; nil for a button.
        let href: String?
        /// The page's own value for each `{name}`, which a screen may replace with the voter's.
        let values: [String: String]
        /// True for an icon button: the label is its accessible name, heard and never drawn.
        let named: Bool

        /// The label with its values filled — the page's, or those given.
        func text(_ values: [String: String] = [:]) -> String {
            var out = label
            for (name, sample) in self.values {
                out = out.replacingOccurrences(of: "{\(name)}", with: values[name] ?? sample)
            }
            return out
        }
    }

    struct TopBar: Equatable {
        let label: String
        /// The back button's accessible name; nil when the bar has no back button.
        let back: String?
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
        case slot(Slot, controls: [Control])
        /// The drawn wordmark, by the name the page gives it.
        case logo(label: String)
    }

    /// A glossary term's popover: its definition, its accessible name and its two controls.
    struct TermPopover: Equatable {
        let definition: [Inline]
        let label: String
        let more: String
        let close: String
    }

    indirect enum Inline: Equatable {
        case text(String)
        case lineBreak
        case strong([Inline])
        case emphasis([Inline])
        case code([Inline])
        case link(href: String, external: Bool, role: InlineRole?, label: String?, content: [Inline])
        case term(href: String, content: [Inline], popover: TermPopover)
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
        let c = try Strict(
            decoder,
            node: "document",
            fields: ["v", "route", "title", "crumbs", "crumbsLabel", "top", "brand", "blocks", "digest", "spoken", "drawn"]
        )
        let v = try c.decode(Int.self, "v")
        guard v == Self.version else { throw DecodeError.version(v) }
        route = try c.decode(String.self, "route")
        title = try c.decode(String.self, "title")
        crumbs = try c.optional([Crumb].self, "crumbs")
        crumbsLabel = try c.optional(String.self, "crumbsLabel")
        top = try c.optional(TopBar.self, "top")
        brand = try c.optional(Brand.self, "brand")
        // Every page has exactly one bar; a page of states may have none of its own.
        let bars = [crumbs != nil, top != nil, brand != nil].filter { $0 }.count
        let allowed = route.hasPrefix("/states/") ? 0...1 : 1...1
        guard allowed.contains(bars), (crumbs == nil) == (crumbsLabel == nil) else {
            throw DecodeError.invalid("a page needs exactly one of a top bar, a breadcrumb trail and a brand bar")
        }
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
        guard NativeDocument.blockKinds.contains(t) else { throw NativeDocument.DecodeError.unknownNode(t) }
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
            let controls = try c.decode([NativeDocument.Control].self, "controls")
            let name = try c.decode(NativeDocument.Slot.self, "name")
            // Each slot's buttons are exactly the actions it is drawn for, and every other control is
            // a link: a page cannot add a button the native control would drop, nor swap what one
            // does by moving it.
            guard controls.compactMap(\.action).sorted() == name.actions.sorted(),
                  controls.allSatisfy({ ($0.action == nil) != ($0.href == nil) }),
                  name.allowsLinks || controls.allSatisfy({ $0.href == nil })
            else {
                throw NativeDocument.DecodeError.invalid("the \(name.rawValue) slot's actions are not \(name.actions)")
            }
            self = .slot(name, controls: controls)
        case "logo":
            let c = try Strict(decoder, node: t, fields: ["t", "label"])
            self = .logo(label: try c.decode(String.self, "label"))
        default:
            throw NativeDocument.DecodeError.unknownNode(t)
        }
    }
}

extension NativeDocument.Inline: Decodable {
    init(from decoder: Decoder) throws {
        let t = try Strict.type(decoder)
        guard NativeDocument.inlineKinds.contains(t) else { throw NativeDocument.DecodeError.unknownNode(t) }
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
            let c = try Strict(decoder, node: t, fields: ["t", "href", "c", "definition", "label", "more", "close"])
            self = .term(
                href: try c.decode(String.self, "href"),
                content: try c.decode(Inlines.self, "c"),
                popover: NativeDocument.TermPopover(
                    definition: try c.decode(Inlines.self, "definition"),
                    label: try c.decode(String.self, "label"),
                    more: try c.decode(String.self, "more"),
                    close: try c.decode(String.self, "close")
                )
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

extension NativeDocument.Brand: Decodable {
    init(from decoder: Decoder) throws {
        let c = try Strict(decoder, node: "brand bar", fields: ["logo", "theme"])
        logo = try c.decode(String.self, "logo")
        theme = try c.decode(Bool.self, "theme")
    }
}

extension NativeDocument.Control: Decodable {
    init(from decoder: Decoder) throws {
        let c = try Strict(decoder, node: "control", fields: ["label", "action", "href", "values", "named"])
        label = try c.decode(String.self, "label")
        action = try c.optional(String.self, "action")
        href = try c.optional(String.self, "href")
        values = try c.optional([String: String].self, "values") ?? [:]
        named = try c.optional(Bool.self, "named") ?? false
        for name in values.keys where !label.contains("{\(name)}") {
            throw NativeDocument.DecodeError.invalid("a control value \"\(name)\" its label does not use")
        }
        // A link leads to one of the app's own routes; an icon button is a button.
        if let href, !href.hasPrefix("/") || href.hasPrefix("//") || href.contains("\\") {
            throw NativeDocument.DecodeError.invalid("a control link that is not a route")
        }
        if named, href != nil {
            throw NativeDocument.DecodeError.invalid("a named control that is not a button")
        }
    }
}

extension NativeDocument.TopBar: Decodable {
    init(from decoder: Decoder) throws {
        let c = try Strict(decoder, node: "top bar", fields: ["label", "back"])
        label = try c.decode(String.self, "label")
        back = try c.optional(String.self, "back")
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
