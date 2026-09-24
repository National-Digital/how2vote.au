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
/// Build and run from the repository root, after `node scripts/build-native-documents.mjs`:
///
///     swiftc -O apps/mobile/ios/App/App/Model/NativeDocument.swift \
///            apps/mobile/ios/App/App/Model/DocumentLayout.swift \
///            apps/mobile/ios/App/App/Model/LandingComposition.swift \
///            apps/mobile/ios/Parity/DocumentLogic.swift -o "$TMPDIR/document-logic"
///     "$TMPDIR/document-logic" apps/web/build/native-documents apps/mobile/ios/native-contract.json
@main
enum DocumentLogic {
    static func main() {
        guard CommandLine.arguments.count == 3 else {
            print("::error::usage: document-logic <projected documents directory> <native-contract.json>")
            exit(2)
        }
        let root = URL(fileURLWithPath: CommandLine.arguments[1])
        var failures = keepsToTheContract(URL(fileURLWithPath: CommandLine.arguments[2]))

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

        failures += composesTheLanding(root)
        failures += readsTheQuizWording(root)
        failures += readsTheBallotWording(root)
        failures += readsTheReviewWording(root)
        failures += readsTheClearDataWording(root)

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
            looksUpOnlyProjectedPageNames(),
            refusesABreadcrumbThatDoesNotEndAtThePage(sample),
            refusesAControlThatIsNotWhatItSays(try? Data(contentsOf: root.appendingPathComponent("index.json"))),
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

    /// The renderer draws exactly the vocabulary the projection may emit: a kind, role or slot the
    /// web learned and the renderer did not — or one the renderer still carries after the web
    /// dropped it — fails here, before any page is laid out.
    private static func keepsToTheContract(_ file: URL) -> [String] {
        struct Contract: Decodable {
            let version: Int
            let blocks, inlines, blockRoles, inlineRoles, listRoles, slots: [String]
            let slotActions: [String: [String]]
            let slotLinks: [String]
        }
        guard let data = try? Data(contentsOf: file),
              let contract = try? JSONDecoder().decode(Contract.self, from: data)
        else { return ["the contract at \(file.path) could not be read"] }
        var failures: [String] = []
        func same(_ what: String, _ contract: [String], _ renderer: [String]) {
            let want = Set(contract), have = Set(renderer)
            for missing in want.subtracting(have).sorted() {
                failures.append("the contract has \(what) \"\(missing)\", which the renderer does not draw")
            }
            for extra in have.subtracting(want).sorted() {
                failures.append("the renderer draws \(what) \"\(extra)\", which the contract does not have")
            }
        }
        if contract.version != NativeDocument.version {
            failures.append("the contract is version \(contract.version); the renderer draws \(NativeDocument.version)")
        }
        same("block", contract.blocks, NativeDocument.blockKinds)
        same("inline", contract.inlines, NativeDocument.inlineKinds)
        same("block role", contract.blockRoles, NativeDocument.BlockRole.allCases.map(\.rawValue))
        same("inline role", contract.inlineRoles, NativeDocument.InlineRole.allCases.map(\.rawValue))
        same("list role", contract.listRoles, NativeDocument.ListRole.allCases.map(\.rawValue))
        same("slot", contract.slots, NativeDocument.Slot.allCases.map(\.rawValue))
        for slot in NativeDocument.Slot.allCases where contract.slotActions[slot.rawValue] != slot.actions.sorted() {
            failures.append("the \(slot.rawValue) slot's actions differ from the contract's")
        }
        same("slot allowing links", contract.slotLinks, NativeDocument.Slot.allCases.filter(\.allowsLinks).map(\.rawValue))
        // Listing a kind is not drawing it: each must actually decode, from a node of its own.
        same("block fixture", contract.blocks, Array(blockFixtures.keys))
        same("inline fixture", contract.inlines, Array(inlineFixtures.keys))
        for (kind, json) in blockFixtures.sorted(by: { $0.key < $1.key })
            where (try? JSONDecoder().decode(NativeDocument.Block.self, from: Data(json.utf8))) == nil {
            failures.append("the renderer lists block \"\(kind)\" but does not decode one")
        }
        for (kind, json) in inlineFixtures.sorted(by: { $0.key < $1.key })
            where (try? JSONDecoder().decode(NativeDocument.Inline.self, from: Data(json.utf8))) == nil {
            failures.append("the renderer lists inline \"\(kind)\" but does not decode one")
        }
        return failures
    }

    private static let text = #"{"t":"text","s":"x"}"#

    /// One minimal node of every kind the contract names.
    private static let blockFixtures: [String: String] = [
        "heading": #"{"t":"heading","level":2,"c":[\#(text)]}"#,
        "paragraph": #"{"t":"paragraph","c":[\#(text)]}"#,
        "list": #"{"t":"list","ordered":false,"items":[[{"t":"paragraph","c":[\#(text)]}]]}"#,
        "definitions": #"{"t":"definitions","items":[{"term":[\#(text)],"detail":[]}]}"#,
        "quote": #"{"t":"quote","c":[{"t":"paragraph","c":[\#(text)]}]}"#,
        "section": #"{"t":"section","c":[]}"#,
        "switch": #"{"t":"switch","label":"E","options":[{"label":"A","href":"/a","current":true}]}"#,
        "slot": #"{"t":"slot","name":"clear-data","controls":[{"label":"Clear","action":"clear"}]}"#,
        "logo": #"{"t":"logo","label":"L"}"#,
    ]

    private static let inlineFixtures: [String: String] = [
        "text": text,
        "break": #"{"t":"break"}"#,
        "strong": #"{"t":"strong","c":[\#(text)]}"#,
        "em": #"{"t":"em","c":[\#(text)]}"#,
        "code": #"{"t":"code","c":[\#(text)]}"#,
        "link": #"{"t":"link","href":"/a","external":false,"c":[\#(text)]}"#,
        "term": #"{"t":"term","href":"/g","c":[\#(text)],"definition":[\#(text)],"label":"D","more":"M","close":"C"}"#,
        "hidden": #"{"t":"hidden","c":[\#(text)]}"#,
        "aside": #"{"t":"aside","role":"provenance","c":[\#(text)]}"#,
        "glyph": #"{"t":"glyph","s":"↗"}"#,
        "value": #"{"t":"value","name":"n","s":"1"}"#,
    ]

    /// The native landing composes the prerendered landing with the states page. For every election,
    /// composing it with the stage it was prerendered at and a first visit's progress must give back
    /// the prerendered page exactly — which is what proves the states page and the real page agree,
    /// word for word. Every other stage and progress must compose too.
    private static func composesTheLanding(_ root: URL) -> [String] {
        func load(_ name: String) -> NativeDocument? {
            (try? Data(contentsOf: root.appendingPathComponent("\(name).json")))
                .flatMap { try? NativeDocument.decodeChecked($0).0 }
        }
        guard let states = load("states/landing") else { return ["the landing states page is missing"] }
        var failures: [String] = []
        if (try? LandingComposition.themeLabels(in: states)) == nil {
            failures.append("the states page has no theme labels")
        }
        // A landing is a page with the brand bar, whatever its election is called.
        let files = (try? FileManager.default.contentsOfDirectory(atPath: root.path)) ?? []
        let names = files.compactMap { file -> String? in
            guard file.hasSuffix(".json") else { return nil }
            let name = String(file.dropLast(5))
            return load(name)?.brand != nil ? name : nil
        }
        if !names.contains("index") { failures.append("the current election's landing is missing") }
        for name in names.sorted() {
            guard let landing = load(name) else {
                failures.append("\(name): the landing did not load")
                continue
            }
            let election = name == "index" ? electionOf(landing) : name
            guard let election, let built = LandingComposition.prerenderedPhase(of: landing, electionID: election) else {
                failures.append("\(name): the landing names no stage")
                continue
            }
            failures += laysOutClaimsAndSteps(DocumentLayout(landing), name: name)
            do {
                let same = try LandingComposition.compose(
                    landing: landing, states: states, electionID: election, phase: built, progress: .fresh
                )
                if DocumentLayout(same).text != DocumentLayout(landing).text {
                    failures.append("\(name): the states page's \(built) wording differs from the landing's own")
                }
                for phase in ["upcoming", "live", "archived"] {
                    for progress in [LandingComposition.Progress.fresh, .partway(next: 3, total: 29), .complete] {
                        let composed = try LandingComposition.compose(
                            landing: landing, states: states, electionID: election, phase: phase, progress: progress
                        )
                        failures += laysOutClaimsAndSteps(DocumentLayout(composed), name: "\(name) (\(phase), \(progress))")
                        // The voter's own numbers, never the states page's samples.
                        let text = DocumentLayout(composed).text
                        if case .partway = progress, !text.contains("question 3 of 29") {
                            failures.append("\(name): the resume call to action does not show the voter's place")
                        }
                    }
                }
            } catch {
                failures.append("\(name): \(error)")
            }
        }
        // A states page missing a stage is refused rather than drawn with the wrong one.
        if let landing = load("index"), let election = electionOf(landing) {
            let pruned = NativeDocument(
                route: states.route, title: states.title, crumbs: nil, crumbsLabel: nil,
                top: states.top, brand: nil,
                blocks: states.blocks.filter {
                    if case let .section(.stage, id?, _) = $0 { return !id.hasSuffix("-archived") }
                    return true
                },
                digest: "", spoken: "", drawn: ""
            )
            if (try? LandingComposition.compose(
                landing: landing, states: pruned, electionID: election, phase: "archived", progress: .fresh
            )) != nil {
                failures.append("a landing composed from a states page missing its stage")
            }
            // Composed as another election's, it is refused rather than given that one's wording.
            if let other = names.first(where: { $0 != "index" && $0 != election }),
               (try? LandingComposition.compose(
                   landing: landing, states: states, electionID: other, phase: "archived", progress: .fresh
               )) != nil {
                failures.append("the current election's landing composed as \(other)'s")
            }
        }
        return failures
    }

    /// The quiz draws every word from the web's quiz page. It must yield the whole wording — each
    /// piece with the values the screen fills, and the answer scale recording each of 0 to 5 once —
    /// and a page missing a piece must be refused rather than drawn with a gap.
    private static func readsTheQuizWording(_ root: URL) -> [String] {
        guard let data = try? Data(contentsOf: root.appendingPathComponent("states/quiz.json")),
              let (page, _) = try? NativeDocument.decodeChecked(data)
        else { return ["the quiz states page is missing or does not lay out"] }
        var failures: [String] = []
        do {
            let wording = try QuizWording(page)
            let points = wording.answers.map(\.points)
            if points.sorted() != [0, 1, 2, 3, 4, 5] {
                failures.append("the quiz's answers record \(points), not each of 0 to 5 once")
            }
            // Each answer records exactly what the page's own button names, under the page's label:
            // the projection holds the page to the web's scale, and this holds the native answers to
            // the page.
            var controls: [NativeDocument.Control] = []
            func walk(_ blocks: [NativeDocument.Block]) {
                for block in blocks {
                    if case let .slot(.quizAnswer, _, found) = block { controls = found }
                    if case let .section(_, _, content) = block { walk(content) }
                }
            }
            walk(page.blocks)
            let expected = controls.map { QuizWording.Answer(points: Int($0.action ?? "") ?? -1, label: $0.text(), sub: $0.sub) }
            if wording.answers != expected {
                failures.append("the quiz records answers other than the page names: \(wording.answers.map { "\($0.label)=\($0.points)" })")
            }
            if !wording.position(3, of: 29).contains("3") || !wording.position(3, of: 29).contains("29") {
                failures.append("the quiz's position does not show the voter's place")
            }
        } catch {
            failures.append("the quiz wording: \(error)")
        }
        let pruned = NativeDocument(
            route: page.route, title: page.title, crumbs: nil, crumbsLabel: nil, top: page.top, brand: nil,
            blocks: page.blocks.filter {
                if case let .section(.template, id?, _) = $0 { return id != "quiz-pause" }
                return true
            },
            digest: "", spoken: "", drawn: ""
        )
        if (try? QuizWording(pruned)) != nil {
            failures.append("a quiz wording missing a piece was accepted")
        }
        return failures
    }

    /// The ballot picker's wording is read whole from its states page, and a page that loses a
    /// piece, offers a repeated state, or points its lookup anywhere but an https page is refused.
    private static func readsTheBallotWording(_ root: URL) -> [String] {
        guard let data = try? Data(contentsOf: root.appendingPathComponent("states/ballot.json")),
              let (page, _) = try? NativeDocument.decodeChecked(data)
        else { return ["the ballot states page is missing or does not lay out"] }
        var failures: [String] = []
        do {
            let wording = try BallotWording(page)
            if wording.states.isEmpty { failures.append("the ballot offers no states") }
            if wording.states.map(\.code) != wording.states.map(\.code).sorted() {
                failures.append("the ballot's states are not in the picker's order: \(wording.states.map(\.code))")
            }
            if !wording.position(2, of: 3).contains("2") || !wording.position(2, of: 3).contains("3") {
                failures.append("the ballot's position does not show the voter's step")
            }
            let unsure = wording.around(.unsure)
            if unsure.before.isEmpty
                || unsure.before + wording.text(.lookup) + unsure.after != wording.text(.unsure, ["lookup": wording.text(.lookup)]) {
                failures.append("the lookup sentence does not split around its link: \(unsure)")
            }
            if let first = wording.states.first, wording.name(for: first.code.lowercased()) != first.name {
                failures.append("a state code is not matched as the web matches it, ignoring case")
            }
        } catch {
            failures.append("the ballot wording: \(error)")
        }

        func edited(_ edit: (NativeDocument.Block) -> NativeDocument.Block?) -> NativeDocument {
            NativeDocument(
                route: page.route, title: page.title, crumbs: nil, crumbsLabel: nil, top: page.top, brand: nil,
                blocks: page.blocks.compactMap(edit), digest: "", spoken: "", drawn: ""
            )
        }
        func section(_ block: NativeDocument.Block, _ id: String, _ content: [NativeDocument.Block]) -> NativeDocument.Block {
            if case .section(.template, id, _) = block { return .section(role: .template, id: id, content: content) }
            return block
        }
        func paragraph(_ inlines: [NativeDocument.Inline]) -> [NativeDocument.Block] {
            [.paragraph(role: nil, id: nil, content: inlines)]
        }
        let entry = NativeDocument.Definition(term: [.text("NSW")], id: nil, detail: paragraph([.text("New South Wales")]))
        let lookup = { (href: String, words: String) in
            paragraph([.link(href: href, external: true, role: nil, label: nil, content: [.text(words)])])
        }
        let words = (try? BallotWording(page)).map { $0.text(.lookup) } ?? ""
        let refused: [(String, NativeDocument)] = [
            ("missing a piece", edited {
                if case .section(.template, "ballot-start", _) = $0 { return nil }
                return $0
            }),
            ("marking a value the screen does not fill", edited {
                section($0, "ballot-start", paragraph([.text("Start in "), .value(name: "state", sample: "NSW")]))
            }),
            ("offering a state twice", edited { section($0, "ballot-states", [.definitions([entry, entry])]) }),
            ("offering no states", edited { section($0, "ballot-states", [.definitions([])]) }),
            ("with two national ballots", edited { section($0, "ballot-national", [.definitions([entry, entry])]) }),
            ("linking its lookup over http", edited {
                section($0, "ballot-lookup-link", lookup("http://check.aec.gov.au/", words))
            }),
            ("linking other words than its lookup piece", edited {
                section($0, "ballot-lookup-link", lookup("https://check.aec.gov.au/", "Somewhere else"))
            }),
        ]
        for (what, mutated) in refused where (try? BallotWording(mutated)) != nil {
            failures.append("a ballot wording \(what) was accepted")
        }
        return failures
    }

    /// The clear-data control's confirmation is the web's: every piece, each distinct, and the privacy
    /// page that holds the control is recognised as needing it. A page missing a piece is refused.
    private static func readsTheClearDataWording(_ root: URL) -> [String] {
        guard let data = try? Data(contentsOf: root.appendingPathComponent("states/clear-data.json")),
              let (page, _) = try? NativeDocument.decodeChecked(data)
        else { return ["the clear-data states page is missing or does not lay out"] }
        var failures: [String] = []
        do {
            let wording = try ClearDataWording(page)
            let texts = ClearDataWording.Piece.allCases.map(wording.text)
            if texts.contains(where: \.isEmpty) || Set(texts).count != texts.count {
                failures.append("the clear-data confirmation's pieces are not each worded and distinct: \(texts)")
            }
        } catch {
            failures.append("the clear-data wording: \(error)")
        }
        if let privacy = try? Data(contentsOf: root.appendingPathComponent("privacy.json")),
           let (policy, _) = try? NativeDocument.decodeChecked(privacy) {
            if !ClearDataWording.isNeeded(by: policy) {
                failures.append("the privacy page's clear-data control is not recognised, so it would be drawn without its confirmation")
            }
        } else {
            failures.append("the privacy page could not be read to find its clear-data control")
        }
        let missing = NativeDocument(
            route: page.route, title: page.title, crumbs: nil, crumbsLabel: nil, top: page.top, brand: nil,
            blocks: page.blocks.filter {
                if case .section(.template, "clear-cancel", _) = $0 { return false }
                return true
            },
            digest: "", spoken: "", drawn: ""
        )
        if (try? ClearDataWording(missing)) != nil {
            failures.append("a clear-data wording missing a piece was accepted")
        }
        return failures
    }

    /// The review reads each answer back by the web's own label, for every answer the quiz records,
    /// and a page that loses a piece, or names an answer twice or not by its points, is refused.
    private static func readsTheReviewWording(_ root: URL) -> [String] {
        guard let data = try? Data(contentsOf: root.appendingPathComponent("states/review.json")),
              let (page, _) = try? NativeDocument.decodeChecked(data)
        else { return ["the review states page is missing or does not lay out"] }
        var failures: [String] = []
        do {
            let wording = try ReviewWording(page)
            if let quizData = try? Data(contentsOf: root.appendingPathComponent("states/quiz.json")),
               let (quizPage, _) = try? NativeDocument.decodeChecked(quizData),
               let quiz = try? QuizWording(quizPage) {
                let recorded = Set(quiz.answers.map(\.points))
                if Set(wording.answers.keys) != recorded {
                    failures.append("the review labels answers \(wording.answers.keys.sorted()), the quiz records \(recorded.sorted())")
                }
                // Each answer is read back as the quiz words it, apart from a skip, which the review
                // names as the fact rather than the option.
                for answer in quiz.answers where answer.points != 0
                    && wording.label(points: answer.points) != answer.label {
                    failures.append("the review reads \(answer.points) as \(wording.label(points: answer.points)), the quiz as \(answer.label)")
                }
            } else {
                failures.append("the quiz wording could not be read to hold the review's labels to")
            }
            if wording.label(points: nil) != wording.text(.unanswered) {
                failures.append("an unanswered question is not read as unanswered")
            }
            if wording.label(points: 9) != wording.label(points: 0) {
                failures.append("an answer the scale does not define is not read as a skip")
            }
            let all = wording.headline(answered: 3, total: 3), some = wording.headline(answered: 1, total: 3)
            if all != wording.text(.all, ["total": "3"]) || some != wording.text(.some, ["recorded": "1", "total": "3"])
                || all == some {
                failures.append("the review heading does not report how many are answered: \(all) / \(some)")
            }
            if wording.text(.retry).isEmpty || !wording.failed.contains(wording.text(.retry)) {
                failures.append("the review's load failure does not carry its retry: \(wording.failed)")
            }
            if wording.label(points: 0).isEmpty || wording.label(points: 0) == wording.text(.unanswered) {
                failures.append("a skip is not read back as the page's skip")
            }
            if wording.headline(answered: 0, total: 0) != wording.text(.all, ["total": "0"]) {
                failures.append("the review heading does not follow the web's rule for an empty set")
            }
            if !wording.text(.star, ["question": "Q"]).contains("Q") {
                failures.append("the star's label does not name its question")
            }
        } catch {
            failures.append("the review wording: \(error)")
        }

        func edited(_ edit: (NativeDocument.Block) -> NativeDocument.Block?) -> NativeDocument {
            NativeDocument(
                route: page.route, title: page.title, crumbs: nil, crumbsLabel: nil, top: page.top, brand: nil,
                blocks: page.blocks.compactMap(edit), digest: "", spoken: "", drawn: ""
            )
        }
        func answers(_ entries: [(String, String)]) -> (NativeDocument.Block) -> NativeDocument.Block? {
            { block in
                guard case .section(.template, "review-answers", _) = block else { return block }
                return .section(role: .template, id: "review-answers", content: [.definitions(entries.map {
                    NativeDocument.Definition(
                        term: [.text($0.0)], id: nil,
                        detail: [.paragraph(role: nil, id: nil, content: [.text($0.1)])]
                    )
                })])
            }
        }
        let refused: [(String, NativeDocument)] = [
            ("missing a piece", edited {
                if case .section(.template, "review-compare", _) = $0 { return nil }
                return $0
            }),
            ("dropping the question from the star", edited {
                guard case .section(.template, "review-star", _) = $0 else { return $0 }
                return .section(role: .template, id: "review-star", content: [
                    .paragraph(role: nil, id: nil, content: [.text("Mark as extremely important")]),
                ])
            }),
            ("naming an answer twice", edited(answers([("0", "Skipped"), ("5", "Agree"), ("5", "Strongly agree")]))),
            ("naming an answer by other than its points", edited(answers([("0", "Skipped"), ("five", "Strongly agree")]))),
            ("naming no skip", edited(answers([("5", "Strongly agree")]))),
        ]
        for (what, mutated) in refused where (try? ReviewWording(mutated)) != nil {
            failures.append("a review wording \(what) was accepted")
        }
        return failures
    }

    /// The landing's claims and steps are laid out as the web lays them out: each claim's tick set
    /// apart as its marker, and each step's name on a line above its detail. Both would otherwise run
    /// together — "✓Built from…", "1 · BallotFind your electorate" — and no text check can see it,
    /// since each ignores whitespace and markers.
    private static func laysOutClaimsAndSteps(_ layout: DocumentLayout, name: String) -> [String] {
        var failures: [String] = []
        var claims = 0, steps = 0
        func walk(_ blocks: [DocumentLayout.Block]) {
            for block in blocks {
                switch block {
                case let .list(_, role, items) where role == .claims || role == .steps:
                    for item in items {
                        guard case let .paragraph(_, _, run)? = item.first, item.count == 1 else {
                            failures.append("\(name): a \(role!.rawValue) item is not one paragraph")
                            continue
                        }
                        if role == .claims {
                            claims += 1
                            if run.splitting(after: \.decorative)?.lead.visible != "✓" {
                                failures.append("\(name): a claim has no tick of its own to mark it")
                            }
                        } else {
                            steps += 1
                            if run.splitting(after: \.strong) == nil {
                                failures.append("\(name): a step has no name to set above its detail")
                            }
                        }
                    }
                case let .section(_, _, content), let .quote(content):
                    walk(content)
                default:
                    break
                }
            }
        }
        walk(layout.blocks)
        if claims == 0 || steps == 0 { failures.append("\(name): the landing has no claims or no steps") }
        return failures
    }

    /// The election a landing page is for, from its stage section's id.
    private static func electionOf(_ landing: NativeDocument) -> String? {
        // `lede-<election>-<stage>`: the election is whatever lies between, hyphens and all.
        for case let .section(.stage, id?, _) in landing.blocks where id.hasPrefix("lede-") {
            let body = id.dropFirst("lede-".count)
            guard let cut = body.lastIndex(of: "-") else { return nil }
            return String(body[..<cut])
        }
        return nil
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

    /// A slot's link leads to one of the app's routes, and an icon button is a button: a control
    /// the native screen would open off the app, or draw as a link with no text, is refused.
    private static func refusesAControlThatIsNotWhatItSays(_ landing: Data?) -> [String] {
        let isLink: ([String: Any]) -> Bool = { $0["href"] != nil && $0["t"] == nil && $0["current"] == nil }
        return refusedAtDecode(
            mutate(landing, where: isLink) { $0["href"] = "//example.org/methodology" },
            for: "a control link that is not a route",
            "a slot link off the app's routes was accepted"
        ) + refusedAtDecode(
            mutate(landing, where: isLink) { $0["href"] = "/\\example.org" },
            for: "a control link that is not a route",
            "a slot link to a backslashed host was accepted"
        ) + refusedAtDecode(
            mutate(landing, where: isLink) { $0["named"] = true },
            for: "a named control that is not a button",
            "an icon button that is a link was accepted"
        )
    }

    /// Refused by the decoder itself, for the reason given — not by a later check that happens to
    /// catch the same fixture, which would leave the rule under test free to go.
    private static func refusedAtDecode(_ data: Data?, for reason: String, _ what: String) -> [String] {
        guard let data else { return ["the fixture for \"\(what)\" could not be built"] }
        do {
            _ = try JSONDecoder().decode(NativeDocument.self, from: data)
            return [what]
        } catch {
            return "\(error)".contains(reason) ? [] : ["\(what) — refused for another reason: \(error)"]
        }
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
    {"v":4,"route":"/t","title":"T","top":{"label":"T","back":"Back"},"digest":"DIGEST","spoken":"SPOKEN","drawn":"TSee x and division.","blocks":[
      {"t":"heading","level":1,"c":[{"t":"text","s":"T"}]},
      {"t":"paragraph","c":[{"t":"text","s":"See "},
        {"t":"link","href":"https://x.org","external":true,"label":"X on the web (cue)","c":[{"t":"text","s":"x"},{"t":"hidden","c":[{"t":"text","s":"(cue)"}]}]},
        {"t":"text","s":" and "},
        {"t":"term","href":"/glossary#d","c":[{"t":"text","s":"division"}],"definition":[{"t":"text","s":"A vote."}],"label":"Definition: Division","more":"More","close":"Shut"},
        {"t":"text","s":"."}]}]}
    """#

    private static func fixture(spoken: String) -> Data {
        // The text the projection would record, computed independently of the layout.
        let text = "TSee x(cue) and divisionA vote.MoreShut."
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
        if layout.terms.first?.text != "division" || layout.terms.first?.more != "More"
            || layout.links.first?.external != true {
            failures.append("the fixture's term or link did not survive the layout")
        }
        return failures
    }

    /// A name reaches `Bundle.url` only in the shape the projection writes, so no path escapes the
    /// projected documents.
    private static func looksUpOnlyProjectedPageNames() -> [String] {
        var failures: [String] = []
        for name in ["privacy", "next/parties", "2025/parties/greens", "next/senate/nsw"]
            where !NativeDocument.isDocumentName(name) {
            failures.append("the page name \"\(name)\" was refused")
        }
        for name in ["", "../privacy", "Privacy", "next//parties", "a/b/c/d", "privacy.json", "next/parties/"]
            where NativeDocument.isDocumentName(name) {
            failures.append("the page name \"\(name)\" was accepted")
        }
        return failures
    }

    private static func refusesABreadcrumbThatDoesNotEndAtThePage(_ sample: Data?) -> [String] {
        guard let sample, var doc = try? JSONSerialization.jsonObject(with: sample) as? [String: Any] else {
            return ["the breadcrumb fixture could not be built"]
        }
        doc["top"] = nil
        doc["crumbsLabel"] = "Breadcrumb"
        doc["crumbs"] = [["label": "Home", "href": "/"], ["label": "Elsewhere", "href": "/elsewhere"]]
        return refused(
            try? JSONSerialization.data(withJSONObject: doc),
            "a breadcrumb trail that ends at a link rather than the page was accepted"
        )
    }

    private static func sha256Hex(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
