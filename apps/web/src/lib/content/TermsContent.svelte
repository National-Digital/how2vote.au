<script lang="ts">
  import ExternalLink from "$lib/components/ExternalLink.svelte";
  import DocLink from "$lib/components/DocLink.svelte";
  import { DATA_SOURCE, LICENCES, ORG } from "$lib/org";
  import { MAP_LICENCE_NAME, MAP_LICENCE_URL } from "$lib/mapLicence";
  import { TERMS_VERSION } from "$lib/terms/terms";

  // The operator's published Terms of Use, matched to the implemented design. Entity facts are
  // driven by $lib/org so they stay identical across every legal surface. This is the operator's
  // published terms, not legal advice; the review posture is recorded in docs/adr/0006.
  //
  // The version is surfaced verbatim below and bound to the acceptance store, the terms hash registry
  // (docs/legal/terms-registry.json) and scripts/check-terms.mjs, so the wording cannot change without
  // a version bump + a new registry entry (the copy lint fails closed otherwise).
  const lastUpdated = "16 July 2026";
</script>

<p class="updated">Last updated: {lastUpdated} · Terms version {TERMS_VERSION}</p>
<p class="updated">
  You actively accept these terms (this version) before you build a voting plan, create a share
  link, print a plan, or contribute to research. Your acceptance is recorded only on your device.
</p>

<h2>1. About these terms</h2>
<p>
  These Terms of Use govern your access to and use of How2Vote, including the website, comparison
  results and any voting plan you create using the service (the Service).
</p>
<p>
  The Service is operated by {ORG.legalName} (ABN {ORG.abn}, ACN {ORG.acn}) (National Digital, we,
  us or our).
</p>
<p>
  Browsing the Service is subject to these terms. Before you take any action with real consequences
  — building a voting plan, creating a share link, printing a plan, or contributing to research —
  you are asked to actively accept the current version of these terms. If you do not accept them, do
  not take those actions.
</p>

<h2>Who may use the Service</h2>
<p>
  The Service is for use by individual voters (natural persons) only. It is not for use by an
  organisation, and it is not for use by a foreign campaigner or foreign government. When you accept
  these terms you confirm you are using How2Vote as an individual, not on behalf of an organisation
  and not as a foreign campaigner.
</p>

<h2>2. What the Service does</h2>
<p>
  The Service is a free, independent information tool. It compares answers you choose to provide
  with selected historical parliamentary voting records using the methodology published on the
  <DocLink href="/methodology">How it works</DocLink> page.
</p>
<p>
  The Service may show an alignment percentage or other comparison information for parties,
  parliamentary members or candidates. These results are based on historical public records and
  methodological choices. They are not predictions of future conduct and are not a complete
  assessment of any party, candidate or policy.
</p>

<h2>3. You create your own voting plan</h2>
<p>The Service does not choose, pre-fill, rank or recommend a preference order for you.</p>
<p>
  Candidate and group names are presented in the official ballot order for the relevant election.
  Match information may be displayed beside them, but a higher match does not mean that you should
  give that candidate or group a higher preference.
</p>
<p>
  You must actively choose each preference in your voting plan. The order is yours alone. National
  Digital does not adopt, endorse or recommend the order you select.
</p>
<p>
  A voting plan is not a ballot paper and does not cast a vote. You must complete the official
  ballot paper yourself.
</p>
<p>
  Only the browser session that created a comparison can build or print a voting plan from it. A
  comparison opened from a shared link is read-only (see “Sharing a comparison” below): a voting
  plan cannot be built from a link you receive — build your own comparison first.
</p>
<p>
  When you print a voting plan you enter authorisation particulars for the printed material
  (Commonwealth Electoral Act 1918 s 321D). The authorisation particulars you type are held only on
  your device, in memory, for that print. They are never saved and never transmitted to National
  Digital or anyone else. National Digital does not authorise your voting plan; you do — the plan is
  your own material, containing the preference order you selected.
</p>

<h2>4. Federal elections only</h2>
<p>
  Unless we clearly state otherwise, the Service is designed only for Australian federal elections
  conducted by the Australian Electoral Commission (AEC).
</p>
<p>
  Voting systems and authorisation rules differ between federal, state, territory and local
  government elections. Do not use the Service for another election unless the Service expressly
  identifies that election as supported.
</p>

<h2>5. Check official information before voting</h2>
<p>You are responsible for checking:</p>
<ul>
  <li>that you have selected the correct electorate and state or territory;</li>
  <li>the candidates, groups and ballot order shown on your actual ballot paper;</li>
  <li>the current AEC instructions for completing a formal vote; and</li>
  <li>every preference you copy from your voting plan.</li>
</ul>
<p>
  Candidate nominations, affiliations, ballot order, voting instructions and other election
  information may change or may be corrected after information is first published.
</p>
<p>
  The Service may provide mechanical prompts about missing, repeated or incomplete preference
  numbers. Any prompt is a convenience only and is not a legal determination that your ballot will
  be formal.
</p>
<p>
  If the Service conflicts with your ballot paper or current AEC information, follow the ballot
  paper and AEC information.
</p>

<h2>6. No AEC, party or candidate endorsement</h2>
<p>
  The Service is not produced, approved, registered or endorsed by the AEC, any political party or
  any candidate.
</p>
<p>
  The Service is not an official voting service, electoral enrolment service or ballot paper.
  National Digital does not submit, receive or count votes.
</p>

<h2>7. Methodology and editorial judgement</h2>
<p>
  We use a published and versioned methodology, but the Service is not free from judgement. Choices
  about which issues to include, how to describe a parliamentary division, how to group records, how
  to treat parties and independents, and how to calculate alignment involve editorial and
  methodological decisions.
</p>
<p>
  We aim to apply the stated methodology consistently and without favouring a party or candidate. We
  do not warrant that the methodology is neutral, complete or the only reasonable way to interpret
  the public record.
</p>
<p>
  A party-level historical record may be shown beside a current candidate who has no personal
  parliamentary voting record. That information describes the historical record attributed to the
  party, not the candidate's personal views, promises or future conduct.
</p>

<h2>8. Sources and accuracy</h2>
<p>
  Parliamentary voting information is sourced principally from
  <ExternalLink href={DATA_SOURCE.url}>{DATA_SOURCE.name}</ExternalLink>, a project of the {DATA_SOURCE.publisher}.
  Candidate and election information may be sourced from the AEC and other identified public
  sources.
</p>
<p>We use reasonable care to maintain the Service, but errors can arise from:</p>
<ul>
  <li>source data, delayed updates or later corrections;</li>
  <li>our selection, interpretation, mapping, calculations or software;</li>
  <li>candidate, party, electorate or ballot-order changes;</li>
  <li>incomplete records, absences, paired votes or procedural divisions;</li>
  <li>attributing a party's historical record to a current candidate; or</li>
  <li>the way information is displayed, downloaded, printed, shared or copied.</li>
</ul>
<p>
  To the maximum extent permitted by law, we do not warrant that the Service, any source data,
  alignment result or voting plan is complete, current, accurate, available, secure or free from
  error.
</p>
<p>
  Please report suspected errors promptly through the <a href="/contact">contact page</a>. We may
  correct, suspend, withdraw or replace any content or output without notice.
</p>

<h2>9. Information only, not advice</h2>
<p>
  The Service provides general information only. It is not legal, electoral, political, financial or
  other professional advice.
</p>
<p>
  Your political views, voting decisions and preferences are personal decisions. You should consider
  the matters that are important to you and make your own enquiries.
</p>

<h2>10. Sharing a comparison</h2>
<p>
  You can share a <strong>comparison</strong> (your answers and the resulting alignment information),
  not a voting plan. Sharing works entirely through the link itself: your answers are encoded in the link,
  and nothing about the comparison is stored on a server.
</p>
<p>
  Because a shared link carries its data in the link itself and nothing is stored on a server, a
  shared link does not expire and cannot be revoked or deactivated. Once you have sent a link, you
  cannot recall it — anyone who has the link can open the comparison encoded in it, so only share a
  link with people you choose.
</p>
<p>
  A shared link is read-only. A voting plan cannot be built from a link you receive — build your own
  comparison first. The preference order you author when building a plan is never placed in a link.
</p>
<p>When you share or copy a comparison, you must not:</p>
<ul>
  <li>remove or obscure the statement that any preference order was selected by the user;</li>
  <li>remove or obscure any accuracy notice, data date or methodology version;</li>
  <li>
    alter the output in a way that falsely attributes a recommendation or statement to National
    Digital;
  </li>
  <li>represent the output as official AEC, party or candidate material; or</li>
  <li>use it unlawfully or to mislead another person about how to cast a valid vote.</li>
</ul>

<h2>11. Optional research participation</h2>
<p>
  After you have your comparison result, the Service may invite you to contribute to research.
  Taking part in research is entirely optional and is never a condition of using the Service — you
  can build, save, print and share a voting plan without contributing anything.
</p>
<p>
  If you opt in, your device works out your closest party match and a stance for each proposition
  and sends only those results, your state or territory, the election compared, the collection
  period, the data and app versions, and any optional survey answers. Every survey question,
  including sensitive ones, has a “prefer not to say” option. Your individual answers and weights
  never leave your device, and no direct identifiers are collected.
</p>
<p>
  Contributions are stored only as additions to aggregate group counts, not as individual records.
  Once a contribution has been merged into the aggregate counts it cannot be identified, withdrawn
  or deleted, because no per-person record exists. Because the aggregate counts are not personal
  information and may be retained indefinitely subject to the disclosure controls in our
  <a href="/privacy">Privacy policy</a>, the protections that apply are those disclosure controls
  rather than a right to withdraw. The research is conducted in line with recognised ethics and
  statistical-practice standards, as described in the Privacy policy.
</p>

<h2>12. Acceptable use</h2>
<p>You must not:</p>
<ul>
  <li>interfere with, disrupt, overload, probe or circumvent the Service or its security;</li>
  <li>use automated means in a way that materially impairs the Service;</li>
  <li>submit spam, malicious content or knowingly false error reports;</li>
  <li>use the Service to impersonate another person or organisation;</li>
  <li>remove required attribution, licensing or authorisation information;</li>
  <li>redistribute an altered output as though it were generated by the Service; or</li>
  <li>
    use the Service in breach of electoral, privacy, intellectual property or other applicable law.
  </li>
</ul>
<p>
  We may restrict or block use that we reasonably consider unsafe, unlawful or harmful to the
  Service or others.
</p>

<h2>13. Intellectual property and open licences</h2>
<p>
  Unless otherwise stated, National Digital owns or licenses the Service's design, original content
  and software.
</p>
<p>
  The application source code is made available under the
  <ExternalLink href={LICENCES.app.url}>{LICENCES.app.name}</ExternalLink>. The compiled
  parliamentary vote dataset is made available under the
  <ExternalLink href={LICENCES.data.url}>{LICENCES.data.name}</ExternalLink>
  and includes attribution to They Vote For You and the OpenAustralia Foundation.
</p>
<p>
  The federal electorate boundary maps are a separate matter with a separate licence. They are
  derived from Australian Electoral Commission data under the
  <ExternalLink href={MAP_LICENCE_URL}>{MAP_LICENCE_NAME}</ExternalLink>, which is different from
  the vote-data licence above and carries its own conditions. The prescribed licence notice is shown
  next to every map.
</p>
<p>
  Those licences apply to the materials they cover. They do not grant a right to use National
  Digital's trade marks, imply endorsement, remove electoral authorisation requirements, or publish
  misleading modified outputs.
</p>

<h2>14. Third-party services and links</h2>
<p>
  The Service relies on third-party data, infrastructure and services. Third-party sites and
  services are governed by their own terms and privacy practices.
</p>
<p>
  We are not responsible for third-party content, availability, security or acts and omissions,
  except to the extent liability cannot lawfully be excluded.
</p>

<h2>15. Availability and changes</h2>
<p>
  We may change, suspend or discontinue any part of the Service at any time, including during an
  election period, for maintenance, security, legal compliance, data correction or operational
  reasons.
</p>
<p>
  We do not promise that the Service or a saved or shared plan will remain available. Keep any
  information you need and check it again before voting.
</p>

<h2>16. Consumer rights</h2>
<p>
  Nothing in these terms excludes, restricts or modifies any consumer guarantee, right, remedy or
  liability that cannot lawfully be excluded, restricted or modified, including under the Australian
  Consumer Law.
</p>
<p>
  Where a non-excludable guarantee applies and the law permits us to limit the remedy, our liability
  is limited, at our option, to supplying the relevant service again or paying the cost of having
  the service supplied again.
</p>

<h2>17. Exclusion and limitation of liability</h2>
<p>Subject to section 16 and to the maximum extent permitted by law:</p>
<ul>
  <li>the Service is supplied on an as-is and as-available basis;</li>
  <li>we exclude all implied warranties, representations and conditions;</li>
  <li>
    we are not liable for indirect, consequential, special or economic loss, loss of opportunity,
    loss of data, reputational loss, or any electoral or political outcome;
  </li>
  <li>
    we are not liable because a ballot is informal, a preference is copied incorrectly, information
    is incomplete or inaccurate, or the Service is unavailable; and
  </li>
  <li>
    our total aggregate liability arising out of or connected with the Service is limited to the
    greater of AUD 100 and the amount you paid us for the Service in the 12 months before the event
    giving rise to liability.
  </li>
</ul>
<p>
  These limits apply regardless of the legal basis of the claim, including contract, negligence,
  statute or otherwise.
</p>

<h2>18. Responsibility for unlawful misuse</h2>
<p>
  You are responsible for loss reasonably suffered by us as a direct result of your deliberate
  unlawful use of the Service, your deliberate removal of a required authorisation, or your knowing
  publication of a materially altered output as though it were an unaltered National Digital output.
</p>
<p>
  This section does not require a consumer to compensate us for loss caused by our own negligence,
  breach or unlawful conduct.
</p>

<h2>19. Changes to these terms</h2>
<p>
  We may update these terms as the Service, law or election requirements change. The current version
  will be published on this page with its effective date.
</p>
<p>
  Material changes will apply prospectively. Your continued use after the effective date of an
  update constitutes acceptance of the updated terms.
</p>

<h2>20. Governing law</h2>
<p>
  These terms are governed by the laws of {ORG.governingLaw}. The courts of {ORG.state} and courts entitled
  to hear appeals from them have non-exclusive jurisdiction.
</p>

<h2>21. Contact</h2>
<p>
  Questions, complaints and error reports can be sent to
  <a href="mailto:{ORG.email}">{ORG.email}</a> or submitted through the
  <a href="/contact">contact page</a>.
</p>
<p>
  {ORG.tradingName}<br />ABN {ORG.abn}<br />ACN {ORG.acn}<br />{ORG.locality}, {ORG.state}, {ORG.country}
</p>

<style>
  .updated {
    font-size: 13px;
    color: var(--ink3);
    margin-top: -4px;
  }
</style>
