/**
 * Durable on-device persistence for the native shells.
 *
 * All app state lives in `localStorage` under the `how2vote:` namespace (see privacy/local-data.ts).
 * That is perfect for the web PWA, but inside a WebView Apple's WebKit can evict `localStorage` under
 * storage pressure / after ~7 days of no use — which would silently wipe a voter's saved cards and
 * in-progress answers between visits. Capacitor's Preferences plugin is backed by native key/value
 * storage (UserDefaults / SharedPreferences) that is NOT subject to that eviction.
 *
 * Strategy (native only; a complete no-op on the web, where this is never wired up):
 *   - on launch, RESTORE: any `how2vote:*` key present in native Preferences but missing from
 *     localStorage is copied back in, before the stores hydrate — so an eviction is transparently
 *     healed and the user never notices.
 *   - thereafter, BACK UP: mirror the `how2vote:*` localStorage keys into Preferences on visibility
 *     change / pagehide (and once after restore), so the durable copy stays current.
 *
 * This moves NOTHING off the device and adds no network surface: Preferences is local storage, the
 * same data, the same namespace. `clearLocalDeviceData()` clears it too (see local-data.ts).
 */
import { isNativeShell, nativePreferencesPlugin } from "./channel";
import {
  AGE_ELIGIBILITY_KEY,
  NATIVE_CORE_MARKER_KEY,
  STORAGE_KEY_PREFIX,
  isNativeOwnedKey,
} from "./privacy/local-data";

/**
 * Keys never written to the durable copy, because restoring one is worse than losing it.
 *
 * A restore cannot tell WebKit eviction from a deliberate deletion — both look like "missing from
 * localStorage". For the eligibility bit that asymmetry is disqualifying: an under-18 who declares
 * minority has the bit removed, and healing it back would silently re-confirm the gate and hand them
 * the plan builder, print, share and the 18+-only research path. Losing the bit to eviction costs one
 * tap on a gate that is designed to be re-answered; restoring it wrongly costs the gate itself.
 */
const NEVER_MIRRORED: readonly string[] = [AGE_ELIGIBILITY_KEY, NATIVE_CORE_MARKER_KEY];

const isMirrored = (key: string): boolean =>
  key.startsWith(STORAGE_KEY_PREFIX) && !NEVER_MIRRORED.includes(key);

/**
 * Whether the native core has declared itself the owner of the core's state on this device.
 *
 * Read from Preferences on every pass rather than cached at startup, so neither pass depends on the
 * other having run first — `backupToNative` fires on visibility change and can precede a restore.
 */
let nativeCoreOwnsState = false;

/**
 * Whether the backup pass may touch a key at all.
 *
 * Once the native core owns a key, both halves of the pass are wrong for it: the prune would read
 * "absent from localStorage" as an orphan and delete the voter's answers, and a write would replay
 * whatever copy a restore left behind over a fresher native value.
 */
const isBackedUp = (key: string): boolean =>
  isMirrored(key) && !(nativeCoreOwnsState && isNativeOwnedKey(key));

/** Restore evicted `how2vote:*` keys from native Preferences into localStorage. Native-only. */
export async function restoreFromNative(): Promise<void> {
  const prefs = nativePreferencesPlugin();
  if (!isNativeShell || !prefs || typeof localStorage === "undefined") return;
  try {
    const { keys } = await prefs.keys();
    nativeCoreOwnsState = keys.includes(NATIVE_CORE_MARKER_KEY);
    for (const key of keys) {
      if (!isMirrored(key)) continue;
      // Only heal a MISSING key — never clobber a value the live session already holds. The one
      // exception is a key the native core owns: there Preferences is not a backup of this
      // WebView's state, it IS the state, so a stale localStorage copy must give way to it.
      const nativeOwned = nativeCoreOwnsState && isNativeOwnedKey(key);
      if (!nativeOwned && localStorage.getItem(key) !== null) continue;
      const { value } = await prefs.get({ key });
      if (value !== null) localStorage.setItem(key, value);
    }
  } catch {
    /* durability is best-effort — a failure must never block app start */
  }
}

/**
 * Drop `keys` from the durable copy, for a deletion the user asked for.
 *
 * Deleting only the localStorage key is not enough: until a backup pass prunes the orphan, the next
 * launch's restore reads it as an eviction and heals it back — and once healed the key is live again,
 * so no later prune removes it either. Every deletion site must therefore write through to here.
 * Native Preferences goes FIRST so an interrupted deletion leaves the data visibly undeleted (the
 * user can retry) rather than silently resurrected.
 */
export async function removeFromNative(keys: readonly string[]): Promise<void> {
  const prefs = nativePreferencesPlugin();
  if (!isNativeShell || !prefs) return;
  try {
    for (const key of keys) {
      if (key.startsWith(STORAGE_KEY_PREFIX)) await prefs.remove({ key });
    }
  } catch {
    /* best-effort — the localStorage removal at the call site still stands */
  }
}

/** Mirror the current `how2vote:*` localStorage keys into native Preferences. Native-only. */
export async function backupToNative(): Promise<void> {
  const prefs = nativePreferencesPlugin();
  if (!isNativeShell || !prefs || typeof localStorage === "undefined") return;
  try {
    // The ownership claim is read before anything is pruned: a pass that pruned first and asked
    // afterwards would already have deleted the state it was meant to leave alone.
    const { keys } = await prefs.keys();
    nativeCoreOwnsState = keys.includes(NATIVE_CORE_MARKER_KEY);

    const live = new Set<string>();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && isBackedUp(key)) live.add(key);
    }
    // PRUNE FIRST. This pass is often cut short — its only triggers are visibilitychange/pagehide,
    // where the WebView may already be going away mid-await. Dropping orphans before writing means a
    // truncated pass still removes what the user deleted, instead of only re-writing what they kept.
    // It also retires a key that a previous build mirrored and NEVER_MIRRORED now excludes.
    for (const key of keys) {
      if (key === NATIVE_CORE_MARKER_KEY) continue;
      if (nativeCoreOwnsState && isNativeOwnedKey(key)) continue;
      if (key.startsWith(STORAGE_KEY_PREFIX) && !live.has(key)) await prefs.remove({ key });
    }
    for (const key of live) {
      const value = localStorage.getItem(key);
      if (value !== null) await prefs.set({ key, value });
    }
  } catch {
    /* best-effort */
  }
}

// Clearing native Preferences on "delete my data" lives inline in privacy/local-data.ts
// (clearLocalDeviceData) to avoid an import cycle back into this module.
