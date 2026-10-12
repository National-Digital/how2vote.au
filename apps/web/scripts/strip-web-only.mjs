#!/usr/bin/env node
/**
 * Removes the static data files (`build/data/`) from every channel but the web.
 *
 * They are published on how2vote.au for other programs to fetch; the app shells neither read nor
 * serve them, so they stay out of the app bundles.
 */
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const channel = process.env.PUBLIC_DIST_CHANNEL;

if (channel && channel !== "web") {
  rmSync(fileURLToPath(new URL("../build/data", import.meta.url)), {
    recursive: true,
    force: true,
  });
}
