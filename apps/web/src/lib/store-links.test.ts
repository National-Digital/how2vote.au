import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STORE_LINKS } from "./store-links";

/**
 * Source-level invariant: every distribution channel we link to is advertised the same way.
 *
 * The failure this catches is silent and asymmetric. Adding a channel to STORE_LINKS is one line,
 * and everything keeps working without a badge for it — the app is simply never offered on that
 * store. A behavioural test cannot see it either, since all three URLs are null until a listing is
 * live, so the badges render nothing in every test run.
 */
const LIB = resolve(dirname(fileURLToPath(import.meta.url)));
const COMPONENT = join(LIB, "components/StoreBadges.svelte");
const BADGE_DIR = join(LIB, "../../static/badges");

/** The badge artwork each channel is advertised with. */
const ARTWORK: Record<keyof typeof STORE_LINKS, string> = {
  appStore: "app-store.svg",
  playStore: "google-play.png",
  fDroid: "f-droid.svg",
};

describe("every channel in STORE_LINKS is advertised", () => {
  const source = readFileSync(COMPONENT, "utf8");
  const channels = Object.keys(STORE_LINKS) as (keyof typeof STORE_LINKS)[];

  it("covers every channel, so a new one cannot be added without a badge", () => {
    expect(channels.length).toBeGreaterThan(0);
    expect(Object.keys(ARTWORK).sort()).toEqual([...channels].sort());
  });

  for (const channel of channels) {
    it(`${channel}: gated on its own link, renders its own artwork, and the file exists`, () => {
      // Gated per channel, not on the group: a published Play listing must not put an App Store
      // badge on the page pointing nowhere.
      expect(source).toContain(`STORE_LINKS.${channel}`);
      expect(source).toContain(`/badges/${ARTWORK[channel]}`);
      expect(existsSync(join(BADGE_DIR, ARTWORK[channel]))).toBe(true);
    });
  }

  it("shows the group when ANY channel is live, not only the first two", () => {
    // The `show` guard is a disjunction that must list every channel — miss one and that store's
    // badge is dead markup on a page that renders nothing at all when it is the only live listing.
    const show = /const show =([\s\S]*?);\n/.exec(source)?.[1] ?? "";
    for (const channel of channels) expect(show).toContain(`STORE_LINKS.${channel}`);
  });

  it("keeps the badges off the native channels", () => {
    // A store build advertising a rival store is an App Review problem, and inside a shell the badge
    // is pointless anyway.
    expect(/const show =[\s\S]*?DIST_CHANNEL === "web"/.test(source)).toBe(true);
  });
});
