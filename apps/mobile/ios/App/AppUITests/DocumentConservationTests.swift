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

    /// The age gate's two states, reached from the landing rather than the footer.
    private static let gate: Set<String> = ["start"]

    override func setUp() {
        continueAfterFailure = true
    }

    func testEachDocumentShowsThePagesText() throws {
        let bundle = Bundle(for: Self.self)
        let documents = (bundle.urls(forResourcesWithExtension: "json", subdirectory: "native-documents") ?? [])
            .map { $0.deletingPathExtension().lastPathComponent }
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
