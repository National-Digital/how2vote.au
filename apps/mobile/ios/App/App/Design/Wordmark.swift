import SwiftUI

/// The How2Vote lockup, drawn from the same baked outlines the web renders.
///
/// The mark is not a font. `apps/web/src/lib/brand/mark.mjs` holds Newsreader outlines baked to
/// absolute coordinates precisely so it renders identically with no font dependency, and the
/// numeral sits inside a ballot-paper box no text string carries — so `Text("how2vote")` was a
/// different mark, in whatever face the platform chose. `BrandMark` is generated from that same
/// source, and `scripts/check-native-brand.mjs` keeps the two in step.
struct Wordmark: View {
    /// Height to draw at. The lockup keeps its own aspect ratio from this.
    var height: CGFloat
    /// The ink. Passed explicitly rather than inherited: the layers are `Shape`s with their own
    /// fills, which do not pick up an ancestor's `foregroundStyle`.
    var color: Color

    private var width: CGFloat { height * (BrandMark.size.width / BrandMark.size.height) }

    var body: some View {
        ZStack {
            MarkLayer(.fill(BrandMark.textPath), color: color)
            MarkLayer(.fill(BrandMark.numeralPath), color: color)
            // Stroked, never filled — the box is a ballot-paper cell, not a block of ink. Its width
            // is in the mark's coordinate space, so it scales with everything else.
            MarkLayer(.box, color: color)
        }
        .frame(width: width, height: height)
        .accessibilityElement()
        .accessibilityLabel("How2Vote")
    }
}

/// One layer of the lockup, mapped from the mark's coordinate space into the frame.
///
/// Every layer takes the SAME transform from the SAME frame, so the numeral cannot drift out of its
/// box at any size — which is what separate per-layer scaling would eventually do.
private struct MarkLayer: View {
    enum Layer {
        case fill(String)
        case box
    }

    let layer: Layer
    let color: Color

    init(_ layer: Layer, color: Color) {
        self.layer = layer
        self.color = color
    }

    var body: some View {
        GeometryReader { geo in
            let t = Self.transform(in: CGRect(origin: .zero, size: geo.size))
            switch layer {
            case let .fill(d):
                Path(SVGPath.parse(d).copy(using: [t]) ?? SVGPath.parse(d)).fill(color)
            case .box:
                let b = BrandMark.box
                Path(
                    CGPath(
                        roundedRect: CGRect(x: b.x, y: b.y, width: b.width, height: b.height),
                        cornerWidth: b.rx,
                        cornerHeight: b.rx,
                        transform: nil
                    ).copy(using: [t]) ?? CGMutablePath()
                )
                .stroke(color, lineWidth: b.strokeWidth * Self.scale(in: geo.size))
            }
        }
    }

    static func scale(in size: CGSize) -> CGFloat {
        min(size.width / BrandMark.size.width, size.height / BrandMark.size.height)
    }

    /// The mark's origin is the text baseline, with ink above it in negative y.
    static func transform(in rect: CGRect) -> CGAffineTransform {
        let s = scale(in: rect.size)
        let drawn = CGSize(width: BrandMark.size.width * s, height: BrandMark.size.height * s)
        return CGAffineTransform(
            translationX: rect.minX + (rect.width - drawn.width) / 2,
            y: rect.minY + (rect.height - drawn.height) / 2 + drawn.height
        ).scaledBy(x: s, y: s)
    }
}
