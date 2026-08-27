import CoreGraphics
import Foundation

/// One state's electoral boundaries, as committed.
///
/// The geometry is already projected: `apps/web/static/maps/<election>/<STATE>.json` holds flat
/// outlines in a `viewBox` coordinate space, not latitude and longitude. That is deliberate — the
/// same file draws the same shapes on every channel, with no projection step to disagree about and
/// no map tiles to fetch, which is what keeps this screen inside the offline guarantee (ADR 0001).
struct StateMap: Decodable, Equatable {
    struct Division: Decodable, Equatable {
        let name: String
        /// An SVG path in the viewBox space. Only `M`, `L` and `Z` occur in the committed data.
        let path: String
        /// `[x, y, width, height]`, used to place the inset window.
        let bbox: [Double]
    }

    struct City: Decodable, Equatable {
        let name: String
        let x: Double
        let y: Double
    }

    let state: String
    let attribution: String
    /// `[width, height]` of the coordinate space the paths are drawn in.
    let viewBox: [Double]
    let divisions: [Division]
    let cities: [City]?

    var size: CGSize {
        CGSize(width: viewBox.first ?? 0, height: viewBox.dropFirst().first ?? 0)
    }

    func division(named name: String) -> Division? {
        divisions.first { $0.name == name }
    }
}

/// Turns a committed boundary outline into drawable points.
///
/// A deliberately partial SVG path reader: the committed data uses only `M`, `L` and `Z`, and a
/// parser that quietly accepted curves it could not draw would render a boundary subtly wrong — a
/// wrong electorate shape shown to a voter as their own. Anything it does not understand makes the
/// whole outline unreadable instead, and an unreadable outline is simply not drawn.
enum BoundaryPath {
    /// One closed ring of points, in viewBox coordinates.
    typealias Ring = [CGPoint]

    /// Parses an outline into its rings, or nil if the path contains anything unsupported.
    static func rings(_ path: String) -> [Ring]? {
        var rings: [Ring] = []
        var current: Ring = []
        var index = path.startIndex

        while index < path.endIndex {
            let character = path[index]
            switch character {
            case "M", "L":
                index = path.index(after: index)
                guard let (point, next) = point(in: path, from: index) else { return nil }
                index = next
                if character == "M" {
                    if current.count > 2 { rings.append(current) }
                    current = [point]
                } else {
                    current.append(point)
                }
            case "Z", "z":
                index = path.index(after: index)
                if current.count > 2 { rings.append(current) }
                current = []
            case " ", ",", "\n", "\t":
                index = path.index(after: index)
            default:
                // An unsupported command, rather than a coordinate we can read.
                return nil
            }
        }

        if current.count > 2 { rings.append(current) }
        return rings.isEmpty ? nil : rings
    }

    /// Reads one `x y` pair, which the committed data writes with a space between the two numbers.
    private static func point(in path: String, from start: String.Index) -> (CGPoint, String.Index)? {
        guard let (x, afterX) = number(in: path, from: start) else { return nil }
        var index = afterX
        while index < path.endIndex, path[index] == " " || path[index] == "," {
            index = path.index(after: index)
        }
        guard let (y, afterY) = number(in: path, from: index) else { return nil }
        return (CGPoint(x: x, y: y), afterY)
    }

    private static func number(in path: String, from start: String.Index) -> (Double, String.Index)? {
        var index = start
        var text = ""
        while index < path.endIndex {
            let character = path[index]
            guard character.isNumber || character == "." || character == "-" || character == "e"
            else { break }
            text.append(character)
            index = path.index(after: index)
        }
        guard let value = Double(text) else { return nil }
        return (value, index)
    }
}

/// Loads a state's boundaries from the synced web assets.
enum StateMapLoader {
    /// Reads one state's map, or nil when it is absent, unreadable, or WITHHELD.
    ///
    /// `allowedMapIDs` is resolved by the WebView from the signed control plane and handed over
    /// (ADR 0018 D10a): the native core never evaluates the emergency levers itself, because a
    /// second implementation of the one mechanism that withdraws a map during a campaign could
    /// disagree with the first — and the way it would disagree is by continuing to show what every
    /// other channel had already withdrawn. An empty or absent list therefore draws nothing.
    static func load(
        electionID: String,
        stateCode: String,
        allowedMapIDs: Set<String>,
        bundle: Bundle = .main
    ) -> StateMap? {
        guard let url = bundle.url(
            forResource: stateCode.uppercased(),
            withExtension: "json",
            subdirectory: "public/maps/\(electionID)"
        ) else { return nil }
        return load(
            from: url,
            mapID: mapID(electionID: electionID, stateCode: stateCode),
            allowedMapIDs: allowedMapIDs
        )
    }

    /// The control plane's id for a state's map, in the shape the web resolves it under.
    static func mapID(electionID: String, stateCode: String) -> String {
        "\(electionID)/\(stateCode.uppercased())"
    }

    /// Reads a map from an explicit file, applying the same withholding rule.
    ///
    /// The gate is checked BEFORE the file is opened, so a withheld map is not read into memory on
    /// the way to being discarded.
    static func load(from url: URL, mapID: String, allowedMapIDs: Set<String>) -> StateMap? {
        guard allowedMapIDs.contains(mapID) else { return nil }
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(StateMap.self, from: data)
    }
}
