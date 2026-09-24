import XCTest

/// Every native document shows VoiceOver the page's text, on screen, in the simulator.
///
/// `DocumentLayout.verify` proves the layout holds the projection's text; this proves the screen
/// does. It opens each document the way a voter does — from the footer — and reads the
/// accessibility tree, which is what VoiceOver reads, against the `spoken` text the projection
/// recorded from the web's HTML. A document the shell declined (drawn by the WebView instead) fails
/// here too, because the native container never appears.
final class DocumentConservationTests: XCTestCase {
    /// The footer link that opens each page tested here: every document, and the index of each
    /// election data section the footer links. A shipped document with no entry fails rather than
    /// being skipped; the data pages beneath the indexes are held by `DocumentLogic`.
    private static let footerLabels = [
        "next/issues": "Where parties stand",
        "next/parties": "Party records",
        "next/electorates": "Candidates",
        "about": "About",
        "accessibility": "Accessibility",
        "corrections": "Corrections",
        "glossary": "Glossary",
        "methodology": "How it works",
        "privacy": "Privacy policy",
        "research": "Research methods",
        "terms": "Terms of use",
    ]

    private struct Projected: Decodable {
        let title: String
        let spoken: String
    }

    /// Whether a projected page is a landing — reached by launching, not from the footer; each
    /// election's landing and every state is held to the page by `DocumentLogic`.
    private static func isLanding(_ url: URL) -> Bool {
        let json = (try? Data(contentsOf: url)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        return json?["brand"] != nil
    }

    /// The age gate's two states, reached from the landing rather than the footer.
    private static let gate: Set<String> = ["start"]

    override func setUp() {
        continueAfterFailure = true
    }

    func testEachDocumentShowsThePagesText() throws {
        let bundle = Bundle(for: Self.self)
        let files = (bundle.urls(forResourcesWithExtension: "json", subdirectory: "native-documents") ?? [])
            .filter { !Self.isLanding($0) }
        let documents = files.map { $0.deletingPathExtension().lastPathComponent }
        XCTAssertFalse(documents.isEmpty, "the test bundle carries no projected documents")
        for name in documents where Self.footerLabels[name] == nil && !Self.gate.contains(name) {
            XCTFail("\(name): no footer link is known to open it")
        }

        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(
            app.buttons[Self.footerLabels["privacy"]!].waitForExistence(timeout: 30),
            "the native landing never appeared"
        )

        for (name, label) in Self.footerLabels.sorted(by: { $0.key < $1.key }) {
            let parts = name.split(separator: "/").map(String.init)
            let directory = (["native-documents"] + parts.dropLast()).joined(separator: "/")
            guard let file = bundle.url(forResource: parts.last, withExtension: "json", subdirectory: directory),
                  let projected = try? JSONDecoder().decode(Projected.self, from: Data(contentsOf: file))
            else {
                XCTFail("\(name): not in the test bundle")
                continue
            }
            guard open(label, in: app) else {
                XCTFail("\(name): the footer link \"\(label)\" could not be reached")
                continue
            }
            guard let shown = shownDocument(startingWith: projected.spoken, in: app) else {
                XCTFail("\(name): not drawn natively — the shell declined it, or it never arrived")
                continue
            }
            compare(name, expected: projected.spoken, shown: shown)
        }
    }

    /// Data pages, reached as a voter reaches them: a party from the parties index, and — for an
    /// election with a ballot — an electorate, whose candidates are listed in ballot-paper order.
    func testDataPagesShowThePagesText() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["Party records"].waitForExistence(timeout: 30), "the native landing never appeared")

        // A party, from the parties index.
        try openAndCompare("next/parties", from: "Party records", in: app)
        try follow(firstLinkUnder: "/next/parties/", in: "next/parties", app: app)

        // An electorate: the next election has none yet, so switch the index to one that has. The
        // choice persists, and pages that belong to the current election alone are the WebView's
        // under any other, so the next test is handed the current election back.
        addTeardownBlock { [self] in XCTAssertNoThrow(try chooseTheCurrentElection(in: app)) }
        try openAndCompare("next/electorates", from: "Candidates", in: app)
        let election = try XCTUnwrap(
            firstLink(under: "/2025/electorates", in: try json("next/electorates")),
            "the electorates index offers no election with a ballot"
        )
        tapUntilShown(app.buttons[election.label].firstMatch, in: app)
        let index = try projected("2025/electorates")
        guard let shownIndex = shownDocument(startingWith: index.spoken, in: app) else {
            return XCTFail("2025/electorates: not drawn natively")
        }
        compare("2025/electorates", expected: index.spoken, shown: shownIndex)
        try follow(firstLinkUnder: "/2025/electorates/", in: "2025/electorates", app: app)
    }

    /// Switches the electorates index back to the current election, which makes it the chosen one.
    private func chooseTheCurrentElection(in app: XCUIApplication) throws {
        XCTAssertTrue(open("Candidates", in: app), "the footer link \"Candidates\" could not be reached")
        let current = try XCTUnwrap(
            firstLink(under: "/next/electorates", in: try json("2025/electorates")),
            "the electorates index offers no way back to the current election"
        )
        tapUntilShown(app.buttons[current.label].firstMatch, in: app)
        XCTAssertNotNil(
            shownDocument(startingWith: try projected("next/electorates").spoken, in: app),
            "next/electorates: not drawn natively after switching back"
        )
    }

    private func json(_ name: String) throws -> [String: Any] {
        let bundle = Bundle(for: Self.self)
        let parts = name.split(separator: "/").map(String.init)
        let directory = (["native-documents"] + parts.dropLast()).joined(separator: "/")
        let url = try XCTUnwrap(bundle.url(forResource: parts.last, withExtension: "json", subdirectory: directory), "\(name) is not in the test bundle")
        return try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }

    private func projected(_ name: String) throws -> Projected {
        let data = try JSONSerialization.data(withJSONObject: try json(name))
        return try JSONDecoder().decode(Projected.self, from: data)
    }

    /// The first link or switch option in a page whose route starts with `prefix`, and its text.
    private func firstLink(under prefix: String, in page: [String: Any]) -> (href: String, label: String)? {
        var found: (href: String, label: String)?
        func text(_ value: Any) -> String {
            if let dict = value as? [String: Any] {
                if dict["t"] as? String == "text" { return dict["s"] as? String ?? "" }
                return (dict["c"] as? [Any] ?? []).map(text).joined()
            }
            return ""
        }
        func walk(_ value: Any) {
            guard found == nil else { return }
            if let dict = value as? [String: Any] {
                if dict["t"] as? String == "link", let href = dict["href"] as? String, href.hasPrefix(prefix) {
                    found = (href, text(dict))
                    return
                }
                if dict["t"] as? String == "switch" {
                    for option in dict["options"] as? [[String: Any]] ?? [] {
                        if let href = option["href"] as? String, href.hasPrefix(prefix), let label = option["label"] as? String {
                            found = (href, label)
                            return
                        }
                    }
                }
                dict.values.forEach(walk)
            } else if let list = value as? [Any] {
                list.forEach(walk)
            }
        }
        walk(page["blocks"] as Any)
        return found
    }

    private func openAndCompare(_ name: String, from label: String, in app: XCUIApplication) throws {
        let page = try projected(name)
        XCTAssertTrue(open(label, in: app), "\(name): the footer link \"\(label)\" could not be reached")
        guard let shown = shownDocument(startingWith: page.spoken, in: app) else {
            return XCTFail("\(name): not drawn natively")
        }
        compare(name, expected: page.spoken, shown: shown)
    }

    /// Follows the first link on a page into the section below it, and holds the page it opens.
    private func follow(firstLinkUnder prefix: String, in name: String, app: XCUIApplication) throws {
        let link = try XCTUnwrap(firstLink(under: prefix, in: try json(name)), "\(name) links to nothing under \(prefix)")
        let target = String(link.href.dropFirst())
        let page = try projected(target)
        let element = app.links[link.label].firstMatch.exists ? app.links[link.label].firstMatch : app.buttons[link.label].firstMatch
        tapUntilShown(element, in: app)
        guard let shown = shownDocument(startingWith: page.spoken, in: app) else {
            return XCTFail("\(target): not drawn natively, or \"\(link.label)\" could not be followed")
        }
        compare(target, expected: page.spoken, shown: shown)
    }

    /// Scrolls until an element is on screen, then taps it.
    private func tapUntilShown(_ element: XCUIElement, in app: XCUIApplication) {
        var swipes = 0
        while !(element.exists && element.isHittable), swipes < 60 {
            app.swipeUp()
            swipes += 1
        }
        if element.exists, element.isHittable { element.tap() }
    }

    /// The landing a first-time visitor opens on: the current election's prerendered landing, which
    /// the native screen composes with the stage and progress that apply — on the day of the build
    /// and on a first visit, exactly the page itself.
    func testTheLandingShowsThePagesText() throws {
        let bundle = Bundle(for: Self.self)
        let url = try XCTUnwrap(bundle.url(forResource: "index", withExtension: "json", subdirectory: "native-documents"))
        let landing = try JSONDecoder().decode(Projected.self, from: Data(contentsOf: url))

        let app = XCUIApplication()
        app.launch()
        guard let shown = shownDocument(startingWith: landing.spoken, in: app) else {
            return XCTFail("index: the landing was not drawn natively")
        }
        compare("index", expected: landing.spoken, shown: shown)

        // The brand bar sits outside the document: its theme toggle offers the page's own label for
        // the scheme on screen, which the simulator starts in light.
        let states = try json("states/landing")
        let toggle = try XCTUnwrap(
            controls(of: "theme-light", in: states).first?.label,
            "the states page carries no light-theme toggle"
        )
        XCTAssertTrue(app.buttons[toggle].exists, "index: the theme toggle does not read \"\(toggle)\"")
    }

    /// A slot's controls in a projected page, as the page wrote them.
    private func controls(of slot: String, in page: [String: Any]) -> [(action: String?, label: String)] {
        var found: [(action: String?, label: String)] = []
        func walk(_ value: Any) {
            if let dict = value as? [String: Any] {
                if dict["t"] as? String == "slot", dict["name"] as? String == slot {
                    for control in dict["controls"] as? [[String: Any]] ?? [] {
                        if let label = control["label"] as? String {
                            found.append((control["action"] as? String, label))
                        }
                    }
                }
                dict.values.forEach(walk)
            } else if let list = value as? [Any] {
                list.forEach(walk)
            }
        }
        walk(page["blocks"] as Any)
        return found
    }

    /// The quiz, as a first-time visitor reaches it for the current election: the landing's call to
    /// action, the gate's 18+ answer, and — the election being provisional — no ballot to set. Every
    /// word it shows is the quiz page's, and the answer tapped is the one kept when the voter comes
    /// back to it. That the answer records the points the page names is `DocumentLogic`'s to hold.
    ///
    /// Named to run after the gate and landing tests: it declares the visitor 18+ and records an
    /// answer, both of which persist, so it expects a simulator the run starts clean, as CI's is.
    /// Only the ballot test runs after it.
    func testTheQuizShowsTheWebsWordingAndKeepsTheTappedAnswer() throws {
        let quiz = try json("states/quiz")
        var templates: [String: String] = [:]
        func text(_ value: Any) -> String {
            if let dict = value as? [String: Any] {
                if let s = dict["s"] as? String { return s }
                return (dict["c"] as? [Any] ?? []).map(text).joined()
            }
            return (value as? [Any] ?? []).map(text).joined()
        }
        for block in quiz["blocks"] as? [[String: Any]] ?? [] {
            if block["role"] as? String == "template", let id = block["id"] as? String {
                templates[id] = text(block["c"] as Any)
            }
        }
        /// The position as the page words it, filled up to its total, which the test does not know.
        func position(_ n: Int) throws -> String {
            let blocks = quiz["blocks"] as? [[String: Any]] ?? []
            let section = try XCTUnwrap(blocks.first { $0["id"] as? String == "quiz-position" })
            let paragraph = try XCTUnwrap((section["c"] as? [[String: Any]])?.first)
            var out = ""
            for part in paragraph["c"] as? [[String: Any]] ?? [] {
                if part["t"] as? String == "value" {
                    if part["name"] as? String != "n" { break }
                    out += String(n)
                } else {
                    out += part["s"] as? String ?? ""
                }
            }
            return out
        }
        let answers = controls(of: "quiz-answer", in: quiz)
        let agree = try XCTUnwrap(answers.first { $0.action == "5" }, "the quiz page records no 5")

        let app = XCUIApplication()
        app.launch()
        let begin = try XCTUnwrap(
            controls(of: "landing-fresh", in: try json("index")).first { $0.action == "start" }?.label
        )
        XCTAssertTrue(app.buttons[begin].waitForExistence(timeout: 30), "the native landing never appeared")
        app.buttons[begin].tap()
        let adult = try XCTUnwrap(controls(of: "age-declare", in: try json("start")).first { $0.action == "adult" }?.label)
        XCTAssertTrue(app.buttons[adult].waitForExistence(timeout: 20), "the native age gate never appeared")
        app.buttons[adult].tap()

        // The quiz's own wording, as the page writes it, on screen.
        for id in ["quiz-voted", "quiz-ask"] {
            let words = try XCTUnwrap(templates[id], "the quiz page has no \(id)")
            // The kicker style draws these in capitals, so they are matched without regard to case.
            let shown = app.staticTexts.matching(NSPredicate(format: "label ==[c] %@", words)).firstMatch
            XCTAssertTrue(shown.waitForExistence(timeout: 30), "quiz: \"\(words)\" is not on screen")
        }
        XCTAssertTrue(app.buttons[try XCTUnwrap(templates["quiz-pause"])].exists, "quiz: the pause is not the page's")
        for answer in answers {
            let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", answer.label)).firstMatch
            XCTAssertTrue(row.exists, "quiz: the answer \"\(answer.label)\" is not on screen")
        }

        // Answer with the page's 5, which moves to question 2; step back to question 1, and the answer
        // shown as chosen is the one tapped.
        func at(_ n: Int) throws -> XCUIElement {
            app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", try position(n))).firstMatch
        }
        XCTAssertTrue(try at(1).exists, "quiz: not on the first question")
        let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", agree.label)).firstMatch
        row.tap()
        XCTAssertTrue(try at(2).waitForExistence(timeout: 10), "quiz: answering did not move to the next question")
        // The bar's back button, by its identifier: the ← shortcut behind the screen shares its label.
        let back = app.buttons["top-back"]
        XCTAssertEqual(back.label, try XCTUnwrap(templates["quiz-previous"]), "quiz: the back button is not the page's")
        back.tap()
        XCTAssertTrue(try at(1).waitForExistence(timeout: 10), "quiz: stepping back did not return to the question")
        XCTAssertTrue(row.isSelected, "quiz: \"\(agree.label)\" was tapped but is not the recorded answer")
        for other in answers where other.action != "5" {
            let otherRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", other.label)).firstMatch
            XCTAssertFalse(otherRow.isSelected, "quiz: \"\(other.label)\" shows as chosen after tapping \"\(agree.label)\"")
        }
    }

    /// The ballot, as a voter sets it for an election that has one: every word it shows is the
    /// ballot page's, the states offered are the page's in its order, and a state picked leads to
    /// its electorates and a confirmation worded as the page words it. Named to run after the quiz,
    /// which needs the gate unanswered: the 18+ answer given here is kept.
    func testTheVoterPicksABallotInTheWebsWords() throws {
        let ballot = try json("states/ballot")
        let blocks = ballot["blocks"] as? [[String: Any]] ?? []
        func text(_ value: Any) -> String {
            if let dict = value as? [String: Any] {
                if let s = dict["s"] as? String { return s }
                return (dict["c"] as? [Any] ?? []).map(text).joined()
            }
            return (value as? [Any] ?? []).map(text).joined()
        }
        /// A piece as the page words it, with its values filled.
        func piece(_ id: String, _ values: [String: String] = [:]) throws -> String {
            let section = try XCTUnwrap(blocks.first { $0["id"] as? String == "ballot-\(id)" }, "the ballot page has no \(id)")
            let paragraph = try XCTUnwrap((section["c"] as? [[String: Any]])?.first)
            return try (paragraph["c"] as? [[String: Any]] ?? []).map { part in
                guard part["t"] as? String == "value" else { return part["s"] as? String ?? "" }
                return try XCTUnwrap(values[part["name"] as? String ?? ""], "ballot: \(id) names a value the test does not fill")
            }.joined()
        }
        let section = try XCTUnwrap(blocks.first { $0["id"] as? String == "ballot-states" })
        let list = try XCTUnwrap((section["c"] as? [[String: Any]])?.first?["items"] as? [[String: Any]])
        let states = list.map { (code: text($0["term"] as Any), name: text($0["detail"] as Any)) }
        let first = try XCTUnwrap(states.first, "the ballot page offers no states")

        let app = XCUIApplication()
        app.launch()
        addTeardownBlock { [self] in XCTAssertNoThrow(try chooseTheCurrentElection(in: app)) }

        // An election with a ballot: 2025, chosen from the electorates index, then its landing
        // through the trail's first crumb.
        try openAndCompare("next/electorates", from: "Candidates", in: app)
        let election = try XCTUnwrap(firstLink(under: "/2025/electorates", in: try json("next/electorates")))
        tapUntilShown(app.buttons[election.label].firstMatch, in: app)
        XCTAssertNotNil(shownDocument(startingWith: try projected("2025/electorates").spoken, in: app), "2025/electorates: not drawn natively")
        let crumb = app.buttons["2025"].firstMatch
        var swipes = 0
        while !(crumb.exists && crumb.isHittable), swipes < 60 {
            app.swipeDown(velocity: .fast)
            swipes += 1
        }
        crumb.tap()
        let begin = try XCTUnwrap(controls(of: "landing-fresh", in: try json("2025")).first { $0.action == "start" }?.label)
        XCTAssertTrue(app.buttons[begin].waitForExistence(timeout: 30), "the 2025 landing never appeared")
        app.buttons[begin].tap()
        let adult = try XCTUnwrap(controls(of: "age-declare", in: try json("start")).first { $0.action == "adult" }?.label)
        let pick = try piece("pick")
        let heading = app.staticTexts[pick]
        if app.buttons[adult].waitForExistence(timeout: 10) { app.buttons[adult].tap() }

        // Step 1: the page's question, position and back, and its states.
        XCTAssertTrue(heading.waitForExistence(timeout: 30), "ballot: \"\(pick)\" is not on screen")
        XCTAssertTrue(app.staticTexts[try piece("position", ["step": "1", "total": "3"])].exists, "ballot: the position is not the page's")
        XCTAssertEqual(app.buttons["top-back"].label, try piece("back"), "ballot: the back button is not the page's")
        // Each state's button reads the page's name for it.
        func offered(_ state: (code: String, name: String)) -> XCUIElement {
            app.buttons.matching(NSPredicate(format: "label ENDSWITH %@", state.name)).firstMatch
        }
        for state in states {
            XCTAssertTrue(offered(state).exists, "ballot: the state \"\(state.name)\" is not offered")
        }
        offered(first).tap()

        // Step 2: the page's electorate step, and a row naming the state as the page names it.
        XCTAssertTrue(app.staticTexts[try piece("electorate")].waitForExistence(timeout: 10), "ballot: the electorate step is not the page's")
        XCTAssertTrue(app.textFields[try piece("searchLabel")].exists, "ballot: the search is not named as the page names it")
        let lookup = try piece("lookup")
        let link = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", lookup)).firstMatch
        XCTAssertTrue(link.exists, "ballot: the lookup link is not the page's")
        // A row reads the electorate and then its state, by the page's name or its code.
        let row = app.buttons.matching(NSPredicate(
            format: "label ENDSWITH %@ OR label ENDSWITH %@", ", \(first.name)", ", \(first.code)"
        )).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "ballot: no electorate in \(first.name) is offered")
        let electorate = try XCTUnwrap(row.label.components(separatedBy: ", ").first)
        row.tap()

        // Step 3: the confirmation, worded as the page words it; back returns to the list.
        XCTAssertTrue(app.staticTexts[try piece("located", ["state": first.name])].waitForExistence(timeout: 10), "ballot: the confirmation is not the page's")
        XCTAssertTrue(app.staticTexts[electorate].exists, "ballot: the chosen electorate \"\(electorate)\" is not shown")
        XCTAssertTrue(app.buttons[try piece("start")].exists, "ballot: the start button is not the page's")
        XCTAssertTrue(app.buttons[try piece("different")].exists, "ballot: the way back is not the page's")
        app.buttons["top-back"].tap()
        XCTAssertTrue(app.staticTexts[try piece("electorate")].waitForExistence(timeout: 10), "ballot: back did not return to the electorates")
    }

    /// The gate in both states, as a first-time visitor meets it: from the landing's call to action,
    /// then answering "under 18" with the button the page labels. Both states must read exactly as
    /// the page does.
    func testTheAgeGateShowsThePagesTextInBothStates() throws {
        let bundle = Bundle(for: Self.self)
        func projected(_ name: String) throws -> (Projected, [String: Any]) {
            let parts = name.split(separator: "/").map(String.init)
            let directory = (["native-documents"] + parts.dropLast()).joined(separator: "/")
            let url = try XCTUnwrap(bundle.url(forResource: parts.last, withExtension: "json", subdirectory: directory))
            let data = try Data(contentsOf: url)
            let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
            return (try JSONDecoder().decode(Projected.self, from: data), json)
        }
        /// A slot's controls as the page wrote them: each one's action, and its label.
        func controls(_ slot: String, in json: [String: Any]) -> [String: String] {
            var found: [String: String] = [:]
            func walk(_ value: Any) {
                if let dict = value as? [String: Any] {
                    if dict["t"] as? String == "slot", dict["name"] as? String == slot {
                        for control in dict["controls"] as? [[String: Any]] ?? [] {
                            if let action = control["action"] as? String, let label = control["label"] as? String {
                                found[action] = label
                            }
                        }
                    }
                    dict.values.forEach(walk)
                } else if let list = value as? [Any] {
                    list.forEach(walk)
                }
            }
            walk(json["blocks"] as Any)
            return found
        }

        let (ask, askJSON) = try projected("start")
        let (explore, _) = try projected("states/start")
        let answers = controls("age-declare", in: askJSON)
        let under = try XCTUnwrap(answers["minor"], "the question names no under-18 answer")

        let app = XCUIApplication()
        app.launch()
        // The landing's own call to action for a first-time visitor.
        let begin = app.buttons["See how my views compare"]
        XCTAssertTrue(begin.waitForExistence(timeout: 30), "the native landing never appeared")
        begin.tap()

        guard let asked = shownDocument(startingWith: ask.spoken, in: app) else {
            return XCTFail("start: not drawn natively — the shell declined it, or it never arrived")
        }
        compare("start", expected: ask.spoken, shown: asked)

        // Tapped by what it does, as the page names it — never by where it sits.
        let answer = app.buttons[under]
        XCTAssertTrue(answer.waitForExistence(timeout: 10), "start: the page's \"\(under)\" is not on screen")
        answer.tap()
        guard let explained = shownDocument(startingWith: explore.spoken, in: app) else {
            return XCTFail("states/start: the gate did not move to the explainer natively")
        }
        compare("states/start", expected: explore.spoken, shown: explained)
    }

    /// Scrolls to a footer link and follows it.
    private func open(_ label: String, in app: XCUIApplication) -> Bool {
        let link = app.buttons[label].firstMatch
        var swipes = 0
        while !(link.exists && link.isHittable), swipes < 120 {
            app.swipeUp(velocity: .fast)
            swipes += 1
        }
        guard link.exists, link.isHittable else { return false }
        link.tap()
        return true
    }

    /// The accessibility snapshot of the document on screen, once it is the one asked for: the screen
    /// must begin with the page's own text, not merely mention its heading somewhere.
    private func shownDocument(startingWith spoken: String, in app: XCUIApplication) -> XCUIElementSnapshot? {
        let container = app.otherElements["native-document"]
        let opening = String(spoken.filter { !$0.isWhitespace }.prefix(40))
        let deadline = Date().addingTimeInterval(20)
        while Date() < deadline {
            if container.exists, let snapshot = try? container.snapshot(),
               texts(in: snapshot).joined().filter({ !$0.isWhitespace }).hasPrefix(opening) {
                return snapshot
            }
            Thread.sleep(forTimeInterval: 0.25)
        }
        return nil
    }

    /// What VoiceOver reads inside an element, in order: each text and control once, by its label.
    private func texts(in element: XCUIElementSnapshot) -> [String] {
        // A list marker: hidden from VoiceOver, but visible to UI tests. Skipped only if it really is
        // one — a marked element holding anything else is counted, so misplacing the mark cannot hide
        // page text from this check.
        if element.identifier == "document-decoration" {
            let isMarker = element.children.isEmpty
                && element.label.range(of: #"^(•|✓|\d+\.)$"#, options: .regularExpression) != nil
            if isMarker { return [] }
        }
        switch element.elementType {
        case .staticText, .button, .link:
            return element.label.isEmpty ? [] : [element.label]
        default:
            return element.children.flatMap { texts(in: $0) }
        }
    }

    private func compare(_ name: String, expected: String, shown: XCUIElementSnapshot) {
        let want = expected.filter { !$0.isWhitespace }
        let got = texts(in: shown).joined().filter { !$0.isWhitespace }
        guard want != got else { return }
        let at = zip(want, got).prefix { $0 == $1 }.count
        func around(_ s: String) -> String {
            let chars = Array(s)
            let from = max(0, at - 30), to = min(chars.count, at + 30)
            return String(chars[from..<to])
        }
        XCTFail("\(name): the screen reads \"…\(around(got))…\" where the page reads \"…\(around(want))…\" (\(got.count) vs \(want.count) characters)")
    }
}
