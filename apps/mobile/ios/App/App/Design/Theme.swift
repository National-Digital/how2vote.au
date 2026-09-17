import SwiftUI

/// The design tokens the native core renders against, tracking `apps/web/src/app.css`.
///
/// ADR 0018 D10 sets the bar deliberately: native screens track the web and Android design
/// *generally, not exactly*. Exact pixel parity is not a goal, and these values are therefore NOT
/// guarded against the stylesheet — a build that failed because the web nudged a shade would cost
/// churn to enforce a parity the decision does not ask for. What has to hold is that the app reads
/// as the same product, which is a review question rather than a CI one.
///
/// The answer scale and the required notices are the opposite case and are both enforced: there,
/// drift changes what the app *says* or *records*, not how it looks.
enum Theme {
    /// A palette entry, resolved per colour scheme.
    struct Ink {
        let light: Color
        let dark: Color

        func resolve(_ scheme: ColorScheme) -> Color {
            scheme == .dark ? dark : light
        }
    }

    // Base surfaces. `paper` is the page, `raise` the surface of a card or a control sitting on it.
    static let paper = Ink(light: Color(hex: 0xF6_F4_EE), dark: Color(hex: 0x15_14_10))
    static let raise = Ink(light: Color(hex: 0xFB_FA_F7), dark: Color(hex: 0x1C_1B_16))

    // Text. `ink` is body text and also the fill of a selected control; `onFill` is what sits on it.
    static let ink = Ink(light: Color(hex: 0x18_16_11), dark: Color(hex: 0xEB_E8_DF))
    static let ink2 = Ink(
        light: Color(hex: 0x18_16_11).opacity(0.66),
        dark: Color(hex: 0xEB_E8_DF).opacity(0.68)
    )
    static let onFill = Ink(light: Color(hex: 0xFB_FA_F7), dark: Color(hex: 0x15_14_10))

    // Lines. `rule` is a drawn border, `line` a hairline separator, `wash` a tinted band.
    static let rule = Ink(
        light: Color(hex: 0x18_16_11).opacity(0.85),
        dark: Color(hex: 0xEB_E8_DF).opacity(0.88)
    )
    static let line = Ink(
        light: Color(hex: 0x18_16_11).opacity(0.16),
        dark: Color(hex: 0xEB_E8_DF).opacity(0.17)
    )
    static let line2 = Ink(
        light: Color(hex: 0x18_16_11).opacity(0.34),
        dark: Color(hex: 0xEB_E8_DF).opacity(0.36)
    )
    static let wash = Ink(
        light: Color(hex: 0x18_16_11).opacity(0.05),
        dark: Color(hex: 0xEB_E8_DF).opacity(0.07)
    )

    /// Horizontal page inset (`--gutter`).
    static let gutter: CGFloat = 18
    /// Corner radius of a control (`--radius`).
    static let radius: CGFloat = 6
    /// The confirmation beat after a tap (`--dur-confirm`), in seconds.
    static let confirmDuration: TimeInterval = 0.16
}

extension Color {
    /// A 24-bit RGB literal, so the tokens above read as the hex in the stylesheet.
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

extension View {
    /// Applies the typographic treatment the web calls a "kicker": small, wide, upper case.
    ///
    /// Built on a text style rather than a point size: `Font.system(size:)` does NOT scale with
    /// Dynamic Type, which would leave the smallest text on the screen the only text unable to grow.
    func kicker(_ colour: Color) -> some View {
        font(.caption2.weight(.semibold))
            .textCase(.uppercase)
            .tracking(1.4)
            .foregroundStyle(colour)
    }
}
