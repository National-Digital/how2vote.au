import Combine
import SwiftUI

/// The app's effective light/dark choice, as the WebView recorded it.
///
/// The theme preference is the WebView's key, not the native core's (ADR 0018 D3): it sits outside
/// `NativeState.ownedPrefixes`, so the native core reads it and never writes it. Reading it matters
/// — without it a voter who chose dark on a light device would meet a light quiz between two dark
/// screens, because SwiftUI's `colorScheme` reports the SYSTEM appearance and knows nothing about an
/// in-app override.
///
/// "system" means exactly that: defer to `colorScheme` and follow a mid-session change, which is
/// what the CSS does on the other channels.
@MainActor
final class NativeTheme: ObservableObject {
    /// Mirrors `KEY` in `apps/web/src/lib/theme.svelte.ts`. Held to it by
    /// `scripts/check-native-theme.mjs` — a key that differed would read nothing and silently fall
    /// back to the system appearance, which looks like a preference that simply did not stick.
    static let preferenceKey = "how2vote:theme"

    enum Preference: String {
        case light
        case dark
        case system
    }

    static let shared = NativeTheme()

    @Published private(set) var preference: Preference = .system

    private init() {
        reload()
    }

    /// Re-reads the preference from the durable store.
    func reload() {
        let raw = NativeState.value(forKey: Self.preferenceKey) ?? ""
        preference = Preference(rawValue: raw) ?? .system
    }

    /// Accepts a preference the WebView has just written.
    ///
    /// The web performs the durable write — it owns the key — and tells the native side what it
    /// wrote, so a screen already on display updates without waiting for the mirror's next pass.
    func accept(_ raw: String) {
        preference = Preference(rawValue: raw) ?? .system
    }

    /// The scheme to render in, given what the system reports.
    func resolve(_ system: ColorScheme) -> ColorScheme {
        switch preference {
        case .light: return .light
        case .dark: return .dark
        case .system: return system
        }
    }
}

extension View {
    /// Renders this screen in the app's effective theme rather than the system's.
    ///
    /// Applied once at the top of each native screen; `colorScheme` then reports the effective value
    /// to everything beneath, so `Theme.Ink.resolve` needs no special case.
    func nativeTheme(_ theme: NativeTheme, system: ColorScheme) -> some View {
        environment(\.colorScheme, theme.resolve(system))
    }
}
