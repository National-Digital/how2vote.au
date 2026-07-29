#!/usr/bin/env node
/**
 * Build-time generator for the universal/app-link association files served from the how2vote.au
 * apex, so the installed apps can claim `https://how2vote.au/...` links (a shared card opens in the
 * app instead of the browser):
 *
 *   static/.well-known/apple-app-site-association   (iOS — needs the Apple Team ID)
 *   static/.well-known/assetlinks.json              (Android — needs the signing cert SHA-256)
 *
 * Both are **var-driven and skipped when their input is absent**, so the feature simply "switches
 * on" once the GitHub vars are set — nothing to code later:
 *   APPLE_TEAM_ID        → emits the AASA (appID = <TEAM_ID>.au.how2vote.app)
 *   ANDROID_CERT_SHA256  → emits assetlinks (Play app-signing cert fingerprint, colon-hex)
 *
 * Until then the files are absent and links open in the browser exactly as they do today (no
 * regression). The apex must actually serve these at `/.well-known/…` — deploy.yml passes the vars
 * to the web build. No effect on the native bundle (these are served by the WEB domain).
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WELL_KNOWN = join(ROOT, "static", ".well-known");
const APP_ID = "au.how2vote.app";

const teamId = (process.env.APPLE_TEAM_ID ?? "").trim();
const androidSha = (process.env.ANDROID_CERT_SHA256 ?? "").trim().toUpperCase();

mkdirSync(WELL_KNOWN, { recursive: true });

// iOS AASA — handle every path except the API. Regenerated each build; removed if the var is unset
// so a rolled-back Team ID can't leave a stale claim behind.
const aasaPath = join(WELL_KNOWN, "apple-app-site-association");
if (teamId) {
  const aasa = {
    applinks: {
      details: [
        {
          appIDs: [`${teamId}.${APP_ID}`],
          components: [{ "/": "/api/*", exclude: true }, { "/": "/*" }],
        },
      ],
    },
  };
  writeFileSync(aasaPath, `${JSON.stringify(aasa, null, 2)}\n`);
  console.info(`✓ apple-app-site-association written (appID ${teamId}.${APP_ID})`);
} else {
  rmSync(aasaPath, { force: true });
  console.info(
    "· APPLE_TEAM_ID unset — apple-app-site-association not emitted (links open in browser)",
  );
}

// Android assetlinks — Digital Asset Links for the Play app-signing cert.
const linksPath = join(WELL_KNOWN, "assetlinks.json");
if (androidSha) {
  const links = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: APP_ID,
        sha256_cert_fingerprints: [androidSha],
      },
    },
  ];
  writeFileSync(linksPath, `${JSON.stringify(links, null, 2)}\n`);
  console.info(`✓ assetlinks.json written (${APP_ID})`);
} else {
  rmSync(linksPath, { force: true });
  console.info("· ANDROID_CERT_SHA256 unset — assetlinks.json not emitted (links open in browser)");
}
