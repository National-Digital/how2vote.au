#!/usr/bin/env node
/**
 * Removes the build-time states files (`build/states/`) from every channel but iOS.
 *
 * They hold the states of native screens — an explainer out of its flow, every stage of every
 * election's lede — for the iOS app to project (ADR 0019 D4b). Served as pages they would show that
 * copy out of context, so they exist only in the build the iOS app is made from.
 */
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (process.env.PUBLIC_DIST_CHANNEL !== "ios") {
  rmSync(fileURLToPath(new URL("../build/states", import.meta.url)), {
    recursive: true,
    force: true,
  });
}
