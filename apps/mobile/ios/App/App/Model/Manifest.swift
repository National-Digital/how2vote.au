import Foundation

/// One election's dataset manifest: vintage, attribution and the generated provenance disclosure.
///
/// Only the fields a native screen renders are decoded. The manifest carries more — checksum,
/// methodology and compliance-policy versions, counts — and adding them here as they are needed is
/// cheaper than carrying fields nothing reads.
struct Manifest: Decodable, Equatable {
    /// The election's data-provenance disclosure, shown identically wherever party positions are.
    struct Provenance: Decodable, Equatable {
        let basis: String
        let retrievedAt: String
        let effectiveAsAt: String?
        /// The generated statement. Generated, so the quiz and the analysis pages cannot word the
        /// same disclosure differently — nothing here composes or edits it.
        let statement: String
    }

    let dataVersion: String
    let attribution: String
    /// Absent for an election with no committed snapshot, in which case no notice is shown.
    let provenance: Provenance?
    /// Per-kind totals: `questions`, `electorates`, and so on.
    let counts: [String: Int]

    /// True for a provisional election that ships no ballot, so there is nothing to pick.
    ///
    /// Read from the tiny manifest rather than the ~330 KB dataset, so the ballot screen can skip
    /// itself before any picker has a chance to flash.
    var isElectorateLess: Bool {
        (counts["electorates"] ?? 0) == 0
    }
}

/// Loads an election's manifest from the synced web assets.
enum ManifestLoader {
    /// Reads one election's manifest, or `nil` when it is absent or unreadable.
    ///
    /// Returns `nil` rather than throwing: the manifest supplies a disclosure that is only rendered
    /// when the election has a committed snapshot, so "no manifest" and "no snapshot" already have
    /// the same handling. CI asserts the file ships, so a missing one is a build fault, not a
    /// runtime state to design around.
    static func load(electionID: String, bundle: Bundle = .main) -> Manifest? {
        guard let url = bundle.url(
            forResource: "manifest",
            withExtension: "json",
            subdirectory: "public/data/dist/\(electionID)"
        ), let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Manifest.self, from: data)
    }
}
