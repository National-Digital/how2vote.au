import CoreGraphics
import Foundation

/// Exercises the brand-mark path reader against the generated geometry.
///
/// A partial SVG reader fails quietly — a command it skips draws a subtly wrong logo, and the logo
/// is the app's identity on the first screen a reviewer sees. These assertions are made against the
/// mark's DECLARED dimensions rather than against the reader's own output, so a reader that drops
/// segments disagrees with the source instead of agreeing with itself.
///
/// Build and run from the repository root:
///
///     swiftc -O apps/mobile/ios/App/App/Design/SVGPath.swift \
///            apps/mobile/ios/App/App/Generated/BrandMark.swift \
///            apps/mobile/ios/Parity/BrandParity.swift -o "$TMPDIR/brand-mark"
///     "$TMPDIR/brand-mark"
@main
enum BrandMarkParity {
    static func main() {
        var failures: [String] = []
        var ran = 0

        for found in [
            textFillsTheDeclaredBox(),
            numeralSitsInsideItsBallotBox(),
            everyCommandIsUnderstood(),
            aDroppedSegmentWouldBeNoticed(),
        ] {
            ran += 1
            if let f = found { failures.append(f) }
        }

        if failures.isEmpty {
            print("✓ brand mark: \(ran) checks — the wordmark reads to its declared geometry")
            return
        }
        for f in failures { print("::error::brand mark: \(f)") }
        exit(1)
    }

    /// Ink must span the width the source declares, and sit above the baseline.
    ///
    /// This is the load-bearing check: a skipped command loses ink, and lost ink shrinks the span.
    /// Expressed as a fraction of the declared size rather than an absolute tolerance — the viewBox
    /// carries a little padding around the outlines, and a ratio does not have to know how much.
    static func textFillsTheDeclaredBox() -> String? {
        // The TIGHT box: `boundingBox` would include off-curve control points, which sit outside
        // the ink and would mask exactly the shortfall this is looking for.
        let box = SVGPath.parse(BrandMark.textPath).boundingBoxOfPath
        guard !box.isNull, !box.isEmpty else { return "the wordmark outline parsed to nothing" }

        let spanned = box.width / BrandMark.size.width
        if spanned < 0.95 {
            return "the wordmark spans \(spanned) of its declared width — segments lost?"
        }
        if box.maxX > BrandMark.size.width {
            return "the wordmark runs past its declared width, to x=\(box.maxX)"
        }
        // Ink is above the baseline, so it lives in negative y. A small overshoot is real: descenders
        // on the baked outlines dip a fraction below.
        if box.maxY > 2.5 {
            return "the wordmark drops below its baseline, to y=\(box.maxY)"
        }
        if box.height / BrandMark.size.height < 0.7 {
            return "the wordmark is \(box.height) tall against a declared \(BrandMark.size.height)"
        }
        return nil
    }

    /// The preference numeral must land inside the ballot-paper cell drawn around it.
    ///
    /// Independent of the check above and of the reader's own arithmetic: it compares two separately
    /// generated pieces of geometry, so a transform error moving both would still be caught.
    static func numeralSitsInsideItsBallotBox() -> String? {
        let numeral = SVGPath.parse(BrandMark.numeralPath).boundingBoxOfPath
        guard !numeral.isNull, !numeral.isEmpty else { return "the numeral parsed to nothing" }

        let b = BrandMark.box
        let cell = CGRect(x: b.x, y: b.y, width: b.width, height: b.height)
        if !cell.insetBy(dx: -1, dy: -1).contains(numeral) {
            return "the numeral at \(numeral) is not inside its ballot box at \(cell)"
        }
        // Inside, but not lost in it: a numeral parsed down to a fragment would sit well clear of
        // the cell walls while still being "contained".
        if numeral.width < cell.width * 0.4 || numeral.height < cell.height * 0.4 {
            return "the numeral at \(numeral) is too small for its box at \(cell) — segments lost?"
        }
        return nil
    }

    /// Every command in the generated geometry is one the reader implements.
    static func everyCommandIsUnderstood() -> String? {
        let supported = Set("MLHVQZ")
        for (name, d) in [("text", BrandMark.textPath), ("numeral", BrandMark.numeralPath)] {
            for ch in d where ch.isLetter && !supported.contains(ch) {
                return "\(name) uses command \"\(ch)\", which the reader does not implement"
            }
        }
        return nil
    }

    /// A mutation check: the assertions above must actually fail when ink goes missing.
    ///
    /// Without this, a reader that returned a plausible-looking box for anything would pass every
    /// check above and the harness would be asserting its own output.
    static func aDroppedSegmentWouldBeNoticed() -> String? {
        // The wordmark with its final glyph run removed — the shape a reader that stopped early
        // would produce. It spans about 0.39 of the declared width against the real mark's 0.997,
        // so the threshold above has room either side of it.
        guard let cut = BrandMark.textPath.range(of: "M370.13") else {
            return "cannot build the mutation case — the wordmark's glyph runs have changed"
        }
        let truncated = String(BrandMark.textPath[..<cut.lowerBound])
        let box = SVGPath.parse(truncated).boundingBoxOfPath
        if box.isNull || box.width / BrandMark.size.width >= 0.95 {
            return "a wordmark missing its last glyph run still measured full width — "
                + "the span assertion cannot detect lost ink"
        }
        return nil
    }
}
