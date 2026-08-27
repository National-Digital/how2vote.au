import SwiftUI

/// The chosen electorate, drawn on its state.
///
/// Mirrors `apps/web/src/lib/components/ElectorateMap.svelte`: every division of the state in
/// outline, the chosen one filled, and — for a division too small to see at state scale — an
/// atlas-style inset window over the far corner. The outlines come from the same committed file the
/// web draws, in the same already-projected space, so the two channels cannot draw different shapes
/// (ADR 0018 D10).
///
/// The AEC's derivative-product notice is displayed with the map, not tucked behind a link: the
/// Spatial Data Download licence requires the prescribed wording wherever the data is shown, and a
/// bare attribution credit does not satisfy it. The wording is `LegalCopy`, generated from the same
/// source record the web reads (`docs/legal/native-copy.json`), so it cannot drift.
///
/// Renders nothing at all when the map is unavailable — withheld by the emergency levers, missing,
/// or unreadable. The text confirmation above it stands alone, exactly as on the web.
struct ElectorateMapView: View {
    @Environment(\.colorScheme) private var scheme

    let map: StateMap
    let electorate: String

    private var chosen: StateMap.Division? {
        map.division(named: electorate)
    }

    var body: some View {
        if let chosen, let outline = BoundaryPath.rings(chosen.path) {
            VStack(alignment: .leading, spacing: 8) {
                GeometryReader { geometry in
                    let scale = min(
                        geometry.size.width / max(map.size.width, 1),
                        geometry.size.height / max(map.size.height, 1)
                    )
                    ZStack {
                        // Every division, so the chosen one is read in the context of the state
                        // rather than as a shape floating on its own.
                        ForEach(map.divisions, id: \.name) { division in
                            shape(for: division, scale: scale)
                                .stroke(Theme.line.resolve(scheme), lineWidth: 0.5)
                        }
                        rings(outline, scale: scale)
                            .fill(Theme.ink.resolve(scheme).opacity(0.85))
                        rings(outline, scale: scale)
                            .stroke(Theme.ink.resolve(scheme), lineWidth: 1)
                        if let window = inset(for: chosen) {
                            locator(window, scale: scale)
                        }
                    }
                    .frame(width: geometry.size.width, height: geometry.size.height)
                }
                .aspectRatio(
                    map.size.height > 0 ? map.size.width / map.size.height : 1,
                    contentMode: .fit
                )
                // Caps the height so the confirm button stays above the fold on tall states.
                .frame(maxHeight: 320)
                .accessibilityElement()
                .accessibilityLabel("Map of \(map.state) with the \(electorate) electorate marked")

                Text(licence)
                    .font(.caption2)
                    .foregroundStyle(Theme.ink2.resolve(scheme))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// The prescribed derivative-product notice, in the order the licence sets out.
    private var licence: String {
        [
            LegalCopy.mapLicenceIncorporates,
            LegalCopy.mapLicencePermission,
            LegalCopy.mapLicenceNoWarranty,
            LegalCopy.mapLicencePersonalUse,
        ].joined(separator: "\n\n")
    }

    private func shape(for division: StateMap.Division, scale: CGFloat) -> Path {
        rings(BoundaryPath.rings(division.path) ?? [], scale: scale)
    }

    private func rings(_ rings: [BoundaryPath.Ring], scale: CGFloat) -> Path {
        var path = Path()
        for ring in rings where ring.count > 2 {
            path.move(to: CGPoint(x: ring[0].x * scale, y: ring[0].y * scale))
            for point in ring.dropFirst() {
                path.addLine(to: CGPoint(x: point.x * scale, y: point.y * scale))
            }
            path.closeSubpath()
        }
        return path
    }

    /// A ring around a division too small to see at state scale.
    ///
    /// Inner-metro divisions are a few pixels across on a state map, so without a locator the
    /// confirmation shows a voter an apparently empty map of their state.
    private func inset(for division: StateMap.Division) -> CGRect? {
        guard division.bbox.count == 4 else { return nil }
        let width = division.bbox[2]
        let height = division.bbox[3]
        guard max(width, height) < map.size.width * 0.12 else { return nil }
        return CGRect(x: division.bbox[0], y: division.bbox[1], width: width, height: height)
    }

    private func locator(_ window: CGRect, scale: CGFloat) -> some View {
        let radius = max(max(window.width, window.height) * 1.75, map.size.width * 0.02)
        return Circle()
            .stroke(Theme.ink.resolve(scheme), lineWidth: 1.5)
            .frame(width: radius * 2 * scale, height: radius * 2 * scale)
            .position(x: window.midX * scale, y: window.midY * scale)
    }
}
