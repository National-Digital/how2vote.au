import Foundation

/// The states and territories a federal ballot is picked from.
///
/// Mirrors `STATES` in `apps/web/src/lib/data.ts`, in the same ballot-paper order — the picker sorts
/// alphabetically for display, but the order here is the list's own and is kept so the two sources
/// can be compared line for line. Dataset-free on purpose: the picker's first step renders before
/// any election data is read.
///
/// `scripts/check-native-jurisdictions.mjs` holds this to the web's. A code that differed would not
/// look wrong — it would return an empty electorate list, and the picker would appear broken for
/// everyone in that state.
enum Jurisdictions {
    struct Jurisdiction: Equatable {
        let code: String
        let name: String
    }

    static let all: [Jurisdiction] = [
        Jurisdiction(code: "NSW", name: "New South Wales"),
        Jurisdiction(code: "VIC", name: "Victoria"),
        Jurisdiction(code: "QLD", name: "Queensland"),
        Jurisdiction(code: "WA", name: "Western Australia"),
        Jurisdiction(code: "SA", name: "South Australia"),
        Jurisdiction(code: "TAS", name: "Tasmania"),
        Jurisdiction(code: "ACT", name: "Australian Capital Territory"),
        Jurisdiction(code: "NT", name: "Northern Territory"),
    ]

    /// The picker's order: alphabetical by code, as the web's grid is.
    static var picker: [Jurisdiction] {
        all.sorted { $0.code < $1.code }
    }

    /// The full name for a code, or the code itself when it is not one of ours.
    static func name(for code: String) -> String {
        all.first { $0.code == code.uppercased() }?.name ?? code
    }
}
