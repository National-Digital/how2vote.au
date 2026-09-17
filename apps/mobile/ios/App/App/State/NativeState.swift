import Foundation

/// The native core's share of on-device state (ADR 0018 D3).
///
/// The core's screens are native, so their state is written here rather than through the WebView.
/// Both halves still live in one place: Capacitor's Preferences plugin is backed by `UserDefaults`,
/// so writing to the same defaults under the same names puts native state exactly where the WebView,
/// the durable mirror and — this is the part that matters most — `clearLocalDeviceData()` already
/// look. A store of our own would be invisible to "delete all my How2Vote data", which the product
/// boundary forbids outright.
///
/// Two contracts hold this together, and both are enforced here rather than assumed:
///
///   1. **Ownership is claimed before anything is written.** The WebView's backup pass prunes every
///      `how2vote:` key that Preferences has and its own `localStorage` does not. It stands down
///      only once it sees the marker. State written before the claim is therefore state the next
///      visibility change deletes, so `set` refuses until `claimOwnership()` has run.
///   2. **The native core writes only what it owns.** Terms acceptance, consent, the eligibility bit
///      and the theme stay the WebView's, consistent with the compliance chrome living in the D8
///      islands. Writing one of those from here would put two writers on one key, which is the
///      failure this whole arrangement exists to prevent.
///
/// `scripts/check-native-state-keys.mjs` holds these names to the web's declarations.
enum NativeState {
    /// Capacitor Preferences' `UserDefaults` namespace. Its default group is `CapacitorStorage`, and
    /// the plugin prefixes every key with it; a key written without this prefix is invisible to the
    /// plugin, and so to the WebView and to the data wipe.
    static let preferencesPrefix = "CapacitorStorage."

    /// Written at launch to tell the WebView's mirror that the native core owns the keys below.
    static let markerKey = "how2vote:native-core:v1"

    /// The key prefixes this core owns and is the sole writer of.
    static let ownedPrefixes = [
        "how2vote:quiz:",
        "how2vote:saved:",
        "how2vote:election:",
    ]

    enum StateError: Error, CustomStringConvertible {
        case ownershipNotClaimed(key: String)
        case notOwned(key: String)

        var description: String {
            switch self {
            case let .ownershipNotClaimed(key):
                return "refused to write \(key) before claimOwnership() — the WebView's backup pass "
                    + "would prune it on the next visibility change"
            case let .notOwned(key):
                return "refused to write \(key): the native core does not own it, and a second "
                    + "writer on one key is what the ownership split exists to prevent"
            }
        }
    }

    private static let defaults = UserDefaults.standard

    /// True when this device already carries the native core's ownership claim.
    static var ownershipClaimed: Bool {
        defaults.string(forKey: preferencesPrefix + markerKey) != nil
    }

    /// Declares the native core the owner of {@link ownedPrefixes}. Call once at launch, before the
    /// WebView is given a chance to run a backup pass and before any state is written.
    static func claimOwnership() {
        defaults.set("1", forKey: preferencesPrefix + markerKey)
    }

    /// Whether `key` is one the native core owns.
    static func owns(_ key: String) -> Bool {
        ownedPrefixes.contains { key.hasPrefix($0) }
    }

    /// Reads a value the native core owns, or any other `how2vote:` key the WebView has written.
    static func value(forKey key: String) -> String? {
        defaults.string(forKey: preferencesPrefix + key)
    }

    /// Writes a value the native core owns.
    static func set(_ value: String, forKey key: String) throws {
        guard owns(key) else { throw StateError.notOwned(key: key) }
        guard ownershipClaimed else { throw StateError.ownershipNotClaimed(key: key) }
        defaults.set(value, forKey: preferencesPrefix + key)
    }

    /// Removes a value the native core owns.
    static func remove(forKey key: String) throws {
        guard owns(key) else { throw StateError.notOwned(key: key) }
        defaults.removeObject(forKey: preferencesPrefix + key)
    }
}
