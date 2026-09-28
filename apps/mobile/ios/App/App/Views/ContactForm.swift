import SwiftUI

/// The contact page's form: a name, an email and a message, sent by the web.
///
/// Mirrors the form in `apps/web/src/routes/contact/+page.svelte`. Sending is the web's: it makes the
/// page's own submission, anti-spam check included, and answers with how it went. The fields stay
/// filled until the web says the message was sent.
struct ContactForm: View {
    @Environment(\.colorScheme) private var scheme

    let wording: ContactWording
    /// Hands the message's fields to the web, which answers with how the sending went.
    let onSend: (String) async -> String

    @State private var name = ""
    @State private var email = ""
    @State private var message = ""
    @State private var sending = false
    @State private var outcome: ContactWording.Outcome?

    private var fields: String? {
        ContactWording.fields(name: name, email: email, message: message)
    }

    var body: some View {
        if outcome == .sent {
            Text(wording.text(.sent))
                .font(.body)
                .fixedSize(horizontal: false, vertical: true)
                .onAppear { AccessibilityNotification.Announcement(wording.text(.sent)).post() }
        } else {
            VStack(alignment: .leading, spacing: 0) {
                field(.name) {
                    TextField(text: $name) { Text(wording.text(.name)) }
                        .textContentType(.name)
                }
                field(.email) {
                    TextField(text: $email) { Text(wording.text(.email)) }
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                field(.message) {
                    TextField(text: $message, axis: .vertical) { Text(wording.text(.message)) }
                        .lineLimit(6, reservesSpace: true)
                }

                if let outcome, outcome != .sent {
                    Text(wording.text(outcome == .offline ? .offline : .error))
                        .font(.subheadline)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 16)
                }

                Button(wording.text(sending ? .sending : .send)) { send() }
                    .buttonStyle(PrimaryButton())
                    .disabled(fields == nil || sending)
                    .opacity(fields == nil || sending ? 0.5 : 1)
                    .padding(.top, 20)

                Text(wording.text(.challenge))
                    .font(.footnote)
                    .foregroundStyle(Theme.ink2.resolve(scheme))
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 14)
            }
        }
    }

    /// A field under its label, as the page lays each out.
    private func field<Input: View>(_ label: ContactWording.Piece, @ViewBuilder input: () -> Input) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(wording.text(label))
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.ink2.resolve(scheme))
                .accessibilityHidden(true)
            input()
                .font(.body)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(Theme.paper.resolve(scheme))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.radius)
                        .strokeBorder(Theme.line2.resolve(scheme), lineWidth: 1.5)
                )
                .accessibilityLabel(wording.text(label))
        }
        .padding(.top, 16)
    }

    private func send() {
        guard let fields, !sending else { return }
        sending = true
        Task {
            let result = ContactWording.Outcome(await onSend(fields))
            sending = false
            outcome = result
            if result != .sent {
                AccessibilityNotification.Announcement(wording.text(result == .offline ? .offline : .error)).post()
            }
        }
    }
}
