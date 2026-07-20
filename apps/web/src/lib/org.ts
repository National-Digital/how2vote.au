/**
 * Single source of truth for the operating entity and the legal facts that must stay identical
 * everywhere they appear — the footer, the legal pages, the contact page, structured data and any
 * output that has to carry attribution. Hard-coding these across components is how they drift; every
 * one of them now reads from here.
 *
 * The authoritative record is the machine-readable {@link operator.json} (validated in CI by
 * scripts/check-operator-identity.mjs): identity, addresses, privacy contact and the
 * Privacy Act determination live there so there is exactly one operator record, and a second
 * hard-coded legal entity anywhere in the source fails the build. This module adapts that record
 * into the `ORG`/`AUTHORISATION` shapes the app already consumes, and adds the licence/data-source
 * facts that are not part of operator identity.
 *
 * See docs/adr/0006-legal-compliance-rebuild.md (decisions of record).
 */
// Named imports so the client bundle carries only these public identity fields — the compliance-only
// parts of operator.json (the Privacy Act determination, its legal-basis prose) are never referenced
// here and so are tree-shaken out of the app. The full record is validated in CI from disk by
// scripts/check-operator-identity.mjs, not shipped to the browser.
import {
  legalName,
  tradingName,
  abn,
  acn,
  phone,
  email,
  privacyContactEmail,
  website,
  authorisation,
  country,
  governingLaw,
} from "./operator.json";

/** The operating entity, exactly as it must be named in legal notices and authorisations. */
export const ORG = {
  /** Full legal name, used verbatim wherever the operating entity must be identified in full. */
  legalName,
  /** The trading name used in body copy. */
  tradingName,
  abn,
  /**
   * Australian Company Number of the trustee company named in {@link legalName}. Distinct from
   * {@link abn}, which is the trust's ABN — in a corporate-trustee structure the two are separate
   * numbers, so the ACN is stored explicitly rather than derived from the ABN.
   */
  acn,
  phone,
  email,
  website,
  /** Locality shown in the electoral authorisation and legal notices — town + state, no street. */
  locality: authorisation.locality,
  state: authorisation.state,
  country,
  /** Governing law for the Terms of Use. */
  governingLaw,
} as const;

/** Dedicated privacy contact for the privacy policy and OAIC-style notices. */
export const PRIVACY_CONTACT_EMAIL = privacyContactEmail;

/**
 * Electoral authorisation string (Commonwealth Electoral Act 1918 s 321D) — the entity form:
 * National Digital's legal entity, locality and State (no street address).
 *
 * It identifies National Digital as the authoriser of the material it publishes: the site, the
 * comparison content AND the printed how-to-vote plan template and analysis (National Digital
 * authoriser model — docs/adr/0010). On a printed plan the user's preference numbers are separately
 * identified as the user's own selection; National Digital authorises the material it publishes,
 * which is a measured position, not a settled legal conclusion. (Printing is currently suspended by
 * the signed control plane until an electoral-law specialist signs off the authoriser determination.)
 */
export const AUTHORISATION = `Authorised by ${ORG.legalName}, ${ORG.locality}, ${ORG.state}.`;

/** The two open licences the project publishes under, with their canonical licence URLs. */
export const LICENCES = {
  /** Application source code. */
  app: {
    name: "GNU Affero General Public License v3",
    shortName: "AGPL-3.0",
    url: "https://www.gnu.org/licenses/agpl-3.0.html",
  },
  /** The compiled parliamentary vote dataset. */
  data: {
    name: "Open Database Licence",
    shortName: "ODbL",
    url: "https://opendatacommons.org/licenses/odbl/1-0/",
  },
} as const;

/** Provenance of the parliamentary voting data (ODbL attribution obligation). */
export const DATA_SOURCE = {
  name: "They Vote For You",
  publisher: "OpenAustralia Foundation",
  url: "https://theyvoteforyou.org.au/",
} as const;

/**
 * The eligibility rule how2vote adopts for contributing a research record: 18 or older. This is a
 * research-programme rule the project chooses (and the Privacy Act basis for handling sensitive
 * information from adults), not a claim that the law forbids under-18s from using the tool itself.
 */
export const RESEARCH_MIN_AGE = 18;

/**
 * Official, non-partisan civic-participation resources pointed to from the under-18 explore result
 * (ADR 0012) — constructive ways someone too young to vote can still take part instead of a
 * how-to-vote card they cannot lawfully use. All are official / primary sources and none endorse a
 * party, candidate or position (neutrality — ADR 0006).
 */
export const CIVIC_LINKS = {
  /** AEC enrolment — 16- and 17-year-olds can provisionally enrol so they are ready to vote at 18. */
  enrol: "https://www.aec.gov.au/enrol/",
  /** Parliament of Australia — find and contact the member who represents a federal electorate. */
  findMember: "https://www.aph.gov.au/Senators_and_Members/Members",
  /** They Vote For You — how members and parties have actually voted in Parliament. */
  votingRecord: DATA_SOURCE.url,
} as const;
