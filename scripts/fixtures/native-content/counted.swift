// Copy wherever it is written, not only in known calls.
struct Counted: View {
    static let greeting = "Welcome back"
    var title: String { "Question \(cursor + 1) of \(total)" }
    var body: some View {
        Text("Where will you vote?")
        Text("Search \(model.state ?? "all") (\(count(x))) seats")
        ExternalLinkView(title: "Look up your electorate", url: url)
        QuizProgress(label: "Ballot setup progress", step: "Step")
        Image(named: "A sentence as an image name")
        Text(#"A "raw" sentence"#)
        Text("""
            A multi-line
            sentence
            """)
        Button("Done") { rows.append("Shown to the voter") }
        Button("Retry") { NSLog("a diagnostic in a closure") }
        NSLog("\({ "A closure's sentence" }())")
    }
    func announce() {
        UIAccessibility.post(notification: .announcement, argument: "Answer updated: \(label).")
        lines.append("A visible line")
        problems.append("appended outside the model")
        let a = defaults.value("Shown as a value")
        Text(verbatim: "Check your enrolment at https://check.aec.gov.au before election day")
    }
}

struct Status: CustomStringConvertible {
    var description: String { "We couldn’t load this election — check your connection" }
}
