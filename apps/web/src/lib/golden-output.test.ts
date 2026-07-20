import { describe, expect, it } from "vitest";
import { formatAuthorisation, PREFERENCE_SOURCE_NOTICE } from "./print-auth";
import { AUTHORISATION, DATA_SOURCE, LICENCES, ORG } from "./org";
import { MAP_LICENCE_NAME, MAP_LICENCE_NOTICE, MAP_LICENCE_URL } from "./mapLicence";

/**
 * Golden-file (approved-output) harness for the legally-load-bearing text the app stamps onto
 * printed and rendered matter. A change to any of these wordings — the s321D authorisation stamp,
 * the operator attribution, the open-licence notices or the prescribed AEC map notice — produces a
 * REAL, reviewable diff in a committed golden file, which is exactly the review gate these strings
 * need. Everything is derived from committed sources (operator.json, source-record.json) — no clock,
 * no randomness.
 */

describe("golden: s321D print authorisation stamp", () => {
  it("captures the National Digital authoriser stamp printed on the plan", async () => {
    // National Digital authoriser model (docs/adr/0010): the printed plan
    // carries National Digital's entity authorisation of the material it publishes, then separately
    // states the preference order is the user's own selection. No user-entered particulars appear —
    // the stamp is derived entirely from the committed operator record (org.ts AUTHORISATION).
    const golden = [
      "# s321D print authorisation stamp — formatAuthorisation() (National Digital authoriser model)",
      "# See docs/adr/0010.",
      "",
      "## Stamp printed on the how-to-vote plan",
      formatAuthorisation(),
      "",
      `## Preference-source notice (printed separately): ${PREFERENCE_SOURCE_NOTICE}`,
      "",
      "## Site-wide operator authorisation (org.ts AUTHORISATION — the online form)",
      AUTHORISATION,
      "",
    ].join("\n");
    await expect(golden).toMatchFileSnapshot("./__golden__/authorisation-stamp.txt");
  });
});

describe("golden: attribution and licence notices", () => {
  it("captures the operator attribution, open-licence facts and prescribed AEC map notice", async () => {
    const golden = [
      "# Attribution & licence notices",
      "",
      "## Operating entity (org.ts / operator.json)",
      `legalName:    ${ORG.legalName}`,
      `tradingName:  ${ORG.tradingName}`,
      `abn:          ${ORG.abn}`,
      `acn:          ${ORG.acn}`,
      `locality:     ${ORG.locality}`,
      `state:        ${ORG.state}`,
      `country:      ${ORG.country}`,
      "",
      "## Open licences the project publishes under (org.ts LICENCES)",
      `app:  ${LICENCES.app.name} (${LICENCES.app.shortName}) — ${LICENCES.app.url}`,
      `data: ${LICENCES.data.name} (${LICENCES.data.shortName}) — ${LICENCES.data.url}`,
      "",
      "## Parliamentary voting data source (org.ts DATA_SOURCE — ODbL attribution)",
      `name:      ${DATA_SOURCE.name}`,
      `publisher: ${DATA_SOURCE.publisher}`,
      `url:       ${DATA_SOURCE.url}`,
      "",
      "## AEC boundary-map derivative-product notice (mapLicence.ts — prescribed wording)",
      `licence: ${MAP_LICENCE_NAME}`,
      `url:     ${MAP_LICENCE_URL}`,
      ...MAP_LICENCE_NOTICE.map((p, i) => `\n[${i + 1}] ${p}`),
      "",
    ].join("\n");
    await expect(golden).toMatchFileSnapshot("./__golden__/attribution-notice.txt");
  });
});
