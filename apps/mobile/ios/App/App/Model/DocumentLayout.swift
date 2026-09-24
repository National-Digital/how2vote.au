#if canImport(CryptoKit)
import CryptoKit
#endif
import Foundation

/// A projected document flattened into what the screen draws: runs of styled spans, with the links
/// and glossary terms they point at.
///
/// Kept apart from the view and free of SwiftUI so it runs under `swiftc` on the command line. The
/// view draws spans and nothing else, and the text the projection recorded is recomputed from the
/// spans — so a node the layout drops, or text it invents, fails `verify` before anything is shown.
struct DocumentLayout: Equatable {
    struct Span: Equatable {
        var text: String
        var strong = false
        var emphasis = false
        var code = false
        /// A de-emphasised aside within running text.
        var muted = false
        /// Read by VoiceOver, not drawn.
        var hidden = false
        /// Drawn beside the text and not part of it, nor of what VoiceOver hears.
        var decorative = false
        /// Index into `links`.
        var link: Int?
        /// Index into `terms`.
        var term: Int?
    }

    struct Run: Equatable {
        var spans: [Span] = []

        /// The drawn text.
        var visible: String { spans.filter { !$0.hidden }.map(\.text).joined() }
    }

    struct Link: Equatable {
        let href: String
        let external: Bool
        /// An accessible name that replaces the link's text for VoiceOver.
        let label: String?
        let primary: Bool
    }

    struct Term: Equatable {
        let href: String
        let text: String
        let definition: Run
    }

    indirect enum Block: Equatable {
        case heading(level: Int, id: String?, run: Run)
        case paragraph(role: NativeDocument.BlockRole?, id: String?, run: Run)
        case list(ordered: Bool, role: NativeDocument.ListRole?, items: [[Block]])
        case definitions([(term: Run, id: String?, detail: [Block])])
        case quote([Block])
        case section(role: NativeDocument.BlockRole?, id: String?, content: [Block])
        case electionSwitch(label: String, options: [NativeDocument.SwitchOption])
        case slot(NativeDocument.Slot, controls: [String])

        static func == (lhs: Block, rhs: Block) -> Bool {
            switch (lhs, rhs) {
            case let (.heading(a, b, c), .heading(d, e, f)): return a == d && b == e && c == f
            case let (.paragraph(a, b, c), .paragraph(d, e, f)): return a == d && b == e && c == f
            case let (.list(a, b, c), .list(d, e, f)): return a == d && b == e && c == f
            case let (.definitions(a), .definitions(b)):
                return a.count == b.count && zip(a, b).allSatisfy { $0.term == $1.term && $0.id == $1.id && $0.detail == $1.detail }
            case let (.quote(a), .quote(b)): return a == b
            case let (.section(a, b, c), .section(d, e, f)): return a == d && b == e && c == f
            case let (.electionSwitch(a, b), .electionSwitch(c, d)): return a == c && b == d
            case let (.slot(a, b), .slot(c, d)): return a == c && b == d
            default: return false
            }
        }
    }

    let title: String
    private(set) var blocks: [Block] = []
    private(set) var links: [Link] = []
    private(set) var terms: [Term] = []

    init(_ document: NativeDocument) {
        title = document.title
        var laid: [Block] = []
        for block in document.blocks { laid.append(lay(block)) }
        blocks = laid
    }

    // MARK: Building

    private mutating func lay(_ block: NativeDocument.Block) -> Block {
        switch block {
        case let .heading(level, id, content):
            return .heading(level: level, id: id, run: run(content))
        case let .paragraph(role, id, content):
            return .paragraph(role: role, id: id, run: run(content))
        case let .list(ordered, role, items):
            return .list(ordered: ordered, role: role, items: items.map { $0.map { lay($0) } })
        case let .definitions(items):
            return .definitions(items.map { (term: run($0.term), id: $0.id, detail: $0.detail.map { lay($0) }) })
        case let .quote(content):
            return .quote(content.map { lay($0) })
        case let .section(role, id, content):
            return .section(role: role, id: id, content: content.map { lay($0) })
        case let .electionSwitch(label, options):
            return .electionSwitch(label: label, options: options)
        case let .slot(slot, controls):
            return .slot(slot, controls: controls)
        }
    }

    private mutating func run(_ inlines: [NativeDocument.Inline]) -> Run {
        var out = Run()
        append(inlines, style: Span(text: ""), to: &out)
        return out
    }

    private mutating func append(_ inlines: [NativeDocument.Inline], style: Span, to run: inout Run) {
        for inline in inlines {
            var s = style
            switch inline {
            case let .text(text):
                s.text = text
                run.spans.append(s)
            case .lineBreak:
                s.text = "\n"
                run.spans.append(s)
            case let .strong(content):
                s.strong = true
                append(content, style: s, to: &run)
            case let .emphasis(content):
                s.emphasis = true
                append(content, style: s, to: &run)
            case let .code(content):
                s.code = true
                append(content, style: s, to: &run)
            case let .hidden(content):
                s.hidden = true
                append(content, style: s, to: &run)
            case let .glyph(glyph):
                s.text = glyph
                s.decorative = true
                run.spans.append(s)
            case let .aside(_, content):
                s.muted = true
                append(content, style: s, to: &run)
            case let .link(href, external, role, label, content):
                links.append(Link(href: href, external: external, label: label, primary: role == .primary))
                s.link = links.count - 1
                append(content, style: s, to: &run)
            case let .term(href, content, definition):
                let definitionRun = self.run(definition)
                terms.append(Term(href: href, text: Self.plain(content), definition: definitionRun))
                s.term = terms.count - 1
                append(content, style: s, to: &run)
            }
        }
    }

    private static func plain(_ inlines: [NativeDocument.Inline]) -> String {
        inlines.map { inline -> String in
            switch inline {
            case let .text(text): return text
            case .lineBreak: return "\n"
            case .hidden, .glyph: return ""
            case let .strong(c), let .emphasis(c), let .code(c), let .aside(_, c),
                 let .link(_, _, _, _, c), let .term(_, c, _):
                return plain(c)
            }
        }.joined()
    }

    // MARK: Text

    /// The text of a run as the projection records it: every span, drawn or spoken, with a term's
    /// definition following the term.
    func text(of run: Run) -> String {
        var out = ""
        for (i, span) in run.spans.enumerated() {
            if !span.decorative { out += span.text }
            if let t = span.term, i == run.spans.count - 1 || run.spans[i + 1].term != t {
                out += text(of: terms[t].definition)
            }
        }
        return out
    }

    /// What VoiceOver reads for a run: a labelled link is read by its label, and a term's
    /// definition waits behind the term.
    func spoken(_ run: Run) -> String {
        var out = ""
        var i = 0
        while i < run.spans.count {
            let span = run.spans[i]
            if let l = span.link, let label = links[l].label {
                out += label
                while i < run.spans.count, run.spans[i].link == l { i += 1 }
                continue
            }
            if !span.decorative { out += span.text }
            i += 1
        }
        return out
    }

    /// True when VoiceOver must be given the run's text, because it differs from what is drawn.
    func needsSpokenLabel(_ run: Run) -> Bool {
        spoken(run) != run.visible
    }

    var text: String { blocksText(blocks, text(of:)) }

    var spokenText: String { blocksText(blocks, spoken) }

    /// The text the screen draws: each run's visible spans, glyphs included.
    var drawnText: String { blocksText(blocks, \.visible) }

    private func blocksText(_ blocks: [Block], _ runText: (Run) -> String) -> String {
        blocks.map { block -> String in
            switch block {
            case let .heading(_, _, run), let .paragraph(_, _, run):
                return runText(run)
            case let .list(_, _, items):
                return items.map { blocksText($0, runText) }.joined()
            case let .definitions(items):
                return items.map { runText($0.term) + blocksText($0.detail, runText) }.joined()
            case let .quote(content), let .section(_, _, content):
                return blocksText(content, runText)
            case let .electionSwitch(_, options):
                return options.map(\.label).joined()
            case let .slot(_, controls):
                return controls.joined()
            }
        }.joined()
    }

    /// The ways this layout departs from the projection it was built from. Empty means the screen
    /// will draw every character the web page carries, and VoiceOver will be given what it reads.
    func verify(against document: NativeDocument) -> [String] {
        var problems: [String] = []
        let hash = SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
        if hash != document.digest {
            problems.append("the layout's text does not match the projection's digest")
        }
        if spokenText != document.spoken {
            problems.append("the layout's spoken text differs from the projection's")
        }
        if drawnText != document.drawn {
            problems.append("the layout draws text other than the page does")
        }
        // The title names the screen and heads its top bar, so it must be the page's own heading as
        // drawn.
        let heading = blocks.lazy.compactMap { block -> String? in
            if case let .heading(1, _, run) = block { return run.visible }
            return nil
        }.first
        if heading != document.title {
            problems.append("the title is not the page's heading")
        }
        return problems
    }
}
