#if canImport(CryptoKit)
import CryptoKit
#endif
import Foundation

/// Decodes and lays out every projected page, and holds the decoder to refusing what it cannot draw.
///
/// Compiled from the SHIPPING model files, like `QuizLogic`. The projection records each page's text
/// digest and the text VoiceOver should read; `DocumentLayout.verify` recomputes both from the spans
/// the screen draws, so a page passes only if nothing was dropped or invented between the web's
/// HTML and the native layout.
///
/// Build and run from the repository root, after `node scripts/build-native-documents.mjs --all
/// --out "$TMPDIR/native-documents"`:
///
///     swiftc -O apps/mobile/ios/App/App/Model/NativeDocument.swift \
///            apps/mobile/ios/App/App/Model/DocumentLayout.swift \
///            apps/mobile/ios/Parity/DocumentLogic.swift -o "$TMPDIR/document-logic"
///     "$TMPDIR/document-logic" "$TMPDIR/native-documents"
@main
enum DocumentLogic {
    static func main() {
        guard CommandLine.arguments.count == 2 else {
            print("::error::usage: document-logic <projected documents directory>")
            exit(2)
        }
        let root = URL(fileURLWithPath: CommandLine.arguments[1])
        var failures: [String] = []

        let files = projected(under: root)
        guard !files.isEmpty else {
            print("::error::document logic: no projected documents under \(root.path)")
            exit(1)
        }
        for file in files {
            do {
                _ = try NativeDocument.decodeChecked(Data(contentsOf: file))
            } catch {
                failures.append("\(file.path.replacingOccurrences(of: root.path, with: "")): \(error)")
            }
        }

        var ran = 0
        let sample = try? Data(contentsOf: files[0])
        for found in [
            refusesAnUnknownNode(sample),
            refusesAnUnknownField(sample),
            refusesAnUnknownRole(sample),
            refusesAnotherVersion(sample),
            catchesTextChangedAfterProjection(sample),
            catchesTextHiddenByMistake(sample),
            catchesATitleThatIsNotTheHeading(sample),
            catchesALostAccessibleName(),
            readsLinksAndTermsAsVoiceOverDoes(),
        ] {
            ran += 1
            failures.append(contentsOf: found)
        }

        guard failures.isEmpty else {
            for failure in failures.prefix(40) { print("::error::document logic: \(failure)") }
            if failures.count > 40 { print("::error::document logic: … and \(failures.count - 40) more") }
            exit(1)
        }
        print("document logic OK — \(files.count) pages laid out with their text intact, \(ran) rules hold")
    }

    private static func projected(under root: URL) -> [URL] {
        let walker = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)
        return (walker?.allObjects as? [URL] ?? [])
            .filter { $0.pathExtension == "json" }
            .sorted { $0.path < $1.path }
    }

    // MARK: - Mutations

    /// Rewrites the first node matching `where` and returns the document re-encoded.
    private static func mutate(
        _ data: Data?,
        where match: ([String: Any]) -> Bool,
        _ change: (inout [String: Any]) -> Void
    ) -> Data? {
        guard let data, var doc = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        var done = false
        func walk(_ value: Any) -> Any {
            if var dict = value as? [String: Any] {
                if !done, match(dict) {
                    change(&dict)
                    done = true
                    return dict
                }
                for (k, v) in dict { dict[k] = walk(v) }
                return dict
            }
            if let list = value as? [Any] { return list.map(walk) }
            return value
        }
        doc["blocks"] = walk(doc["blocks"] as Any)
        return done ? try? JSONSerialization.data(withJSONObject: doc) : nil
    }

    private static func refused(_ data: Data?, _ what: String) -> [String] {
        guard let data else { return ["the fixture for \"\(what)\" could not be built"] }
        return (try? NativeDocument.decodeChecked(data)) == nil ? [] : [what]
    }

    private static func isText(_ n: [String: Any]) -> Bool { n["t"] as? String == "text" }

    private static func refusesAnUnknownNode(_ sample: Data?) -> [String] {
        refused(
            mutate(sample, where: isText) { $0["t"] = "marquee" },
            "a node type the renderer does not know was accepted"
        )
    }

    private static func refusesAnUnknownField(_ sample: Data?) -> [String] {
        refused(
            mutate(sample, where: isText) { $0["colour"] = "red" },
            "a field the renderer does not draw was accepted"
        )
    }

    private static func refusesAnUnknownRole(_ sample: Data?) -> [String] {
        refused(
            mutate(sample, where: { $0["t"] as? String == "paragraph" }) { $0["role"] = "callout" },
            "a paragraph role the renderer has no style for was accepted"
        )
    }

    private static func refusesAnotherVersion(_ sample: Data?) -> [String] {
        guard let sample, var doc = try? JSONSerialization.jsonObject(with: sample) as? [String: Any] else {
            return ["the version fixture could not be built"]
        }
        doc["v"] = NativeDocument.version + 1
        return refused(try? JSONSerialization.data(withJSONObject: doc), "a document of another projection version was accepted")
    }

    /// The digest is the projection's: a word changed anywhere after it was taken is caught.
    private static func catchesTextChangedAfterProjection(_ sample: Data?) -> [String] {
        refused(
            mutate(sample, where: { isText($0) && ($0["s"] as? String)?.count ?? 0 > 3 }) {
                $0["s"] = String(($0["s"] as? String ?? "").dropLast())
            },
            "a document whose text no longer matches its digest was accepted"
        )
    }

    /// Text wrongly marked hidden is still in the digest and still spoken, so only the drawn text
    /// can catch it: it would vanish from the screen and every other check would pass.
    private static func catchesTextHiddenByMistake(_ sample: Data?) -> [String] {
        refused(
            mutate(sample, where: { isText($0) && ($0["s"] as? String)?.count ?? 0 > 3 }) { node in
                node = ["t": "hidden", "c": [node]]
            },
            "text hidden from the screen by mistake was accepted"
        )
    }

    private static func catchesATitleThatIsNotTheHeading(_ sample: Data?) -> [String] {
        guard let sample, var doc = try? JSONSerialization.jsonObject(with: sample) as? [String: Any] else {
            return ["the title fixture could not be built"]
        }
        doc["title"] = "Another page"
        return refused(try? JSONSerialization.data(withJSONObject: doc), "a title that is not the page's heading was accepted")
    }

    private static let labelled = #"""
    {"v":2,"route":"/t","title":"T","digest":"DIGEST","spoken":"SPOKEN","drawn":"TSee x and division.","blocks":[
      {"t":"heading","level":1,"c":[{"t":"text","s":"T"}]},
      {"t":"paragraph","c":[{"t":"text","s":"See "},
        {"t":"link","href":"https://x.org","external":true,"label":"X on the web (cue)","c":[{"t":"text","s":"x"},{"t":"hidden","c":[{"t":"text","s":"(cue)"}]}]},
        {"t":"text","s":" and "},
        {"t":"term","href":"/glossary#d","c":[{"t":"text","s":"division"}],"definition":[{"t":"text","s":"A vote."}]},
        {"t":"text","s":"."}]}]}
    """#

    private static func fixture(spoken: String) -> Data {
        // The text the projection would record, computed independently of the layout.
        let text = "TSee x(cue) and divisionA vote.."
        let digest = sha256Hex(text)
        return Data(labelled.replacingOccurrences(of: "DIGEST", with: digest)
            .replacingOccurrences(of: "SPOKEN", with: spoken).utf8)
    }

    private static func catchesALostAccessibleName() -> [String] {
        refused(fixture(spoken: "TSee x(cue) and division."), "spoken text without the link's accessible name was accepted")
    }

    private static func readsLinksAndTermsAsVoiceOverDoes() -> [String] {
        guard let (_, layout) = try? NativeDocument.decodeChecked(fixture(spoken: "TSee X on the web (cue) and division.")) else {
            return ["a correctly projected fixture was refused"]
        }
        var failures: [String] = []
        guard case let .paragraph(_, _, run) = layout.blocks[1] else { return ["the fixture laid out without its paragraph"] }
        if run.visible != "See x and division." { failures.append("the drawn text was \"\(run.visible)\"") }
        if !layout.needsSpokenLabel(run) { failures.append("a paragraph with a labelled link was not given its spoken text") }
        if layout.terms.first?.text != "division" || layout.links.first?.external != true {
            failures.append("the fixture's term or link did not survive the layout")
        }
        return failures
    }

    private static func sha256Hex(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
