# Third-party notices

Assets in this repository that are **not** covered by the project's own licences
([AGPL-3.0-or-later](LICENSE) for the source code, [ODbL v1.0](LICENSE-DATA.md) for the compiled
vote dataset). Each is redistributed under its own terms, which are narrower than the AGPL: they
permit use of the artwork for its stated purpose only, and none of them may be sublicensed onward
under the AGPL. A fork that removes the corresponding feature should remove the asset with it.

## Store badge artwork

Both badges are the official, unmodified marketing artwork each store requires for a link to a
listing. They are trademarked assets licensed only for that use, under the owner's brand
guidelines — they are **not** part of the AGPL-licensed work and are not conveyed under it.

| Asset | Owner | Terms |
| --- | --- | --- |
| `apps/web/static/badges/app-store.svg` — "Download on the App Store" badge | Apple Inc. | [Apple Identity Guidelines for Channel Affiliates and Apple-Related Products](https://developer.apple.com/app-store/marketing/guidelines/). App Store and the App Store logo are trademarks of Apple Inc. |
| `apps/web/static/badges/google-play.png` — "Get it on Google Play" badge | Google LLC | [Google Play Badge Guidelines](https://play.google.com/intl/en_us/badges/). Google Play and the Google Play logo are trademarks of Google LLC. |
| `apps/web/static/badges/f-droid.svg` — "Get it on F-Droid" badge | The F-Droid project | [CC-BY-SA-3.0](https://creativecommons.org/licenses/by-sa/3.0/), per [F-Droid's badge documentation](https://f-droid.org/docs/Badges/). F-Droid asks that the badge point only at an app in the main F-Droid repository. |

The F-Droid badge is CC-BY-SA-3.0: freely redistributable with attribution, with any adaptation
carrying the same licence. It is used unmodified here, and the credit given is the licence rather
than a mark attribution.

Conditions the Apple and Google guidelines impose, and which this repository observes: the artwork is
used unmodified and at or above its minimum size, it links only to the corresponding store listing,
and it is never used to imply endorsement or a partnership. `StoreBadges.svelte` renders each badge
only once a listing URL for that store exists, and carries the required attribution beside it.

## Typeface

| Asset | Owner | Terms |
| --- | --- | --- |
| `apps/web/static/fonts/newsreader.woff2`, `newsreader-italic.woff2` | The Newsreader Project Authors | SIL Open Font License 1.1 — full text at [`apps/web/static/fonts/OFL.txt`](apps/web/static/fonts/OFL.txt) |

## This project's own marks

The **How2Vote** and **National Digital** names, logos and brand assets are not licensed for reuse
by the AGPL grant. See [`BRAND.md`](BRAND.md).
