import Foundation

/// The contact form's wording, from the web's `states/contact-form` page (ADR 0019 D4b): its fields,
/// its button, and what it says once a message is sent or fails to send.
///
/// Nothing here is written natively. A page that drops a piece is refused, and the contact page is
/// declined for the WebView's.
struct ContactWording: Equatable {
    /// The pieces, by the name the page gives each section (`contact-<name>`).
    enum Piece: String, CaseIterable {
        case name, email, message, offline, error, send, sending, sent, challenge
    }

    private let pieces: [Piece: String]

    init(_ page: NativeDocument) throws {
        let states = StatesPage(page)
        var pieces: [Piece: String] = [:]
        for piece in Piece.allCases {
            pieces[piece] = StatesPage.fill(try states.parts("contact-\(piece.rawValue)", values: []), [:])
        }
        self.pieces = pieces
    }

    func text(_ piece: Piece) -> String {
        pieces[piece] ?? ""
    }

    /// How the web reports a message's sending, as the form reads it: sent, offline, or not sent.
    enum Outcome: Equatable {
        case sent, offline, failed

        /// The web's answer. Anything but the two it names is a failure: a message the web did not
        /// say it sent was not sent.
        init(_ answer: String) {
            switch answer {
            case "ok": self = .sent
            case "offline": self = .offline
            default: self = .failed
            }
        }
    }

    /// What JavaScript's `trim()` strips, which is what the web's form reads as blank: white space
    /// and line terminators, the byte-order mark among them.
    static let blank: CharacterSet = {
        let points: [UInt32] = [
            0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005,
            0x2006, 0x2007, 0x2008, 0x2009, 0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
        ]
        var set = CharacterSet()
        for point in points {
            if let scalar = Unicode.Scalar(point) { set.insert(scalar) }
        }
        return set
    }()

    /// A message's fields as the web's form submits them, or nil while one is blank as the web reads it.
    static func fields(name: String, email: String, message: String) -> String? {
        let values = ["name": name, "email": email, "message": message]
        guard values.values.allSatisfy({ !$0.trimmingCharacters(in: blank).isEmpty }),
              let data = try? JSONSerialization.data(withJSONObject: values, options: [.sortedKeys])
        else { return nil }
        return String(decoding: data, as: UTF8.self)
    }
}
