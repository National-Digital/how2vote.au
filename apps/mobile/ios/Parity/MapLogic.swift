import CoreGraphics
import Foundation

/// Exercises the boundary reader against the committed maps.
///
/// A partial SVG reader is exactly the kind of code that fails quietly: a command it does not
/// understand, silently skipped, draws a boundary that is subtly the wrong shape — and the thing
/// being drawn is a voter's own electorate, shown to them as a confirmation of where they vote. So
/// the reader refuses anything it cannot draw, and this runs it over every division of every
/// committed state to prove the refusal never fires on real data.
///
/// Build and run from the repository root:
///
///     swiftc -O apps/mobile/ios/App/App/Model/StateMap.swift \
///            apps/mobile/ios/Parity/MapLogic.swift -o "$TMPDIR/map-logic"
///     "$TMPDIR/map-logic" .
@main
enum MapLogic {
    static func main() {
        let root = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
        var failures: [String] = []
        var ran = 0

        for found in [
            readsAClosedOutline(),
            readsSeveralIslandsAsSeveralRings(),
            refusesAnOutlineItCannotDraw(),
            dropsADegenerateRing(),
            withholdsAMapTheLeversHaveClosed(root: root),
            readsEveryCommittedBoundary(root: root),
        ] {
            ran += 1
            failures.append(contentsOf: found)
        }

        guard failures.isEmpty else {
            for failure in failures { print("::error::map logic: \(failure)") }
            exit(1)
        }
        print("map logic OK — \(ran) rules hold")
    }

    private static func readsAClosedOutline() -> [String] {
        guard let rings = BoundaryPath.rings("M10 20L30 40L50 20Z") else {
            return ["a plain closed outline did not read"]
        }
        guard rings.count == 1, rings[0].count == 3 else {
            return ["a triangle read as \(rings.count) ring(s) of \(rings.first?.count ?? 0) points"]
        }
        guard rings[0][0] == CGPoint(x: 10, y: 20), rings[0][2] == CGPoint(x: 50, y: 20) else {
            return ["the outline's points did not survive parsing: \(rings[0])"]
        }
        return []
    }

    /// Many divisions are islands or split by water, so one outline is several rings.
    private static func readsSeveralIslandsAsSeveralRings() -> [String] {
        guard let rings = BoundaryPath.rings("M0 0L10 0L10 10ZM20 20L30 20L30 30Z") else {
            return ["a two-part outline did not read"]
        }
        guard rings.count == 2 else { return ["a two-part outline read as \(rings.count) ring(s)"] }
        return []
    }

    /// A curve command, quietly skipped, would draw a boundary that is the wrong shape while still
    /// looking like a boundary. Refusing the whole outline means it is simply not drawn.
    private static func refusesAnOutlineItCannotDraw() -> [String] {
        if BoundaryPath.rings("M0 0C10 10 20 20 30 30Z") != nil {
            return ["an outline with a curve was accepted — it would draw the wrong shape"]
        }
        return []
    }

    private static func dropsADegenerateRing() -> [String] {
        if BoundaryPath.rings("M0 0L1 1Z") != nil {
            return ["a two-point ring was accepted as an outline"]
        }
        return []
    }

    /// The emergency levers are resolved by the WebView and handed over (ADR 0018 D10a). A map that
    /// is not on the allowed list must not be read, whatever is on disk.
    private static func withholdsAMapTheLeversHaveClosed(root: String) -> [String] {
        let url = URL(fileURLWithPath: root).appendingPathComponent("apps/web/static/maps/2025/ACT.json")
        let id = StateMapLoader.mapID(electionID: "2025", stateCode: "act")

        if StateMapLoader.load(from: url, mapID: id, allowedMapIDs: []) != nil {
            return ["a map was read with no allowed list — the levers would be closed and it drawn"]
        }
        if StateMapLoader.load(from: url, mapID: id, allowedMapIDs: ["2025/NSW"]) != nil {
            return ["a map was read while another state's was the one allowed"]
        }
        guard StateMapLoader.load(from: url, mapID: id, allowedMapIDs: [id]) != nil else {
            return ["an allowed map did not read — the id the native side builds must be the web's"]
        }
        return []
    }

    /// The refusal above must never fire on real data.
    private static func readsEveryCommittedBoundary(root: String) -> [String] {
        let mapsRoot = URL(fileURLWithPath: root).appendingPathComponent("apps/web/static/maps")
        let manager = FileManager.default
        guard let elections = try? manager.contentsOfDirectory(atPath: mapsRoot.path) else {
            return ["no committed maps found under apps/web/static/maps"]
        }

        var failures: [String] = []
        var divisions = 0
        for election in elections.sorted() {
            let directory = mapsRoot.appendingPathComponent(election)
            guard let files = try? manager.contentsOfDirectory(atPath: directory.path) else { continue }
            for file in files.sorted() where file.hasSuffix(".json") {
                let state = String(file.dropLast(5))
                let id = StateMapLoader.mapID(electionID: election, stateCode: state)
                guard let map = StateMapLoader.load(
                    from: directory.appendingPathComponent(file),
                    mapID: id,
                    allowedMapIDs: [id]
                ) else {
                    failures.append("\(election)/\(file): did not decode")
                    continue
                }
                for division in map.divisions {
                    divisions += 1
                    if BoundaryPath.rings(division.path) == nil {
                        failures.append("\(election)/\(state): \(division.name) has an unreadable outline")
                    }
                }
            }
        }

        if divisions == 0 { failures.append("no committed divisions were read (fail closed)") }
        return failures
    }
}
