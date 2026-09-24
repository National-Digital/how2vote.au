import XCTest

/// Every native document shows VoiceOver the page's text, on screen, in the simulator.
///
/// `DocumentLayout.verify` proves the layout holds the projection's text; this proves the screen
/// does. It opens each document the way a voter does — from the footer — and reads the
/// accessibility tree, which is what VoiceOver reads, against the `spoken` text the projection
/// recorded from the web's HTML. A document the shell declined (drawn by the WebView instead) fails
/// here too, because the native container never appears.
final class DocumentConservationTests: XCTestCase {
    /// The footer link that opens each document. A document with no entry fails rather than being
    /// skipped.
    private static let footerLabels = [
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

    override func setUp() {
        continueAfterFailure = true
    }

    func testEachDocumentShowsThePagesText() throws {
        let bundle = Bundle(for: Self.self)
        let files = (bundle.urls(forResourcesWithExtension: "json", subdirectory: "native-documents") ?? [])
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        XCTAssertFalse(files.isEmpty, "the test bundle carries no projected documents")

        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(
            app.buttons[Self.footerLabels["privacy"]!].waitForExistence(timeout: 30),
            "the native landing never appeared"
        )

        for file in files {
            let name = file.deletingPathExtension().lastPathComponent
            let projected = try JSONDecoder().decode(Projected.self, from: Data(contentsOf: file))
            guard let label = Self.footerLabels[name] else {
                XCTFail("\(name): no footer link is known to open it")
                continue
            }
            guard open(label, in: app) else {
                XCTFail("\(name): the footer link \"\(label)\" could not be reached")
                continue
            }
            guard let shown = shownDocument(titled: projected.title, in: app) else {
                XCTFail("\(name): not drawn natively — the shell declined it, or it never arrived")
                continue
            }
            compare(name, expected: projected.spoken, shown: shown)
        }
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

    /// The accessibility snapshot of the document on screen, once it is the one asked for.
    private func shownDocument(titled title: String, in app: XCUIApplication) -> XCUIElementSnapshot? {
        let container = app.otherElements["native-document"]
        let deadline = Date().addingTimeInterval(20)
        while Date() < deadline {
            if container.exists, let snapshot = try? container.snapshot(),
               texts(in: snapshot).first == title {
                return snapshot
            }
            Thread.sleep(forTimeInterval: 0.25)
        }
        return nil
    }

    /// What VoiceOver reads inside an element, in order: each text and control once, by its label.
    private func texts(in element: XCUIElementSnapshot) -> [String] {
        // A list marker: hidden from VoiceOver, but visible to UI tests.
        if element.identifier == "document-decoration" { return [] }
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
