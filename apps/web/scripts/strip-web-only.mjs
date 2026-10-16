#!/usr/bin/env node
/**
 * Removes the static data files (`build/data/`) from every channel but the web.
 *
 * They are published on how2vote.au for other programs to fetch; the app shells neither read nor
 * serve them, so they stay out of the app bundles.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {string} build  the web build directory
 * @param {string | undefined} channel  PUBLIC_DIST_CHANNEL
 */
export function stripWebOnly(build, channel) {
  if (channel && channel !== "web") rmSync(join(build, "data"), { recursive: true, force: true });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  stripWebOnly(
    fileURLToPath(new URL("../build", import.meta.url)),
    process.env.PUBLIC_DIST_CHANNEL,
  );
}
