import CoreGraphics
import Foundation

/// A reader for the absolute SVG path commands the brand mark uses.
///
/// Deliberately narrow: `M`, `L`, `H`, `V`, `Q`, `Z`, all absolute, which is everything the baked
/// brand outlines emit — `scripts/check-native-brand.mjs` refuses to generate anything else, so an
/// unsupported command is caught on Linux in a second rather than drawn wrongly on a device.
///
/// CoreGraphics rather than SwiftUI, so the reader can be exercised by a command-line harness
/// (`apps/mobile/ios/Parity/BrandMark.swift`) that has no UI framework to link against.
enum SVGPath {
    /// Parses `d` in its own coordinate space. Unknown input yields an empty path rather than a
    /// half-drawn one — the harness asserts the real marks parse to their declared bounds, which is
    /// what would catch a silently-skipped segment.
    static func parse(_ d: String) -> CGPath {
        let path = CGMutablePath()
        var numbers: [CGFloat] = []
        var command: Character?
        var current = CGPoint.zero
        var start = CGPoint.zero
        var number = ""

        func takeNumber() {
            if !number.isEmpty, let v = Double(number) { numbers.append(CGFloat(v)) }
            number = ""
        }

        // Applied once the pending command has its operands. A repeated operand run continues in
        // the implicit line-to the SVG grammar defines, which these outlines do use.
        func flush() {
            guard let c = command else { return }
            var i = 0
            func next() -> CGFloat { defer { i += 1 }; return i < numbers.count ? numbers[i] : 0 }
            switch c {
            case "M":
                var moved = false
                while i + 1 < numbers.count {
                    let p = CGPoint(x: next(), y: next())
                    if moved {
                        path.addLine(to: p)
                    } else {
                        path.move(to: p)
                        start = p
                        moved = true
                    }
                    current = p
                }
            case "L":
                while i + 1 < numbers.count {
                    let p = CGPoint(x: next(), y: next())
                    path.addLine(to: p)
                    current = p
                }
            case "H":
                while i < numbers.count {
                    current = CGPoint(x: next(), y: current.y)
                    path.addLine(to: current)
                }
            case "V":
                while i < numbers.count {
                    current = CGPoint(x: current.x, y: next())
                    path.addLine(to: current)
                }
            case "Q":
                while i + 3 < numbers.count {
                    let control = CGPoint(x: next(), y: next())
                    let end = CGPoint(x: next(), y: next())
                    path.addQuadCurve(to: end, control: control)
                    current = end
                }
            case "Z":
                if !path.isEmpty { path.closeSubpath() }
                current = start
            default:
                break
            }
            numbers.removeAll(keepingCapacity: true)
        }

        for ch in d {
            switch ch {
            case "M", "L", "H", "V", "Q", "Z":
                takeNumber()
                flush()
                command = ch
                if ch == "Z" { flush() }
            case "-":
                // A minus opens a new operand. These coordinates are plain decimals — no exponent
                // notation — so a sign is never anything but a leading one.
                if !number.isEmpty { takeNumber() }
                number.append(ch)
            case " ", ",":
                takeNumber()
            default:
                number.append(ch)
            }
        }
        takeNumber()
        flush()
        return path
    }
}
