# Store distribution (Apple App Store + Google Play + F-Droid)

The store apps are **Capacitor shells around the unchanged web build**: `apps/mobile` bundles
the exact static output of `apps/web` (dataset, maps, stats, fonts included), so the store apps
are the same offline product as the PWA — there is no separate mobile codebase. No app asset or
data is fetched at runtime: the bundle is fixed at build time and there is no over-the-air update
path, so every app change ships as a new binary through each store's review (Apple guideline 2.5.2
requires this, and the offline guarantee depends on it). The only network traffic a shell can
originate is the optional, opt-in research contribution and the contact form (both first-party,
see below), plus links the user chooses to follow out to the AEC or They Vote For You.

## Channel awareness

One build-time flag, `PUBLIC_DIST_CHANNEL` (`web` default | `ios` | `android` | `fdroid`), read only by
`apps/web/src/lib/channel.ts`. Native behaviour gates on `isNativeShell`, never on a specific
platform:

| Behaviour | web | native shells |
| --- | --- | --- |
| Quiz, comparison, card, research contribution, all content pages | full | **identical** — the shells bundle the same static build byte-for-byte |
| Share links | canonical `https://how2vote.au/...` (from `SITE_URL`, never `window.location`) | same, sent through the native share sheet (`@capacitor/share`) |
| Print the authorised how-to-vote card | `window.print()` | **not offered** — printing is a web-PWA feature only; the shells carry no print plugin and expose no print action. Users who need a printed card open the site |
| Links that leave the site (AEC, They Vote For You, licences) | new tab | in-app browser over the app (`@capacitor/browser` — SFSafariViewController / Chrome Custom Tabs), so Done returns the reader to a part-built plan instead of stranding them in the system browser. Only `http(s)` is handed over; `market://` and `itms-apps://` stay OS handoffs |
| Offline page | service-worker cache readout | "installed by design" copy (no SW; registration disabled on native) |
| Research contribution (optional survey) | offered, opt-in | **offered, opt-in** — posts to the canonical origin via the endpoints' strict CORS allowlist |
| Data collection | opt-in research + first-party forms; no analytics | **identical** — opt-in research (same as web) + first-party forms; nothing else leaves the shell |

On the shells, saved plans also go through a durable native store
(`apps/web/src/lib/native-storage.ts`): WebView `localStorage` is subject to platform storage
pressure, so the bridge keeps a copy the platform cannot silently evict.

### Native research contribution — how the posture is preserved

The optional survey is offered on all three channels. The research ingestion endpoints (`/api/*`)
are same-origin on the web; from a native shell the WebView origin is local, so the POST is
**cross-origin to `https://how2vote.au`**. This is done without weakening any invariant:

- **CORS is a browser policy, not an auth boundary.** The endpoints were always reachable by any
  HTTP client; the integrity is enforced by the single-use signed token, the self-hosted
  proof-of-work challenge (ADR 0017), the aggregate-only store, the no-IP/no-UA/no-log rules and
  the edge rate-limit — all unchanged.
- **Strict allowlist.** `src/lib/research/cors.ts` reflects an `Access-Control-Allow-Origin` only
  for the two exact shell origins (`capacitor://localhost`, `https://localhost`) — never `*`, never
  arbitrary reflection — and never emits `Allow-Credentials` (requests stay `credentials: "omit"`).
- **Client** targets the canonical origin only on native (`survey.ts` → `researchEndpointUrl`); the
  field allowlist, no-store and no-credentials transport are identical to the web path.
- **CSP** adds `https://how2vote.au` to `connect-src` for native builds only (first-party; the web
  PWA keeps `connect-src 'self'`).
- **No third-party allowlist exists.** The challenge is self-hosted (ADR 0017: our
  `/api/challenge` issues the proof-of-work and verifies it server-side), so there is no captcha
  site-key hostname list to extend for the shells — the CORS allowlist above is the complete
  origin configuration. The cross-origin exposure itself is covered by the `storeDistribution`
  determination (`data/legal/product-boundary.json`, `EV-STORE-DISTRIBUTION-2026`).

### Deliberate parity gaps (documented, not silent)

1. **Deep links / universal links — planned enhancement, no functionality lost.** A shared
   `https://how2vote.au/card#…` link opens the card in the browser PWA on every platform today
   (identical behaviour). Making the installed app *intercept* those links is an enhancement that
   needs the Apple Team ID (Associated Domains + AASA) and the Android signing-cert SHA-256
   (App Links + assetlinks.json) — both account-gated.

### Stale-data notice (shipped)

`apps/web/src/lib/staleness.ts` decides, `StaleDataNotice.svelte` renders, and the root layout
mounts it on every channel.

**Not a version check.** Both stores already auto-update by default (iOS Settings → App Store → App
Updates; Play → auto-update over Wi-Fi) and both badge/notify the minority who turn that off, so
getting the newer binary onto the device is the OS's job and stays the OS's job. The notice
introduces no runtime network call to find out whether a newer version exists: the no-runtime-fetch
invariant is absolute here.

What the store's auto-update does *not* answer is the question that actually matters here. Because
the dataset ships **inside the binary** with no OTA path, an old build isn't a stale UI — it is
**stale candidate data**, and it is most wrong exactly when it matters most (a voter who installed
months ago, opening the app in the week before a poll). So the notice is framed as data age, and its
trigger is derived entirely from **data we already ship**:

- `dataVersion` (on every record in `data/dist/elections.json`) — the date the bundled dataset for
  that election was cut. Compiled into the bundle, so it is readable offline.
- `timetable` (`issueOfWrit` → `closeOfNominations` → `declarationOfNominations` → `pollsCloseAt` →
  `returnOfWrits`) and `provisionalStage` on the current election — when the data is *expected* to
  change, and when accuracy is load-bearing.
- The device clock.

**Trigger rules** (evaluated against the `current: true` record only — past elections are immutable
and must never prompt):

| Bundled state vs. now | Behaviour |
| --- | --- |
| `provisionalStage: "pending"` (no writ, no timetable) — e.g. the `next` record today | **Silent.** Nothing volatile to be stale about; the data age is still shown passively on `/about` and `/offline`. |
| Writ issued, `now < closeOfNominations` (incl. `provisional` / `drawn` stages) | Candidate list is still churning by design. Notice only if `dataVersion` is more than ~14 days old. |
| `declarationOfNominations ≤ now ≤ pollsCloseAt` **and** `dataVersion < declarationOfNominations` | **Prominent.** The bundle provably predates the final declared candidates, so its ballot data is incomplete — the one case worth interrupting for. |
| `now > pollsCloseAt` of the bundled current election | The bundle is a generation behind (a newer `next` record exists upstream). Low-urgency notice. |
| `now <` the newest `dataVersion` (device clock wrong or behind) | **Silent** — fail closed to silence rather than nag on a bad clock. |

Dismissal is remembered per `dataVersion`, so a dismissed notice stays dismissed until a genuinely
newer dataset ships, and it never fires more than once per launch.

**One trigger, all three channels — no per-channel thresholds.** *When* the notice fires, and the
`dataVersion` it fires on, are identical on web, iOS and Android: one pure, unit-testable module
(`apps/web/src/lib/staleness.ts`) over the imported registry + `now.svelte.ts`, holding **no
`fetch`** and **no `isNativeShell` branch**. The predicate must not be able to drift per channel, so
it is enforced the way the age gate is (`scripts/check-age-gate.mjs`): `scripts/check-staleness.mjs`
statically asserts the module contains no `fetch` and no channel conditional, and a unit test
asserts the same registry input yields the same verdict under every `PUBLIC_DIST_CHANNEL`.

Only the **remedy** differs, because only the remedy actually differs in reality:

| | Web PWA | iOS / Android |
| --- | --- | --- |
| Trigger + `dataVersion` | shared predicate | **same shared predicate** |
| Action | reload to apply the waiting build | open the store listing |

- **Native** — the action is a plain user-initiated store deep link
  (`itms-apps://apps.apple.com/app/id<APPLE_APP_ID>`, `market://details?id=au.how2vote.app`); no
  version lookup is needed to construct it. The Apple numeric App ID is account-gated.
- **Web PWA** — additionally keeps the existing service-worker signal (`swUpdateReady` in
  `+layout.svelte`) for "a new build is already downloaded, reload to apply". This is a *second,
  independent* signal, not a different threshold: native has no equivalent state (the OS either
  updated the binary or it didn't), whereas a wedged service worker can serve a stale shell
  indefinitely with no store to fall back on.
- **Do not depend on `/release-manifest.json`** for this — it is emitted at deploy, *after*
  prerender, so it is not reliably present in the native bundle. `dataVersion` is compiled in and is
  the more honest signal anyway.
- **A lag between channels is not drift.** Web can redeploy the same day a dataset lands while a
  native build waits days in review, so native's bundled `dataVersion` will legitimately trail web's
  — and the notice firing on native but not web is then *correct*, not a bug. The thing to prevent is
  the predicate itself diverging, which is what the static check above is for.
- **Compliance** — because the predicate is local and the deep link is a user-initiated OS handoff,
  there is **no new runtime egress**: no `third-party-services.json` vendor entry, no `connect-src`
  change, no consent surface. The store handoff is disclosed in the privacy note.

### Support matrix (single declared floor for all three channels)

`apps/web/vite.config.ts` pins `build.target` to `es2021 / safari15 / chrome99`, at or below both
native deployment floors so one bundle is safe everywhere:

| Channel | Floor |
| --- | --- |
| Web PWA | Safari 15+, Chrome 99+ (evergreen) |
| iOS shell | iOS 17 (`IPHONEOS_DEPLOYMENT_TARGET`) — raised from 15 for the native core (ADR 0018 D10) |
| Android shell | `minSdk 24` (Android 7); System WebView auto-updates via Play |

Tablet posture: portrait-first. Phones are orientation-locked; large screens (iPad, and Android
tablets under `targetSdk 36` which ignores the lock) may rotate — the layout is responsive.

### Declared permissions

The whole permission surface of all three channels, platform and browser. A permission with no live
call site is removed rather than left declared. Egress itself (CSP, `connect-src`, the third-party
register) is a separate matter, covered by the research posture above and `docs/privacy/`; the store
privacy declarations have their own section below.

**Android — declared.** One `uses-permission` of ours, `android.permission.INTERNET`
(`apps/mobile/android/app/src/main/AndroidManifest.xml`) — what the built APK ends up requesting is
under "merged" below. It is used for three things:

1. **User-initiated first-party requests.** The contact form (`apps/web/src/lib/forms.ts` →
   `POST /api/forms`) and the optional research contribution (`apps/web/src/lib/survey.ts` →
   `/api/research/*`), both gated by the self-hosted proof-of-work challenge
   (`apps/web/src/lib/altcha.ts` → `POST /api/challenge`). Research is opt-in behind a consent +
   18+ gate and aggregate-only; the form is sent when the user submits it. From a native shell both
   target `SITE_URL`, since `/api/*` does not exist on the local WebView origin — the
   `isNativeShell` branch in each module. Every endpoint is AGPL code in this repo and self-hostable
   (`docs/self-hosting.md`).
2. **Outbound links** the user follows to the AEC or They Vote For You, opened in the in-app
   browser.
3. **The WebView origin.** Capacitor requires the permission for the `https://localhost` origin the
   bundle is served from (its default `androidScheme`; `apps/mobile/capacitor.config.ts` sets no
   `server.url`). The assets themselves are returned locally, by the bridge's
   `shouldInterceptRequest` handler, not over a socket.

It is not used for analytics or telemetry, an advertising identifier, crash reporting, remote
config, over-the-air asset or dataset updates, or any startup request. Dataset, maps, stats and
fonts are compiled into the binary, so the quiz, the comparison and the card work with no
connection.

**Android — merged.** What ships is the manifest merger's output, not the authored file: Gradle folds
in every dependency's library manifest, and the built APK requests **two**:

| In the APK | Origin | What it grants |
| --- | --- | --- |
| `android.permission.INTERNET` | this manifest | as above |
| `au.how2vote.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | injected by `androidx.core` | nothing outside the app — a `signature`-level permission the app both declares and uses, so its context-registered broadcast receivers are not exported (required from Android 14 / `targetSdk` 34). Only code signed with our key can hold it, and no other app can be granted it |

None of the Capacitor packages the shell depends on (`android`, `app`, `browser`, `core`,
`preferences`, `share`) declares a permission of its own. The `fdroid` job asserts the pair against
the built APK (`aapt2 dump permissions`) and fails if the set changes, so a dependency that adds one
cannot reach a store listing or an F-Droid review while this register still says otherwise. The job
runs when a PR touches `apps/mobile/**` or `pnpm-lock.yaml`, and on a draft PR only once it is
marked ready.

**iOS.** No purpose strings at all: `apps/mobile/ios/App/App/Info.plist` carries no
`NS*UsageDescription` key and no `UIBackgroundModes`. Neither platform uses camera, microphone,
location, contacts, photo library, notifications or any background capability, and `MainActivity`
overrides no WebView permission handler.

**Browser capabilities.** What the WebView or browser gates rather than the manifest:

| Capability | Where | Prompt |
| --- | --- | --- |
| Web Share, or the Capacitor Share plugin in a shell | `routes/card/+page.svelte` | none — user gesture |
| Clipboard write (the share fallback) | `routes/card/+page.svelte` | browser-dependent |
| `window.print()` | web PWA only — not offered in the shells | none |
| Service worker + Cache Storage | web only; registration gates on `!isNativeShell` in `+layout.svelte` | none |
| `localStorage`, plus the durable native store | `apps/web/src/lib/native-storage.ts` | none |

Nothing queries `navigator.permissions`, and there is no `getUserMedia`, geolocation, `Notification`
or `storage.persist()` call anywhere in the tree.

**`Permissions-Policy`.** `apps/web/static/_headers` denies `accelerometer`, `autoplay`,
`browsing-topics`, `camera`, `display-capture`, `geolocation`, `gyroscope`, `interest-cohort`,
`magnetometer`, `microphone`, `payment` and `usb`. It is a response header, so it binds the **web
PWA only** — the shells load from a local origin that receives no headers, where what holds is the
absence of the capability from the code.

## Release flow

`deploy.yml` tags `v<version>` and publishes a GitHub Release on every push to `main`, then, when
the release ships the apps (see "Which releases ship the apps" below), dispatches both store
workflows **on `main`** with `tag=v<version>`. Each workflow's build job
checks out that tag, refuses it unless `main` contains it, and records the commit; every later job
checks out that commit, so a tag moved mid-run cannot change what ships. The workflow definition
therefore always comes from `main`, which is what lets every store credential live in an
environment limited to `main` (see "Credential environments" below):

1. **`ios-release.yml`** (macOS runner) — builds the `ios`-channel web bundle → `cap sync ios` →
   fastlane archives ad-hoc (no Apple credentials, so the archive step cannot create a
   certificate), then exports the ipa with Apple's cloud-managed distribution certificate via the
   App Store Connect API key (no certificate store). The lane fails if the archive is
   certificate-signed, if the ipa lacks a distribution signature or any `App.entitlements` entry,
   or if any new development or distribution certificate appeared during the build → **uploads
   to TestFlight automatically** → the `submit` job (`ios-submit.yml`) waits on the **`app-store`
   environment** (required reviewer = a human promotes every store submission), then submits that
   build for App Review with metadata generated from the operator record. When an earlier version
   is still in App Store Connect it cancels, defers or stops as described in "Overlapping store
   releases" below.
2. **`android-release.yml`** (ubuntu runner) — builds the `android`-channel bundle →
   `cap sync android` → gradle builds the release AAB signed with the **upload key** (Google
   Play re-signs with its escrowed app signing key) → **uploads to the Play internal track
   automatically** → the `promote` job waits on the **`play-store` environment**, then promotes
   internal → production at a **staged 10% rollout** (see Rollout policy below), replacing any
   earlier staged rollout (see "Overlapping store releases" below).
3. **F-Droid** — no workflow of ours runs: F-Droid's buildserver builds from the release tag via
   the fdroiddata recipe, discovers new releases by polling
   `https://how2vote.au/app-version.json`, and publishes our signed APK when its build reproduces
   ours. See the F-Droid section below for the whole mechanism.
4. **`mobile-ci.yml`** (PRs, no secrets) — two tiers decided by its `scope` job. Always: store
   metadata limits + authorisation invariants, cross-channel drift, native plugin parity, the
   static F-Droid gate, channel baking, and the per-channel behaviour specs (the only place the
   native branches of channel-aware code execute). When a change can affect a native build: both
   shells compiled, with the binaries attached. See "Per-PR builds" below.

Both release workflows support `workflow_dispatch` with `dry_run` (build + sign, no upload) and
record the artifact's SHA-256 in the job summary. Every job that holds a credential is in a
`main`-only environment, so **dispatch from `main`, dry runs included**: a dispatch from any other
ref is refused at the environment before a runner starts. Signing changes on a branch are proved by
merging them and dry-running from `main`; the iOS dry run cannot be offered on branches, because its
export step needs the cloud-signing App Store Connect key. A real run must name `tag` (the build job
fails without it); only a dry run may leave it empty, which builds `main`'s head.

**Workflow and tag are coupled.** A store run executes `main`'s workflow YAML, as it stands when
the run is dispatched, against the tag's code: the composite actions (`.github/actions/*`), the
Fastfile lanes, the gradle build and the scripts all come from the tag. A store-workflow change
merged while an earlier release is still to be dispatched, or before an earlier tag is dispatched
by hand, runs the new YAML against the earlier tag's code. A change to a store workflow, a
composite action or a lane must therefore stay compatible with the previous release's tag for one
release. Where that is impractical, merge it only after the previous release's build job has
started; a run keeps the YAML it was created with.

Both **fail closed on missing secrets**. A release run has two honest outcomes — the build reached
the store, or the run is red — so a repo that cannot publish must never show a green tick. The one
case that is genuinely "no channel to release to" is handled separately: `ios-release.yml` skips
its jobs entirely while the `APPLE_TEAM_ID` **variable** is unset (no Apple enrolment), and fails
closed on missing `ASC_*` secrets once it is set. Setting `APPLE_TEAM_ID` is therefore the switch
that declares iOS live. `scripts/check-play-permission.mjs` follows the same rule: a missing
`PLAY_SERVICE_ACCOUNT_JSON` is red, because a credential that has disappeared is one of the ways
"we can no longer publish" shows up.

The five Android secrets must be set for releases to work at all. Pull requests cannot reach any
of them: the release workflows do not run on `pull_request`, every credential sits in an
environment that admits only `main`, and the production-release credentials additionally sit behind
the `play-store`/`app-store` required reviewers; `mobile-ci.yml`'s static and behaviour jobs reference no secrets, and its Android build reads the
signing secrets only to decide whether it can produce a release-signed APK — a fork pull request
gets a debug-signed one instead, which still installs on a device.

### Overlapping store releases

A release per merge means a store run often starts while an earlier release is still with a store.
Release tooling (`scripts/app-store-submission.mjs`, `scripts/play-promotion.mjs`,
`scripts/supersede-store-runs.mjs`) is checked out from the workflow's own commit on `main`, not
from the tag being shipped, so it always matches the YAML running it.

**Stale gated runs.** Once a release's build job succeeds, a `supersede` job cancels older runs of
the same workflow that are waiting at the `play-store`/`app-store` gate for an older tag (matched by
run name, `Android release v1.5.0`; dry runs are never touched). A run with a job still executing,
such as an F-Droid publish, is left alone, and each run's jobs are read again just before it is
cancelled. Every gated job also stands down, green and without changing the store, when the store
itself already holds something newer: on iOS a newer version or a processed build of one in App
Store Connect, on Play a higher version code on the internal or production track. A newer tag alone
never stops a gated job, so a release whose newer successor failed before reaching the store still
goes out when approved.

**App Store.** App Store Connect allows one open review submission and one version in flight. Before
`deliver` runs, `ios-submit.yml` reads the app's review submissions, versions and processed builds
and decides:

| An earlier version is | The submit job | Recorded as `app-store/<tag>` |
| --- | --- | --- |
| nowhere in flight | submits | `success` |
| waiting for review | re-reads that submission, cancels it while it is still waiting (the version becomes Developer Rejected), waits for the cancellation to settle (up to 15 minutes), then `deliver` renames that editable version to this release, attaches this build and submits. A submission still waiting after the job cancelled it fails the job at once | `success` |
| in an unsent draft submission | removes the draft's items (App Store Connect refuses to cancel or delete a draft), and `deliver` reuses the empty draft. If the items cannot be removed, the job fails and says to remove them in App Store Connect | `success` |
| in review | **defers**: never cancels a review in progress; the build stays in TestFlight | `pending` |
| approved and not yet released (Pending Developer Release, Pending Apple Release, Processing for Distribution, Accepted) | **defers**: App Store Connect refuses a new version until the approved one is released, and developer-rejecting an approved version can leave it uneditable | `pending` |
| rejected (its submission has unresolved issues), or in a state the script does not know | **fails red**: a rejection needs a person | `failure` |
| this same build, already submitted; or App Store Connect holds a newer version, or a processed build of one | does nothing | `success` |

A deferred job is green, with a notice and a job summary line. **`ios-submission-catch-up.yml`**
runs every three hours. While no `ios-release` run is in flight, it lists the releases on `main`
that shipped the apps (trusted tags only, as in "Which releases ship the apps"), takes the newest
one with a processed build in App Store Connect, and if its `app-store/<tag>` status is `pending`
asks App Store Connect (read-only, with the `ios-build` key) whether the way is now clear. Only then does it call
`ios-submit.yml`, which waits for the `app-store` reviewer like any submission and checks the state
again before `deliver`, so a build is never submitted twice; two submissions of one release never
run at once. Expect an approval request from it after an earlier version is released. Whether the
`ios-build` key, a Developer-role key, may read review submissions and versions is not verified. If
it cannot, the check passes the decision to the gated job instead, so the approval request comes
every three hours while a submission is owed; approving it early just defers again. The owner
checklist below includes a dispatch that shows which case applies. Only the newest shipped release is caught up: an
older deferred one is superseded by it.

With `automatic_release: false` an approved version waits in Pending Developer Release until
someone releases it, so in practice the catch-up submits the next build shortly after that click.

**Google Play.** `promote` first reads the production and internal tracks in a throwaway edit. It
skips a build production already holds, or one older than a build on the internal or production
track (a version code can only move forward, and the newer release's own run promotes it), and fails
if the build is not on the internal track. Otherwise fastlane
sends a track update carrying only the new release: Play treats an update's releases as the desired
change and keeps the last completed release in place beneath a staged one, and the new staged
release is expected to replace an earlier one still rolling out (users who already have the earlier
build keep it, and a new staged release goes to the same group of users first). What Play does with
an earlier release that was **halted** is not documented: check the production track after
promoting over one. The job summary names the
rollout it replaced. With Managed publishing on, the committed change waits in Publishing overview;
a later promotion replaces it there before anyone publishes. If an earlier change is still in
Google's review, Play refuses to send another for review automatically, and fastlane re-commits it
as "not sent for review": send it for review from Publishing overview.

#### Submission deferred or blocked

- **Deferred** (green run, notice "App Store submission of X deferred"): nothing to do. Release or
  wait out the earlier version; the catch-up submits the newest shipped build afterwards and asks
  for `app-store` approval. To push it sooner, run `ios-submission-catch-up.yml` from `main`.
- **Rejected** (red run, "unresolved issues"): read the rejection in App Store Connect → App
  Review. Either reply and resubmit the rejected version there, or, to replace it with the newest
  build, cancel that submission in App Store Connect, then run `ios-submission-catch-up.yml` from
  `main` with `tag` set to the newest shipped release. The rejection closes `app-store/<tag>` as
  `failure`, so the schedule does not retry it; the `tag` input re-arms it.
- **Blocked on an unknown state** (red run naming the state): resolve it in App Store Connect,
  then dispatch the catch-up with `tag` as above.
- **Never re-run a submit job**, and do not run `deliver` by hand: dispatch the catch-up instead,
  which re-checks the state first.
- **Draft could not be emptied** (red run, "remove them in App Store Connect"): open the draft
  submission in App Store Connect, remove its items, then dispatch the catch-up with `tag`.
- **Play**: a skipped promotion names the newer build Play already holds. To promote a release
  whose run was cancelled as stale, re-dispatch `android-release.yml` for the newest release.

### Which releases ship the apps

A store release costs an App Review, a Play rollout and an F-Droid build, so a merge that changes
nothing in the apps deploys the web, is tagged and released as usual, and dispatches no store
workflow. `scripts/store-release-scope.mjs` decides in the deploy job, before the build, by diffing
the pushed commit against the **last release whose apps shipped**:

- **Ships**: anything not on the deny-list below, including unknown paths. In practice: `apps/web`
  (the bundled build), `apps/mobile` (the shells, the Fastfile, store metadata and screenshots),
  `packages/engine` and `packages/data-schema`, `data/`, the F-Droid listing under `fastlane/`,
  `pnpm-lock.yaml` and the other root build config, the `$docs` files the web bundle imports
  (`docs/research/`), the native copy sources in `docs/legal/`, the F-Droid recipe the release
  replays (`docs/fdroid/`), the store workflows and composite actions, and the root scripts a store
  build runs. Listing changes ship because `deliver`/`supply` upload metadata with each release and
  F-Droid reads the listing at the tag.
- **Always ships**: a change to `pnpm-lock.yaml`, the store workflows or the composite actions, even
  when no app source changed. Each can change the bytes of the binary, and F-Droid publishes a
  version only when its own build from that tag reproduces the APK we built from the same tree, so
  every advertised version needs an APK built from exactly that tree.
- **Skips**: root community files (`*.md`, `LICENSE`, `CITATION.cff`), the rest of `docs/`, the rest
  of `.github/`, editor and lint config, every other root script, `infra/`, `tools/`,
  `packages/data-pipeline` (its outputs are committed under `data/`), tests (`*.test.*`, `*.spec.*`,
  `apps/web/e2e`, `features`, `test-support` and the test configs), and the Pages Functions with
  their migrations and `wrangler.toml`.

`store-release-scope.test.mjs` derives the store-build scripts from the release workflows and
composite actions, and the `$docs` imports from the web source, and fails if either falls on the
deny-list.

Every PR's Deploy run previews the decision in its job summary ("Store release on merge").
Overrides go in the pull request's title or body, standing on their own (a marker in backticks or
joined to a word is ignored, so they can be written about):

| Marker | Effect |
| --- | --- |
| `[ship-apps]` | ships a change the deny-list would skip. Also honoured in a commit message |
| `[skip-apps]` | holds back an app-affecting change, to batch it with the next one. The base stays at the last release that shipped, so the held-back changes ship with the next release that does. `[ship-apps]` wins if both are present |

The decision is recorded on the release tag, which `deploy.yml` creates **annotated** with a
`Store-Release: ship` or `Store-Release: skip` trailer; a skipped release also says so in its
release notes. The diff base is the newest reachable release tag not marked `skip` (lightweight
tags predate the trailer and all shipped). On a ship decision, the release job refuses an existing
tag that is not this commit's ship tag: a concurrent release that claimed the version would
otherwise leave these app changes without a release, silently.

**`app-version.json` advertises only a version whose F-Droid APK is published.** When
`fdroid-publish` has uploaded the APK and verified that `dist.how2vote.au` serves it, it sets a
`fdroid-apk/v<version>` success status on the release commit, pointing at its own run, then
dispatches `deploy.yml` on `main`; it adds `statuses: write` and `actions: write` for this. Every
production deploy (push, scheduled or dispatched) advertises the newest trusted release tag whose
record holds: a ship tag whose latest `fdroid-apk/<tag>` status (the combined status, so a later
failure revokes it) is success and points at an `android-release.yml` run dispatched on `main`
whose publish job verified the served APK. Skip tags are never looked up. A skipped release never
gets the record and a store release whose F-Droid publish failed is never advertised, so the
endpoint moves when the APK exists and never before. The record is never inferred from the dist
URL: the zone caches `/app/*` 404s, and a probe before the upload would break `fdroid-publish`'s
own verification.

Legacy releases are lightweight tags and count as published and shipped: every lightweight tag
until the first annotated release tag exists, then only those whose commit is an ancestor of the
oldest annotated release tag's commit (v1.4.5 and anything merged before this mechanism). A
lightweight tag created later, by hand, in the GitHub UI or by `gh release create`, is neither the
diff base nor advertised.

Only the endpoint depends on the records. If the statuses or runs cannot be read, or no record is
found within the newest 20 ship tags, the deploy keeps the version the live `app-version.json`
already names (it named a published APK when it was deployed), and publishes a null payload with a
warning if that cannot be read either. The deploy fails only if the git tags themselves cannot be
read.

Limits worth knowing:

- A store release that was dispatched but **failed** still counts as shipped for the diff: its tag
  says `ship`. A docs-only merge after it leaves Play and the App Store behind until a release ships
  or the failed run is re-dispatched. F-Droid is unaffected: without the record it stays at the
  last published release.
- The next app-affecting merge ships changes a release skipped; to ship them sooner, merge a
  follow-up carrying `[ship-apps]`.
- Two races are accepted: a scheduled deploy that read the tags before a record landed can briefly
  put the endpoint back one release, and the redeploy `fdroid-publish` dispatches can briefly roll
  the site back to an older `main` if a newer push deploy finished first. The next deploy corrects
  both.
- iOS and Android share one decision.

### Per-PR builds

`mobile-ci.yml`'s build tier compiles both shells and attaches the binaries: an Android APK that installs on a
device, and an iOS Simulator `.app`. A single `scope` job decides, and both platforms share that
decision.

The build tier runs for every change that would ship the apps on merge (the same
`store-release-scope.mjs` classification, so a pull request never ships a binary its CI did not
build), plus the workflow itself and the store/F-Droid check scripts. To build a branch the filter
does not select, use `workflow_dispatch`.

There is no workflow-level `paths:` filter by design. A required check filtered out that way never
reports, leaving the pull request blocked indefinitely; a job skipped by a job-level `if:` reports
`skipped`, which branch protection accepts as passing.

PR previews are **debug-signed, always** — fork and internal pull requests alike. No signing key or
Play credential is reachable from a `pull_request`-triggered job: the store keys are the one thing a
pull request must not be able to spend, and a PR that edits the Fastfile or the gradle build would
otherwise select the very job that runs it. Sharing to Play internal app sharing is a separate
`workflow_dispatch` job behind the `play-share` environment, so it takes both write access and a
reviewer's approval. Release *signing config* is therefore exercised at release time and by that
dispatch, not on every PR.

A debug-signed preview cannot install over a store build, or over a previous release-signed preview:
Android will not replace a package in place under a changed signature, so uninstall first.

Artifacts are deleted when the pull request closes. A Play internal-app-sharing upload cannot be:
that API has `uploadapk` and `uploadbundle` and no delete, so each share is a permanent link.
While the app has no published release, that upload returns `UploadException: NOT_PUBLISHED` and
does nothing.

iOS device installs need TestFlight — an unsigned Simulator build cannot run on a physical iPhone,
and there is no per-PR Apple path. The release-time route is `ios-release.yml`, gated on
`APPLE_TEAM_ID`.

Versioning: both stores share one source (`.github/actions/resolve-store-version`). Marketing
version = the web release tag; the build number (iOS `CFBundleVersion` / Android `versionCode`) is
a deterministic encoding of that semver — `MAJOR×10^8 + MINOR×10^6 + PATCH×10^3` plus three run
digits (major 1–9, minor ≤ 99, patch ≤ 999; anything else fails closed, and major ≤ 9 keeps every
release code below the `1e9 + run` range of the per-PR preview builds) — so the same release yields the same high digits on both
stores (the run digits come from each workflow's own counter, which only competes within its store)
and re-runs get a higher number. F-Droid uses the same encoding with the run digits pinned to `000`
(`scripts/generate-app-version.mjs`, parity-guarded by `check-fdroid-ready.mjs`): its build of a
release always ranks below the stores' builds of that release, which never matters (channels
have different signing keys and never upgrade each other) but keeps every published versionCode
decodable back to the same release tag. Releases up to 1.4.6 were published under the legacy
`(MAJOR×10000 + MINOR×100 + PATCH)×1000` encoding; every current code is at least 10^8 and so ranks
above all of them, and the decoder and recipe check still accept the legacy codes for those
releases.

The release tag itself comes from `scripts/next-version.mjs`: the highest bump over every commit
since the latest release tag reachable from the pushed commit (`!`/`BREAKING CHANGE` in a subject →
major, `feat` → minor, anything else → patch), so a `feat` whose own release was skipped still
moves the minor on the next one. A commit that is already tagged keeps its version, so a re-run
mints no new tag and dispatches no store release. PR previews take their version from the PR title
alone.

## Rollout policy (both stores)

The web app is CI/CD straight to production because **rollback is instant** — a bad deploy is one
redeploy away and every user gets the fix on next load. Native has no equivalent: there is no OTA
path by design (guideline 2.5.2, and the offline guarantee depends on it), so a bad build sits on
devices until a *new* build clears review. Same cadence, different blast radius.

A staged rollout is therefore **not a slower release process — it is the substitute for the
rollback native doesn't have.** Play can halt a rollout mid-flight, which caps exposure at whatever
percentage was reached. That is the only "undo" available.

| Situation | Behaviour | How |
| --- | --- | --- |
| Default | staged / phased; halt or pause on a crash-rate regression | nothing to do |
| Data correction inside the campaign period (writ issued → polls close) | everyone at once | add `[full-rollout]` to the release notes **before** approving the environment gate |

The exception exists because near a poll the risk inverts: leaving most users on wrong ballot data
is a worse failure than a shell regression, and it is exactly what the stale-data notice above
exists to warn about.

**One marker governs both stores** so they cannot drift. It is read from the release notes at
promote/submit time (`gh release view`), not from the trigger payload — which was captured before
the reviewer saw it — and deliberately **not** from a repo variable, since a full-rollout flag left
switched on is the precise failure these gates exist to prevent. The choice stays visible in the
release notes afterwards.

The **policy** is identical; the **mechanisms are not**, and the difference matters:

| | Google Play | App Store |
| --- | --- | --- |
| Control | `rollout:` fraction you choose (default `0.1`) | `phased_release: true` — Apple's **fixed** 7-day schedule (1/2/5/10/20/50/100%), no percentage to pick |
| Who it affects | all users on that track | **only automatic updates for existing users** — new installs and manual updates always get the latest immediately |
| Emergency stop | halt rollout | pause phased release |
| Full-rollout marker sets | `PLAY_ROLLOUT=1` | `IOS_PHASED_RELEASE=false` |

Because Apple's phased release doesn't cover new installs, it is a weaker safety net than Play's.

**Hold-for-human is on for both** and is separate from rollout — it controls *when* an approved
build goes live at all:

- **Play: keep Managed publishing enabled** in the console. Approved releases wait for an explicit
  publish click.
- **App Store: `automatic_release: false`** is set in the `submit_review` lane. While an approved
  version waits to be released, newer builds are deferred (see "Overlapping store releases").

In both cases a green workflow means **"approved and waiting", not "live"**.

## Store listing copy

Generated — never hand-typed into a store console — by `scripts/generate-store-metadata.mjs`
from `apps/web/src/lib/operator.json`, so the electoral authorisation line ("Authorised by …")
and the operating entity stay single-sourced exactly as `check-operator-identity.mjs` enforces
in-app. CI (`--check` + `scripts/generate-store-metadata.test.mjs`) validates store length
limits, the no-registration-mark brand rule, and that both descriptions carry the authorisation
line.

**Screenshots** are automated: `pnpm --filter @how2vote/web screenshots`
(`playwright.screenshots.config.ts`) drives the real flow — home, ballot, a question, the card,
insights — at each store's required device size (iPhone 6.7" 1290×2796, iPad 12.9" 2048×2732,
Android phone 1080×1920, Android 10" 1600×2560) and writes PNGs into the committed pack under
`apps/mobile/fastlane/screenshots/`. The Play feature graphic (1024×500) comes from the brand mark
(`generate-native-assets.mjs`). On release, iOS `deliver` reads `fastlane/screenshots/ios` (a
locale-only symlink view — deliver rejects the android-* directory names) and Android
`supply` uploads them (`generate-store-metadata.mjs` stages them into supply's images dir) — so a
release is click-paste. Regenerate with `pnpm --filter @how2vote/web screenshots` whenever the UI changes,
and review them before submission.

## Channel freshness badges

Because the dataset ships inside each binary with no OTA path, an older store build is older
*candidate data*, not just an older UI — so the README carries a badge per channel showing the
live version and the age of the data inside it.

`scripts/generate-store-badges.mjs` (run from `prebuild:assets`, so every deploy refreshes them)
emits shields.io **endpoint** payloads to `apps/web/static/badges/{web,ios,android,fdroid}.json`,
served from `how2vote.au`. Deliberately **no third-party badge service** — shields renders our own
JSON, and the files could be served as SVG from the apex later to remove shields too.

**No manifest is needed for the version → dataVersion mapping.** Every release is a git tag and
`data/dist/elections.json` is committed, so the dataset a released build shipped is recoverable
with `git show v<version>:data/dist/elections.json`. The script validates the version as strict
semver before it ever reaches a git ref (same fail-closed rule as `resolve-store-version`) and
passes it via `execFile` argv, never a shell string.

Live versions arrive by environment so the script stays pure, offline and unit-tested — the store
APIs are queried by whatever sets them, never by the generator:

| Variable | Badge | Source once live |
| --- | --- | --- |
| `IOS_LIVE_VERSION` | `ios.json` | iTunes lookup (`resolve-ios-live-version.mjs`) |
| `ANDROID_LIVE_VERSION` | `android.json` | Play Developer API |
| `FDROID_LIVE_VERSION` | `fdroid.json` | F-Droid index (`resolve-fdroid-live-version.mjs`) |

An unset channel emits a grey **"not published"** badge, so the README renders identically before
and after a store goes live and nothing needs editing on launch day. The `web` badge always
reflects the working tree.

**Colour reports a date, never a verdict.** Green = ships the current dataset; yellow = trails;
grey = unpublished. There is deliberately no red and no word "stale": a native build legitimately
trails web while a release sits in review, so a scary badge would fire on every normal release.
Judging actual staleness is `apps/web/src/lib/staleness.ts`'s job, and it does it against the
electoral timetable rather than against web.

A scheduled job that queries each store for its live version and sets these variables is not yet
implemented; until it is, the native badges read "not published".

## Age declarations — don't market to under-18s, don't exclude them

The app has an age-first gate and an under-18 explore mode (ADR 0011, ADR 0012). The content is
safe civic information, so **no additional blocking consent screen is warranted** — blocking a
15-year-old from reading how preferential voting works has a real access cost and no
corresponding benefit, and it would mean adding a consent surface to justify a store declaration
rather than to protect anyone.

The store levers are separate from the in-app control, which stays the actual enforcement point:

- **Play — Target audience.** Stay out of the **Families Policy**, which triggers on including
  under-13 age bands. Select 13+ and up, and re-verify the current banding rules at submission
  time — this is a compliance declaration, not a click-through.
- **Apple — age rating.** You cannot choose an audience, only answer the content questionnaire,
  which will land the app low (4+/9+). That is correct and is not a marketing statement — do not
  manually inflate it to look conservative. The **Kids Category is opt-in: don't opt in.**
- Neither store's declaration is as strong as the in-app gate. Don't weaken the gate to match a
  declaration.

## Other distribution channels (assessed)

| Channel | Verdict |
| --- | --- |
| **Samsung Galaxy Store** | Worth doing after Play — real AU Android share, accepts the same AAB, modest incremental listing. |
| **Direct APK via GitHub Releases** (Obtainium-installable) | Nearly free given a signed artifact already exists; strong open-source signal. |
| **F-Droid** | **Shipping with iOS/Android** — the former blockers (Turnstile, Formspree) are gone since ADR 0017; see the F-Droid section below. |
| **Accrescent** | Small but security-focused and philosophically aligned. Optional. |
| **Huawei AppGallery** | Skip — negligible AU share post-2020. |
| **Amazon Appstore** | Skip — discontinued for Android, August 2025. |
| **iOS alternatives** | None exist in Australia. EU DMA marketplaces (AltStore, Epic) are EU-only, so the App Store is the sole iOS channel. |

### F-Droid — shipping with iOS/Android

F-Droid requires 100% FOSS including dependencies, no Google Play Services/Firebase, and a build
**from source on F-Droid's buildserver** from a git tag via a recipe merged into `fdroiddata` —
no store account, no CI, no secrets. Both blockers this section used to list are **resolved**
since the self-hosted challenge landed (ADR 0017): the Turnstile bridge and the Formspree client
no longer exist — anti-abuse is a first-party proof-of-work challenge served by our own
`/api/challenge`, and the contact form posts first-party. Every network endpoint the app can
reach is AGPL code in this repo and self-hostable (`docs/self-hosting.md`), which is the argument
to make in the packaging MR for carrying **no NonFreeNet anti-feature**.

How the pieces fit — each fact is enforced on every PR (guards named on the right):

| Fact | Where | Guard |
| --- | --- | --- |
| Recipe (reference copy) | `docs/fdroid/au.how2vote.app.yml`; the authoritative copy lives in fdroiddata once the MR merges — mirror review changes back | recipe invariants in `check-fdroid-ready.mjs` |
| Version discovery | `checkupdates` polls `https://how2vote.au/app-version.json`, published on every production deploy by `scripts/generate-app-version.mjs` and naming the newest release whose F-Droid APK is published (see "Which releases ship the apps"); `AutoUpdateMode: Version v%v` maps the pair to the release tag | payload unit tests |
| One fetch only | `UpdateCheckData`'s versionName URL is the **`.` sentinel** (re-use the fetched page), never the URL again: fdroidserver builds its second request with **no headers**, and that one is answered **403** at the edge. Both values are in the one JSON document | `check-fdroid-ready.mjs` asserts field 3 is `.` |
| Version injection | the gradle files carry **no literal version**: the recipe's prebuild writes the build block's `$$VERCODE$$`/`$$VERSION$$` into `gradle.properties` — the same project properties store CI passes as `-P` flags | the `fdroid` job builds with **no** `-P` flags and asserts the APK's pair |
| versionCode | the shared `resolve-store-version` encoding with the three `run_number` digits pinned to `000` (that action uses `run_number`, never `run_attempt`); the Play build of the same release always ranks higher, which is irrelevant across channels (different signing keys) but keeps the numbers cross-referenceable | formula-parity check |
| Listing text | the fastlane **android** metadata tree is **committed** — F-Droid imports it from the repo at the tag; a gitignored tree would publish an empty listing | drift-checked against the generator |
| Listing images | `ANDROID_IMAGE_MAP` in `generate-store-metadata.mjs` maps the screenshot pack to fastlane image names for both Android consumers: committed **symlinks** for F-Droid, staged **copies** for Play | `--check` asserts each link is a symlink and resolves; `android-release.yml` fails closed on an unstaged pack |
| Listing **path** | F-Droid globs `<repo root>/fastlane/metadata/android/<locale>/`, `<repo root>/metadata/<locale>/` and `src/<flavour>/fastlane/…` — all relative to the **checkout root, never the build subdir** — so the committed listing lives at **`fastlane/metadata/android/en-US/`**. Locale is `en-US`, F-Droid's fallback locale | presence in `check-fdroid-ready.mjs`, bytes in `generate-store-metadata.mjs --check` |
| Reproducible builds | `Binaries:` names the signed APK `android-release.yml` publishes on every release that ships the apps, and `AllowedAPKSigningKeys:` pins its signer digest. F-Droid builds the tag, compares, and on a match publishes **our** binary under **our** signature instead of re-signing with its own key | `check-fdroid-ready.mjs` requires the pair together and `%v` in the URL; the release build asserts the APK's signer equals the pinned digest before the asset is attached |
| Signing key | a **dedicated** key, never the Play upload key. Play upload keys are rotatable by design; an F-Droid signing identity is permanent, so coupling them would make rotating the upload key orphan every F-Droid install. Play App Signing means the Play binary is signed by a Google-held key regardless, so the two channels never share an identity | — |
| Artifact host | `dist.how2vote.au` — Cloudflare R2 bucket `how2vote-dist`, read-only over that domain, keyed `app/<channel>/how2vote-<channel>-<version>.apk`. Not a GitHub release asset: releases here are **immutable**, and `deploy.yml` publishes before dispatching the store workflows, so an asset can never be attached afterwards. The channel appears in both the path and the filename because a saved APK loses its URL and its signature decides whether it installs | `fdroid-publish` refuses to replace a published object, then re-downloads over the public domain and compares SHA-256 with the signed file |
| Signing flags | `apksigner --alignment-preserved` is **required**: apksigner re-aligns the zip by default, shifting nearly every entry, and any digest computed over the original layout then fails — F-Droid could never match its own build. v1 (JAR) signing is disabled: minSdk 24 supports v2 everywhere, and v1 adds ~200 KB of per-entry manifests | `fdroid-apk` runs `apksigcopier compare` against the unsigned build, which is the check F-Droid's verification performs |
| Signature classes | the F-Droid APK is signed by our dedicated F-Droid key; Play distributes split APKs signed by Google's escrowed key. Same package name, different signers — neither can update over the other, so the two are separate install classes and a user must uninstall before switching | — |
| Permissions | one declaration of ours, `INTERNET`, used only for the user-initiated first-party form and opt-in research POSTs, outbound links, and the `https://localhost` WebView origin Capacitor requires it for; the merged APK also carries the app-local signature permission `androidx.core` injects. Full register under "Declared permissions" above | the `fdroid` job asserts the **merged** set from the built APK with `aapt2 dump permissions` |
| Scanner | no Google service reference anywhere in the gradle files (the Capacitor template's dormant push-services block is removed) | scanner simulation in `check-fdroid-ready.mjs` |
| Buildserver toolchain | Node, Go and cargo come from **Debian forky** (`apt-get install -t forky nodejs npm golang-go cargo`): the buildserver runs trixie, which ships Node 20, while `.nvmrc` pins 24. Never an installer script piped into a shell — the buildserver cannot verify what that would run, and the version would be whatever upstream serves that day. pnpm is not packaged by Debian, so it is installed at `package.json`'s exact `packageManager` version | `check-fdroid-ready.mjs` maps each Debian suite to the Node major it ships and asserts `.nvmrc`'s, asserts the pnpm pin equals `packageManager`, and rejects a pipe into a shell. No CI job runs the `sudo` phase, so these are static-only |
| Source-built bundlers | the tree the buildserver installs carries **no prebuilt binary at all**: every native in the app closure is an npm optionalDependency (esbuild/rollup platform packages, sharp's libvips, fsevents), so the recipe's init installs with `--no-optional` and none of them ever exist there — and wrangler/workerd live in `tools/deploy`, outside the `@how2vote/web...` + `@how2vote/mobile` closures the recipe installs (the root importer installs regardless of `--filter`, so root devDeps must never carry binaries). The only native code the build executes — esbuild and rollup's parser binding — is compiled from the `esbuild`/`rollup` **srclibs** at the exact versions the lockfile resolves (`go build`; `cargo build --offline` after a `--locked` fetch), wired in via `ESBUILD_BINARY_PATH` and the `rollup@<version>` instance path. The store shells build with `build:app`, which runs no asset generator (the icons it needs are committed — `pnpm icons:generate`) | `check-fdroid-ready.mjs` holds each srclib pin equal to the lockfile's resolution, holds the rollup instance path and generated package.json to the pin, requires `--no-optional` on init, and fails on any `scanignore:`; `fdroid-recipe-build.mjs` materialises the srclibs fdroidserver-style, so the `fdroid` CI job and the release pipeline execute these commands for real |
| Phase commands | one command per list item in `sudo`/`prebuild`/`build` — never a `;`/`&&` chain, never a `cd`. fdroidserver joins each list with `; ` into one `bash -e -x`, so a chained item hides which command failed, and a `cd` leaks into every command after it. The workspace root is reached with `pnpm -C ../../../..` | `check-fdroid-ready.mjs` scans every block's phase items; the harness test asserts the same over the real recipe |
| Channel | F-Droid ships the **`fdroid`** channel (`PUBLIC_DIST_CHANNEL=fdroid`), a fourth value in `apps/web/src/lib/channel.ts`. An F-Droid install cannot be updated through Play (different signing keys), so the in-app update remedy resolves to `f-droid.org/packages/<appId>` rather than `market://`. Nothing else differs from the `android` build | `check-store-channel.mjs`; the `fdroid` job builds this channel, and the per-channel behaviour specs cover the branch |

The `fdroid` job in `mobile-ci.yml` **executes the recipe's own commands** rather than restating
them: `scripts/fdroid-recipe-build.mjs` reads each phase out of `docs/fdroid/au.how2vote.app.yml`
and runs it the way fdroidserver does — one `bash -e -u -o pipefail -x -c`, commands joined with
`; `, working directory the recipe's `subdir` — then builds `assembleRelease` and asserts the
version pair inside the APK. The commands must come from the recipe, never be restated in the
workflow: a restatement can pass while the buildserver fails.

**Publication steps (one-time):**

1. Fork `gitlab.com/fdroid/fdroiddata` (the fork must be **public** with an **unprotected** branch —
   F-Droid fast-forward-merges and cannot rebase a protected branch); copy the reference recipe to
   `metadata/au.how2vote.app.yml`. The build block's `commit` is the **full hash** of the release
   tag (fdroiddata prefers it — a tag can be moved after review); `CurrentVersion*` must be the pair
   published at `https://how2vote.au/app-version.json` — keep the reference copy in step with each
   release so the two never disagree.
2. **The pinned tag must be one whose tree contains `fastlane/metadata/android/en-US/`** — F-Droid
   reads the listing out of the checkout at that exact ref. Check with
   `git ls-tree -r --name-only <tag> | grep '^fastlane/'`.
3. Dry-run with fdroidserver before opening the MR: `fdroid readmeta`, `fdroid lint
   au.how2vote.app`, `fdroid rewritemeta au.how2vote.app` (fdroiddata CI enforces canonical field
   order, and the submitted copy carries **no comments**), `fdroid checkupdates au.how2vote.app`,
   then `fdroid build -v -l au.how2vote.app`.
4. Open the MR and respond to packager review; mirror any conventions the packagers require
   (e.g. a srclib-based Node install instead of a distro package in `sudo:`) back into
   `docs/fdroid/`, and make CI assert them so they cannot regress.
   **Keep the recipe at the current release, including mid-review**: fdroiddata CI runs
   `fdroid checkupdates` and fails on any diff. Append a block and bump `CurrentVersion*` in both
   the MR and this mirror per release; never rewrite the reviewed block.
5. After merge the app appears in the index within a build cycle or two. Because `Binaries:` and
   `AllowedAPKSigningKeys:` are both set, F-Droid builds the tag, compares against our published
   APK, and on a match publishes **our** binary under **our** signature; it falls back to signing
   its own build with the F-Droid key only if the comparison fails.
6. The README badge follows automatically: `scripts/resolve-fdroid-live-version.mjs` reads
   `https://f-droid.org/api/v1/packages/au.how2vote.app` in `deploy.yml`'s `live-versions` job and
   hands `FDROID_LIVE_VERSION` to the build. The index is public, so the job holds no credential.

**Screenshots** ship as **symlinks**. F-Droid reads images from `<locale>/images/**` beside the
listing text, so three committed links point into the screenshot pack:

| Link (committed, mode `120000`) | → target |
| --- | --- |
| `fastlane/metadata/android/en-US/images/phoneScreenshots` | `apps/mobile/fastlane/screenshots/android-phone` |
| `fastlane/metadata/android/en-US/images/tenInchScreenshots` | `apps/mobile/fastlane/screenshots/android-tablet` |
| `fastlane/metadata/android/en-US/images/featureGraphic.png` | `apps/mobile/fastlane/screenshots/android-feature/feature.png` |

`ANDROID_IMAGE_MAP` in `generate-store-metadata.mjs` defines these and Play's staged copies, so one
`pnpm --filter @how2vote/web screenshots` run feeds all three channels and git holds one copy of the
pack. fdroidserver resolves the links: its scanner skips symlinks and `_strip_and_copy_image` follows
them. `--check` asserts each link *is* a symlink and resolves — a checkout without symlink support
materialises them as text files, and a moved pack leaves them dangling. The app icon is not linked;
fdroidserver extracts it from the built APK.

## GitHub configuration (all secrets/vars, per current patterns)

### Credential environments

Every store and signing credential is an **environment** secret, held by the one environment whose
jobs need it. A repository secret is readable by every job in every same-repo run, so anyone who can
push a branch could dispatch an edited workflow and spend it; an environment secret is released only
to a job that names the environment, and the environment's **deployment branch policy** decides which
refs may do that. The environments below that hold release credentials admit **`main` only**, so a
branch can edit a workflow but can no longer run it with a store credential in scope. Neither the
policy nor the reviewers live in the workflow file, which is the point: a branch can edit an `if:`
condition, but it cannot edit repository settings.

The split also narrows each credential to the job that needs it. Ungated jobs (build, TestFlight,
Play internal track) hold credentials that cannot publish to production; the production-release
credentials sit only in the reviewer-gated environments. Two limits remain. The Play upload account
needs **Manage store presence**, because the internal lane uploads the listing, so it can change
listing text and images; with Managed publishing on, such a change is held until someone publishes
it in Play Console, and that is the backstop. On iOS the protection depends on the `ios-build` key
being a **Developer**-role key, which can cloud-sign and upload to TestFlight but cannot submit for
review; if it has to be an Admin key (see the checklist's fallback), the `app-store` reviewer no
longer contains the submit capability and the iOS gate rests only on the workflow YAML coming from
`main`. The secret **names** are the same in each
environment, so a workflow reads `PLAY_SERVICE_ACCOUNT_JSON` whichever account it is given.

| Secret | Workflow → job | Environment | Branch policy | Holds |
| --- | --- | --- | --- | --- |
| `ANDROID_UPLOAD_KEYSTORE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | android-release → build | `android-build` | `main` | Play upload key (JKS, **base64-encoded**). Play re-signs with the app signing key |
| `PLAY_SERVICE_ACCOUNT_JSON` | android-release → build; deploy → live-versions; play-permission → probe | `android-build` | `main` | **upload** service account (raw JSON): testing tracks + store presence, **no** production release |
| `PLAY_SERVICE_ACCOUNT_JSON` | android-release → promote | `play-store` | `main` + required reviewers | **production** service account: release to production |
| `FDROID_KEYSTORE`, `FDROID_KEYSTORE_PASSWORD`, `FDROID_KEY_ALIAS`, `FDROID_KEY_PASSWORD` | android-release → fdroid-apk | `fdroid-signing` | `main` | F-Droid release keystore (PKCS12, **base64-encoded**; NOT the Play upload key). Key password = store password (PKCS12 permits only one). Locked forever |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | android-release → fdroid-publish | `fdroid-publish` | `main` | R2 token scoped to the `how2vote-dist` bucket (**not** account-wide); the account id only forms the S3 endpoint |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_API_KEY_P8` | ios-release → build; ios-submission-catch-up → check (read-only) | `ios-build` | `main` | **Developer**-role App Store Connect key with **Access to Cloud Managed Distribution Certificates** (`.p8` **base64-encoded**): cloud-signed export, certificate guard, TestFlight upload; cannot submit for review |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_API_KEY_P8` | ios-submit → submit (called by ios-release and ios-submission-catch-up) | `app-store` | `main` + required reviewers | **App Manager** key: metadata + review submission; the only key in CI that can submit |
| `PLAY_SHARE_SERVICE_ACCOUNT_JSON`, `PLAY_SHARE_KEYSTORE`, `PLAY_SHARE_KEYSTORE_PASSWORD`, `PLAY_SHARE_KEY_ALIAS`, `PLAY_SHARE_KEY_PASSWORD` | mobile-ci → android-share | `play-share` | none: dispatched from PR branches; required reviewers | internal-app-sharing account (no release rights) + throwaway keystore |
| `CLOUDFLARE_API_TOKEN` | deploy → deploy, cleanup | repository | n/a | Pages deploy token; PR previews need it, so it cannot be limited to `main` |
| `CF_D1_API_TOKEN` | deploy → deploy | repository | n/a | D1 migrations (non-PR runs) and `data:stats`, which also runs on same-repo PRs; its job builds PR previews |
| `TVFY_API_KEY` | data-refresh → refresh | repository | n/a | read-only third-party data API key; manual dispatch |

| Kind | Name | Used by | Notes |
| --- | --- | --- | --- |
| var | `APPLE_TEAM_ID` | ios-release | Developer team id (not sensitive); unset skips iOS entirely |
| environment | `android-build` | android-release build, deploy live-versions, play-permission probe | branch policy `main`; no reviewer |
| environment | `fdroid-signing` | android-release fdroid-apk | branch policy `main`; no reviewer |
| environment | `fdroid-publish` | android-release fdroid-publish | branch policy `main`; no reviewer |
| environment | `ios-build` | ios-release build, ios-submission-catch-up check | branch policy `main`; no reviewer |
| environment | `play-store` | android-release promote | branch policy `main`; required reviewers = compliance signatories |
| environment | `app-store` | ios-submit submit (from ios-release and ios-submission-catch-up) | branch policy `main`; required reviewers = compliance signatories |
| environment | `play-share` | mobile-ci android-share | required reviewers; no branch policy |

F-Droid signing and publishing are separate environments for the same reason they are separate
jobs: the signing key and the bucket credential are never held together.

The build-type jobs (`android-build`, `fdroid-*`, `ios-build`) declare
`environment: { name: …, deployment: false }`. GitHub then applies the environment's secrets and
protection rules without recording a deployment for every build: required reviewers and wait timers
still apply, and GitHub documents environment branch policies as the way to restrict which branches
can use an environment's secrets this way. (`deployment: false` is incompatible with custom
deployment protection rules, which none of these environments use.) The promote and submit jobs keep
ordinary deployments, so the `play-store`/`app-store` history records each approval.

`deploy.yml`'s live-versions job reads Play with the upload account and runs on `main` only. The daily
`play-permission.yml` probe checks the upload account, the one that applies the internal-track and
listing edits; the production account cannot be probed on a schedule, because `play-store`'s
reviewer would hold every run, and its grant is exercised by each promotion.
`scripts/check-release-credentials.mjs` (the release-credential gate in `ci.yml`) fails a change that
reads one of these credentials from a job outside its listed environment, uses the secrets context
without a literal name (`toJSON(secrets)`, `secrets[expr]`, `secrets: inherit`), or puts a
`main`-only environment in a job whose `if:` does not exclude pull requests.

### Owner migration checklist

The required state: every credential in the table above is an environment secret of the
environment listed for it; `android-build`, `fdroid-signing`, `fdroid-publish`, `ios-build`,
`play-store` and `app-store` each admit `main` only; and none of those credentials exists as a
repository secret. An environment secret overrides a repository secret of the same name, so the
steps below can be taken while repository copies still exist without any run losing a credential.
Take them in order; the repository copies go last, after verification.

1. **Play upload account.** Create a second GCP service account and a JSON key
   (`gcloud iam service-accounts create how2vote-play-upload`, then
   `gcloud iam service-accounts keys create upload.json --iam-account how2vote-play-upload@<project>.iam.gserviceaccount.com`).
   If the organisation enforces `iam.disableServiceAccountKeyCreation`, key creation is refused: an
   organisation policy administrator must override that constraint for this project only, the key
   is created, and enforcement is restored. There is no keyless alternative, because fastlane supply
   and `scripts/play-auth.mjs` both authenticate with a JSON key.
   Play Console → **Users and permissions** → **Invite new users** → its email → **App permissions** →
   `au.how2vote.app` → grant **Release apps to testing tracks** and **Manage store presence** (the
   internal lane uploads the listing and screenshots, and the permission probe stages a listing
   change). Do **not** grant **Release to production, exclude devices, and use Play App Signing**, and
   grant no account-level permissions. **Apply**, then **Save**. Keep Managed publishing on: it holds
   any listing change this account makes until it is published in the console.
   **Required before the key goes into GitHub:**
   `PLAY_SERVICE_ACCOUNT_FILE=upload.json node scripts/check-play-permission.mjs` exits 0, and
   `PLAY_SERVICE_ACCOUNT_FILE=upload.json node scripts/resolve-play-live-version.mjs` prints the live
   version. If either fails, fix the grants first; the account that can release to production is
   the `play-store` account and must not be substituted here.
2. **App Store Connect keys.** Users and Access → Integrations → App Store Connect API → Team Keys:
   - a **Developer** key with **Access to Cloud Managed Distribution Certificates** enabled, for
     `ios-build`;
   - an **App Manager** key, for `app-store`.
   Download each `.p8` (offered once) and note its key id; the issuer id is shared. No Admin key is
   used by CI.
3. **Environments.** Settings → Environments. `android-build`, `fdroid-signing`, `fdroid-publish`
   and `ios-build`: **Deployment branches and tags** → **Selected branches and tags** → branch rule
   `main` (not "Protected branches only", which admits every protected branch); no required
   reviewers. `play-store` and `app-store`: the same branch rule, keeping their required reviewers.
   Create each environment in this state before a workflow first names it, because GitHub
   auto-creates a missing environment with no policy; if one was auto-created, edit it to this state.
   A `main`-only policy refuses any run whose ref is not `main`, so the store workflows must be
   dispatched on `main` with `tag` set, as `deploy.yml` does.
4. **Environment secrets** (values copied exactly from the existing repository secrets unless
   stated):
   - `android-build`: `ANDROID_UPLOAD_KEYSTORE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
     `ANDROID_KEY_PASSWORD`, and `PLAY_SERVICE_ACCOUNT_JSON` = the **upload** account's `upload.json`.
   - `fdroid-signing`: `FDROID_KEYSTORE`, `FDROID_KEYSTORE_PASSWORD`, `FDROID_KEY_ALIAS`,
     `FDROID_KEY_PASSWORD` (the locked key; copy, never regenerate).
   - `fdroid-publish`: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
   - `ios-build`: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_API_KEY_P8` = the **Developer** key
     (`base64 -i AuthKey_<id>.p8`).
   - `play-store`: `PLAY_SERVICE_ACCOUNT_JSON` = the **production** account (the existing repository
     value).
   - `app-store`: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_API_KEY_P8` = the **App Manager** key.
5. Leave `play-share` as it is: reviewer, its five environment secrets, no branch policy.
6. **Verify, while the repository copies still exist:**
   - `gh workflow run android-release.yml --ref main -f dry_run=true` goes green.
   - `gh workflow run ios-release.yml --ref main -f dry_run=true` goes green under the Developer key:
     the build lane's certificate guard (which lists certificates) and the cloud-signed export both
     pass.
   - The next release's iOS build job uploads to TestFlight under the Developer key, and its
     Android build job uploads to the internal track under the upload account.
   - The same dry-run dispatch from any other branch fails at the environment.
   - `gh workflow run play-permission.yml` goes green (it probes the upload account).
   - `gh workflow run ios-submission-catch-up.yml --ref main` (no `tag`) shows whether the
     `ios-build` key can read review state: its "Ask App Store Connect" job runs read-only calls,
     and a warning that the key "cannot read the review state" means every catch-up while a
     submission is owed will ask the `app-store` reviewer. It submits nothing unless a release is
     owed a submission, and then only after that reviewer approves.
   - The next `deploy.yml` run on `main` shows a green live-versions job and a populated Android badge.
   **Fallback:** if the Developer key cannot list certificates or cannot export, put an Admin key in
   `ios-build` instead. That key can also submit for review, so the `app-store` reviewer then
   guards only the workflow's own submit step, and the iOS gate rests on the workflow YAML coming
   from `main` alone.
7. **Delete the repository-level copies** (Settings → Secrets and variables → Actions → Repository
   secrets): `ANDROID_UPLOAD_KEYSTORE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
   `ANDROID_KEY_PASSWORD`, `PLAY_SERVICE_ACCOUNT_JSON`, `FDROID_KEYSTORE`, `FDROID_KEYSTORE_PASSWORD`,
   `FDROID_KEY_ALIAS`, `FDROID_KEY_PASSWORD`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_API_KEY_P8`. Keep
   `CLOUDFLARE_API_TOKEN`, `CF_D1_API_TOKEN` and `TVFY_API_KEY`. Once no environment holds the
   former Admin key, revoke it in App Store Connect unless something outside CI uses it.
8. **Re-verify:** `gh secret list` shows only those three; `gh secret list --env <name>` shows each
   environment's set from step 4. Repeat the step 6 dry runs, then watch the next release: build
   uploads to the internal track and TestFlight, fdroid-apk and fdroid-publish go green, promote
   waits for a reviewer and promotes with the production account, and submit waits for a reviewer
   and submits with the App Manager key.

Play internal app sharing accepts an artifact signed with **any** key and re-signs it with an Internal
App Sharing key it generates ([Play Console Help](https://support.google.com/googleplay/android-developer/answer/9844679)),
which is why the share path uses a throwaway keystore and the upload key never enters a job a branch
can dispatch.


## Store account provisioning (one-time)

**Apple** (organization enrollment, D-U-N-S):
1. App Store Connect → create app `au.how2vote.app` (name: how2vote, primary locale en-AU).
2. Users & Access → Integrations → generate two API keys: a **Developer** key with **Access to
   Cloud Managed Distribution Certificates** for the build (the export step signs with cloud-managed
   distribution certificates, and the build's certificate guard lists certificates), stored in the
   `ios-build` environment; and an **App Manager** key for review submission, stored in the
   `app-store` environment. Record each key id + the issuer id; base64 each `.p8` into that
   environment's `ASC_API_KEY_P8`. See the owner checklist for the Admin fallback.
3. Set the age rating questionnaire and the App Privacy declaration in the console. Declare the
   optional research contribution accurately: it is **opt-in**, **not linked to the user**, **not
   used for tracking**, and collected for **Analytics/Research** only (same posture as the web
   site's privacy policy). Everything else is not collected. Upload screenshots.
4. First submission includes App Review contact details (console) — the generated review notes
   explain provenance, neutrality and the authorisation requirement.

**Google** (organization account — same D-U-N-S — US$25 one-time):
1. Play Console → create app `au.how2vote.app`; complete the Data safety form to match: optional,
   opt-in, anonymous (not linked to identity), not for tracking — data type "Other" / political or
   demographic survey answers, purpose Analytics. Add content rating and target-audience.
2. Create a GCP service account + JSON key (`gcloud iam service-accounts create` … `keys create`,
   with `androidpublisher.googleapis.com` enabled on the project), invite its email in Play
   Console → **Users and permissions** with release + store-presence permissions, and store the
   key JSON as `PLAY_SERVICE_ACCOUNT_JSON`. Two accounts are used: an **upload** account (testing
   tracks + store presence) in the `android-build` environment, and a **production** account
   (release to production) in `play-store`; see "Owner migration checklist".

   The permissions that matter are **App permissions → the app → "Release to testing tracks"** and
   **"Manage store presence"**, applied *and* saved on the user page. Google enforces publish rights
   only when an edit is **applied**, so an under-permissioned account can open an edit, upload a
   bundle, rewrite the listing and set a track, and is refused at the final commit with a bare
   `The caller does not have permission`. Everything before that point succeeds, which makes the
   error look like a build or fastlane fault when it is neither. An edit containing **no** changes
   commits fine regardless of rights, so a no-op probe reports a false pass and is not a valid check.

   Two guards close that gap: `scripts/check-play-permission.mjs` (stages a real listing diff in a
   throwaway edit, calls `:validate`, which applies nothing, and discards it) runs as a fail-closed
   step in `android-release.yml` **before** the build, and daily via
   `.github/workflows/play-permission.yml` so a permission edit that revokes publishing shows up as a
   red run rather than at release time. Editing permissions on the Play user page can replace grants
   rather than add to them, so publishing rights can lapse without any deliberate revocation.

   If the service account cannot yet publish, dispatch `android-release.yml` with `dry_run=true`
   and upload the resulting `.aab` artifact through the console by hand (console uploads use the
   signed-in user's rights, not the service account's).
3. Generate the upload keystore locally (`keytool -genkeypair -v -keystore upload.jks
   -keyalg RSA -keysize 4096 -validity 9125 -alias upload`), enrol in Play App Signing, base64
   the JKS into `ANDROID_UPLOAD_KEYSTORE`. The first AAB can be uploaded through the API too —
   but only as a **draft** release (see Bootstrap traps below).

**Both**: create the `app-store` / `play-store` environments with required reviewers, and every
credential environment with a `main`-only branch policy (see "Credential environments"). There is no
third-party captcha allowlist to configure for the shells: the anti-abuse challenge is self-hosted
(ADR 0017) and the shell origins are already covered by the research CORS allowlist
(`src/lib/research/cors.ts`).

**F-Droid**: nothing in this section applies — no account, no console, no secrets, no signing
material of ours. The one-time work is the fdroiddata MR (see the F-Droid section's publication
steps).

**Bootstrap traps (one-time):**
- The Android `internal` lane uses `release_status: "completed"`, which Play rejects while the app
  is still a *draft*. The API itself accepts uploads to a draft app when the release status is
  `"draft"`. So the one-time bootstrap is: upload the first AAB with a **draft** release (API or
  console), complete the console declarations, then roll that release out in the console — after
  which the app is out of draft and the automated `completed` pipeline works.
- `apps/mobile/Gemfile.lock` is **committed** (covers the ruby + linux + darwin platforms, fastlane
  2.240.1, bundler pinned via `apps/mobile/.ruby-version` = 4.0.6). The `fastlane toolchain (Ruby 4)`
  mobile-ci job installs it **frozen** and drift-guards its platform coverage on every PR, also
  proving the whole fastlane tree loads on Ruby 4. Regenerate with `cd apps/mobile && bundle lock
  --add-platform x86_64-linux arm64-darwin x86_64-darwin` when the Gemfile changes.

**On-device coverage boundary:** `e2e/native-browser.spec.ts` runs against the channel builds
with a plugin **double** on `window.Capacitor`, and proves everything on our side of the bridge:
the cue in the accessible name, that a plain click calls `Browser.open` with the right URL
without also navigating or opening a tab, and that a modified click bypasses the plugin. What the
double cannot prove is the native half — that the sheet actually presents, that its Done button
returns to the app with state intact, and that the toolbar shows the real URL. Those need a
device check, once per platform, alongside the splash/status-bar theming.

## Register updates before any store submission

Tracked by the `storeDistribution` determination in `data/legal/product-boundary.json`
(evidence id `EV-STORE-DISTRIBUTION-2026`) and the 2026-07-24 entry in
`docs/legal/legal-review.json`:

1. Vendor rows for Apple and Google in `apps/web/src/lib/privacy/third-party-services.json`
   (infrastructure, distribution-only, no runtime contact — same shape as the GitHub entry),
   with contract-review dates once the developer agreements are accepted (control-29).
2. Expenditure records for the Apple annual fee and the Play one-time fee in
   `docs/legal/electoral-expenditure.json` + the determination document figures (control-8;
   the vendor↔cost completeness check enforces this as soon as the vendor rows exist).
3. The `EV-IP-ASSIGNMENT` confirmation that granting the AGPL §7 additional permission
   (LICENSE-EXCEPTIONS.md) is within the operator's rights (control-16).
