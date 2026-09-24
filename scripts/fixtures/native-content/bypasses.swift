// Each way round the guard the review found, and the parse's own blind spots.
enum Tab: String {
    case help = "Get help now"
    case key = "tab-key"
}

@available(*, deprecated, message: "An attribute's sentence")
struct Bypasses: View {
    var body: some View {
        #if true
        Text("Inside an if")
        #else
        Text("Inside an else")
        #endif
        Text("vote")
        Text(isOn ? "yes" : "no")
        Text("Vote.")
        Text("Senate/House")
        Text("✓")
        Text("18+")
        Text("\(n)/\(total)")
        Label("AustralianElectoralCommission", systemImage: "star")
        accessibilityIdentifier("Bare helper shows this sentence")
        Text(x).accessibilityLabel("electorate-map")
    }
    func bridge() {
        let title = call.getString("title", "Default shown to voter")
        self.notifyListeners("toast", data: ["message": "Shown by the web as a toast"])
        call.reject("You're offline — reconnect and try again")
        throw Failure.missing("Your electorate could not be found")
    }
}

enum Notice: Error, CustomStringConvertible {
    case offline
    var description: String { "You're offline — reconnect to continue" }
}

struct Card: View /* Error */ {
    var description: String { "a lower-case line on a card" }
}
