<script lang="ts">
  import ExternalLink from "$lib/components/ExternalLink.svelte";
  import ClearMyData from "$lib/components/ClearMyData.svelte";
  import { ORG, RESEARCH_MIN_AGE } from "$lib/org";
  import { categories, providerTable, services } from "$lib/privacy/registry";
  import privacyClaims from "$lib/privacy/privacy-claims.generated.json";

  // Research privacy commitments are GENERATED from the tested-controls register: each is
  // resolved by scripts/generate-privacy-claims.mjs to its EFFECTIVE wording — a claim's substantiated
  // wording appears only while it is backed and current (approval unexpired, its CI tests passing, no
  // expired evidence), otherwise it fails closed to a hedged fallback. So a commitment can never be
  // shown here unless it is currently substantiated. Edit docs/privacy/claims.json and run
  // `pnpm privacy:generate`; CI fails if this projection drifts from the register.
  const commitments = privacyClaims.claims;

  // Reconciled with the built system and the decisions of record (docs/adr/0006, docs/adr/0008):
  //   • Research storage is aggregate-only (ADR-0008): the client derives the match/stances on
  //     device and the server holds cohort-keyed counters, never a per-person row. §5 below
  //     describes exactly that; never claim "anonymous" — construction language.
  //   • No deletion code / per-record token — no individual record exists at all, so we cannot
  //     locate or delete one on request.
  //   • Research aggregates retained INDEFINITELY (docs/adr/0008, docs/privacy/retention.md): the
  //     store holds only genuinely aggregated group counts (§5 carve-out), so the APP 11.2
  //     destroy-when-no-longer-needed limb does not bite. Post-election review + end-of-purpose
  //     deletion remain; there is no fixed maximum.
  // The third-party inventory is rendered straight from the registry that also drives the CSP and
  // the consent UI, so the three can never disagree about what this site loads.
  const lastUpdated = "29 July 2026";
  const categoryLabel = new Map(categories.map((c) => [c.id, c.label]));
  const inventory = [...services].sort((a, b) =>
    a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
  );
</script>

<p class="updated">Last updated: {lastUpdated}</p>

<h2>1. About this policy</h2>
<p>
  This Privacy Policy explains how How2Vote handles information when you use the website, compare
  your views with historical parliamentary records, create a voting plan, choose to contribute to
  research, or contact us.
</p>
<p>
  How2Vote is operated by {ORG.legalName} (ABN {ORG.abn}, ACN {ORG.acn}) (National Digital, we, us
  or our).
</p>
<p>
  We apply privacy-by-design principles and handle personal information in accordance with the
  Privacy Act 1988 (Cth) and the Australian Privacy Principles to the extent they apply to us.
</p>

<h2>2. The privacy design in summary</h2>
<p>The core comparison and voting-plan functions are designed to run in your browser:</p>
<ul>
  <li>there is no account or login;</li>
  <li>your quiz answers and preference order are processed on your device;</li>
  <li>your current progress and saved plans are stored in your browser unless you clear them;</li>
  <li>we do not automatically upload your answers or preference order for research;</li>
  <li>research contribution is a separate, optional opt-in; and</li>
  <li>usage analytics is aggregate and cookieless, and sets nothing on your device.</li>
</ul>
<p>
  Some technical information must still be processed when your device connects to the website, and
  information is sent when you choose to contribute to research or submit a form. Those activities
  are described below.
</p>

<h2>3. Information stored on your device</h2>
<p>
  The Service may store the following in your browser's local storage or similar device storage:
</p>
<ul>
  <li>your selected electorate and state or territory;</li>
  <li>your quiz answers and issue weights;</li>
  <li>the preference order you choose;</li>
  <li>saved voting plans;</li>
  <li>the data and methodology version used;</li>
  <li>your selected election and display preferences, such as light or dark theme;</li>
  <li>your acknowledgement of the Terms of Use; and</li>
  <li>your privacy choices.</li>
</ul>
<p>
  This information stays on your device unless you choose an action that sends it, such as research
  contribution or a form submission. You can remove it using the Service's start-again and delete
  controls, or by clearing site data in your browser.
</p>
<p>
  One qualification for the app versions, so that "stays on your device" is not read as more than it
  is. We never transmit this information, but on iOS the operating system's own device backup may
  include an app's stored data, so if you have iCloud Backup or an encrypted computer backup
  switched on, a copy can be held by that backup service under your own account and restored to a
  replacement device. That is a function of the platform's backup, not of the Service, and we cannot
  read it. The Android app switches this off: it declares itself out of Android's automatic cloud
  backup. Using the delete control in section 11 clears the data on the device; it does not reach
  into a backup already taken, which you manage through your device or backup provider's settings.
</p>

<h2>4. Shared links and plans</h2>
<p>
  A share link may encode your answers or results in the part of the address after the
  <code>#</code> symbol, known as the URL <strong>fragment</strong>. The Service is designed so that
  its servers and analytics do not receive or record that fragment; the recipient's browser uses it
  to reconstruct the shared result on their device.
</p>
<p>
  Anyone who receives the link can see the information encoded in it. A link may also be exposed
  through screenshots, copied messages, browser synchronisation, browser extensions or the actions
  of a recipient. Only share with people you choose.
</p>
<p>
  A share link <strong>does not expire and cannot be recalled or deactivated</strong>. Because the
  answers live inside the link rather than on our servers, there is nothing for us to switch off:
  once you send a link, it keeps working for anyone who has it, and clearing your own device does
  not affect a copy someone else already holds. You are shown this before you copy a link.
</p>

<h2>5. Optional research contribution</h2>
<h3>Our research privacy commitments</h3>
<p>
  Each commitment below is backed by an automated test in our source code, and is shown here only
  while that test is passing and the commitment is current; the detail follows in this section.
</p>
<ul>
  {#each commitments as commitment (commitment.id)}
    <li>{commitment.wording}</li>
  {/each}
</ul>

<h3>No automatic research upload</h3>
<p>
  We do not send a research record merely because you complete the quiz or create a voting plan.
  After your result is available, you may be invited to contribute a research record. Participation
  is optional, is not required to use the Service and does not change your result or voting plan.
</p>
<p>Before a record is sent, you must actively select a separate consent control confirming that:</p>
<ul>
  <li>you are at least {RESEARCH_MIN_AGE} years old;</li>
  <li>you have read the short collection notice and this policy; and</li>
  <li>
    you consent to the specified device-derived results and optional survey information being
    collected for the described research purposes.
  </li>
</ul>
<p>The consent control is off by default.</p>

<h3>What is collected if you opt in</h3>
<p>
  Your device does the analysis before anything is sent: it works out your closest party match and
  reduces each proposition you answered to agree, neutral or disagree. Your individual quiz answers
  and the weights you selected <strong>never leave your device</strong>. A contribution then
  contains only:
</p>
<ul>
  <li>the closest party match calculated on your device;</li>
  <li>whether you agreed, were neutral or disagreed with each proposition you answered;</li>
  <li>your state or territory, but <strong>not</strong> your electorate;</li>
  <li>
    the election being compared, together with that election's public AEC timetable dates, which the
    server uses to classify the period in which you contributed;
  </li>
  <li>
    the version of the consent notice you agreed to, which is kept only as an aggregate count of how
    many contributors accepted each version, never against your other answers;
  </li>
  <li>
    the dataset and app versions, which are sent so the server can check your contribution against
    the current research wave but are <strong>not</strong> kept in the dataset; and
  </li>
  <li>optional survey answers you choose to provide.</li>
</ul>
<p>
  Everything received is stored <strong>only as additions to aggregate counts</strong> — running group
  tallies such as “one more contributor in this age group whose closest match was this party”. No individual
  research record is created or stored, and counts that pair a result with a sensitive survey answer are
  kept at national level only, never by state.
</p>
<p>
  The optional survey may ask about age range, gender, education, employment, union membership,
  household circumstances, income range, country of birth, language, Aboriginal or Torres Strait
  Islander origin, religion, sexual orientation, political identification, previous vote and
  intended vote. Some of these categories may be <strong>sensitive information</strong> under Australian
  privacy law, including political opinions or associations, union membership, racial or ethnic origin,
  religious beliefs and sexual orientation. Every survey question is optional and includes a prefer-not-to-say
  option.
</p>

<h3>What is never collected</h3>
<p>A contribution is designed not to contain your:</p>
<ul>
  <li>individual quiz answers or importance weights (analysed on your device only);</li>
  <li>name, email address or phone number;</li>
  <li>street address;</li>
  <li>precise date of birth;</li>
  <li>IP address;</li>
  <li>advertising identifier;</li>
  <li>cookie identifier;</li>
  <li>device fingerprint;</li>
  <li>electorate (kept only as the separate running count below); or</li>
  <li>selected preference order.</li>
</ul>
<p>
  Your IP address and other technical data may nevertheless be processed briefly by hosting, network
  and security providers to transmit and protect the request. We configure the research system so
  that those technical details are not copied into the research dataset.
</p>

<h3>How electorate is handled separately</h3>
<p>
  So that we can describe the geographic spread of contributions without holding your electorate
  near any result, electorate is kept only as a <strong>running count</strong> — a tally of how many contributions
  come from each electorate, with no results, survey answers, dates or anything else attached — sent by
  your browser as its own separate request that is not joined to your contribution in our storage. No
  count ever pairs an electorate with a result or a survey answer. (Because two requests from the same
  device travel the same network path, we describe this as separated by design rather than as an absolute
  guarantee of unlinkability.)
</p>

<h3>Research purposes</h3>
<p>We use contributed records to:</p>
<ul>
  <li>
    study how participants' stated views compare with selected historical parliamentary voting
    records;
  </li>
  <li>examine aggregate patterns across sufficiently large groups;</li>
  <li>test and improve the methodology and data quality;</li>
  <li>detect errors and unusual data patterns; and</li>
  <li>publish aggregate research, explanations or dashboards.</li>
</ul>
<p>
  We do not use research records to target political advertising, build individual voter profiles,
  contact participants, determine eligibility for a service, or make decisions about an individual.
</p>

<h3>Aggregate-only storage and residual risk</h3>
<p>
  The research dataset is <strong>aggregate-only by construction</strong>: it holds group counts,
  not individual records, and the set of counts it may hold is fixed in advance by a published
  analysis plan. We do not collect a name, email address or account identifier with a contribution.
  However, no de-identification technique can eliminate every possible re-identification risk: while
  contributions are being gathered a group count can be small, and a very small count in a rare
  category could say something about a person known to have contributed, particularly if combined
  with information held elsewhere.
</p>
<p>
  We reduce that risk by keeping any count that pairs a result with a sensitive survey answer at
  national level only, restricting access to the counters themselves, separating research data from
  operational logs, limiting retention and publishing only aggregated results that meet disclosure
  thresholds. We do not attempt to re-identify participants and contractually prohibit service
  providers and authorised researchers from attempting to do so.
</p>

<h3>Deletion of a contribution</h3>
<p>
  Because we do not issue or retain a record identifier linked to you, we will generally be unable
  to locate a particular contribution for access, correction or deletion. A contribution is stored
  only as additions to group tallies and holds <strong
    >no name, contact detail, account, cookie or per-record code</strong
  >, so there is no individual record that could tie a stored count back to you. You control whether
  a contribution is ever made at all through the opt-in described above; nothing is sent unless you
  actively consent.
</p>

<h3>Research retention and publication</h3>
<p>
  Research contributions are stored only as additions to aggregate group counts — there is no
  individual record. Because those counts are genuinely aggregated statistics that do not relate to
  an identifiable individual, we may retain them <strong>indefinitely</strong> to support long-run repeated
  cross-sectional analysis, comparison across federal election datasets and collection periods, methodological
  validation and historical research. Participants are not identified or linked between elections, so
  this supports repeated cross-sectional and cross-election comparison rather than following the same
  individuals over time.
</p>
<p>
  We still review the aggregates after each federal election and delete any that are no longer
  reasonably required for a research purpose. Retention is not limited by a fixed maximum period,
  because the group counts we hold are not personal information; the protections that matter for
  those counts are the disclosure controls below, not a deletion clock.
</p>
<p>Public research results:</p>
<ul>
  <li>contain aggregate counts, percentages or summaries only;</li>
  <li>do not publish raw individual records;</li>
  <li>do not publish electorate-level results;</li>
  <li>suppress groups with fewer than 10 records; and</li>
  <li>are reviewed for re-identification risk before release.</li>
</ul>
<p>
  A threshold of 10 is a minimum control, not a guarantee. We may use a higher threshold, combine
  categories or withhold a result where the circumstances create additional risk. You can see the
  current results on the <a href="/insights">insights page</a>.
</p>

<h2>6. Analytics</h2>
<p>
  We measure how the Service is used with <strong>Cloudflare Web Analytics</strong>, which counts
  page views and general usage
  <strong>in aggregate, at our hosting provider's edge network</strong>. It is
  <strong>cookieless</strong>: it sets no cookie, stores nothing on your device and assigns you no
  identifier, so it cannot be used to recognise or track you across visits or across sites. Because
  it collects no personal information and needs no cookie, there is nothing to switch on and no
  consent banner to dismiss.
</p>
<p>Analytics never receives:</p>
<ul>
  <li>quiz answer values;</li>
  <li>issue weights;</li>
  <li>electorate;</li>
  <li>party or candidate alignment results;</li>
  <li>preference order;</li>
  <li>shared-link fragments; or</li>
  <li>research survey answers.</li>
</ul>
<p>
  We do not use analytics for advertising or political targeting. Cloudflare processes this
  aggregate measurement as our hosting provider; see the provider table below and the Cloudflare
  privacy policy for details.
</p>

<h2>7. Contact and feedback forms</h2>
<p>
  If you submit a contact or feedback form, we collect the information you enter, such as your name,
  email address and message. We use it to respond, investigate reports, maintain the Service and
  protect our legal rights. Form messages are normally retained for up to 24 months, unless they are
  needed for a continuing complaint, legal matter, security incident or recordkeeping obligation.
</p>
<p>
  The forms post to our own service, which sends your message to us by email through our hosting
  provider's email service; there is no third-party form provider, and this site stores no copy of
  the message. Spam and abuse prevention is a self-hosted, cookieless check that is non-interactive
  — there is no puzzle to solve — and is computed on your device when you submit one of those forms;
  it loads no third-party CAPTCHA or tracker. You can contact us by email or telephone instead of
  using a form.
</p>

<h2>8. Hosting, security and technical logs</h2>
<p>
  When you visit the Service, hosting, content-delivery and security systems necessarily process
  technical information such as your IP address, request time, browser, requested page and security
  signals. We use this information to deliver the website, prevent abuse, diagnose faults and
  investigate security incidents. We do not intentionally combine routine technical logs with
  research records, and technical-log retention is limited to what is reasonably required for
  security and operations.
</p>

<h2>9. Service providers and overseas processing</h2>
<p>
  We use service providers to host, secure and operate the Service. They process information for us
  under their terms and contractual privacy and security commitments. This list is generated from
  our internal vendor register, so it reflects every service recorded in that register. Current
  providers are:
</p>
<ul>
  {#each providerTable as provider (provider.id)}
    <li>
      <strong>{provider.name}</strong> ({provider.provider}): {provider.summary}
      <span class="prov">Data location: {provider.dataLocation}</span>
    </li>
  {/each}
</ul>
<p>
  Before sending personal information to an overseas recipient, we take reasonable steps appropriate
  to the circumstances to ensure it is handled consistently with applicable Australian privacy
  requirements. We do not sell personal information or research records.
</p>

<p>
  The list below is generated automatically from our internal service registry, so it always
  reflects exactly what this site can load, the category each service falls under, and the cookies
  it may set. Fonts and everything else the app needs are served from our own domain, so they are
  not third parties.
</p>
<div class="services">
  {#each inventory as service (service.id)}
    <article class="service">
      <h3 class="service-name">
        <ExternalLink href={service.privacyPolicyUrl}>
          {service.name}
        </ExternalLink>
        <span class="prov">{service.provider}</span>
      </h3>
      <dl class="fields">
        <div class="field">
          <dt>Purpose</dt>
          <dd>{service.purpose}</dd>
        </div>
        <div class="field">
          <dt>Category</dt>
          <dd>{categoryLabel.get(service.category) ?? service.category}</dd>
        </div>
        <div class="field">
          <dt>Cookies</dt>
          <dd>
            {#if service.cookies.length > 0}
              {service.cookies.map((c) => c.name).join(", ")}
            {:else}
              None
            {/if}
          </dd>
        </div>
        <div class="field">
          <dt>Data location</dt>
          <dd>{service.dataLocation}</dd>
        </div>
      </dl>
    </article>
  {:else}
    <p class="none">
      None — no third-party service loads in your browser. The anti-spam check is self-hosted and
      usage is measured by cookieless edge analytics; infrastructure providers we rely on (hosting,
      source control, data sources) are listed in the providers table below.
    </p>
  {/each}
</div>

<h2>10. Security</h2>
<p>
  We use reasonable technical and organisational measures appropriate to the nature of the
  information, including encrypted network connections, access controls, separation of research and
  operational systems, least-privilege access, dependency and vulnerability management, backups and
  incident-response procedures. No internet service or storage system can be guaranteed completely
  secure. If an eligible data breach occurs, we will assess and notify affected individuals and the
  Office of the Australian Information Commissioner where required by law.
</p>

<h2>11. Access, correction and deletion</h2>
<p>
  You can view, change or delete locally stored answers and plans through the Service, or through
  your browser settings on the web. In the iOS and Android apps there are no browser settings to
  use, so the control below is the way to clear that data: it clears both the app's own storage and
  the durable copy the app keeps so the operating system cannot quietly evict your saved plans. The
  control below clears everything stored on this device in one step — your in-progress quiz, saved
  comparisons, selected election, theme, Terms acknowledgement, privacy choices and age-eligibility
  confirmation, together with the offline copy of the app — and it is also available on the <a
    href="/saved">Saved cards</a
  > page. It clears this device only: it cannot recall a link you have already shared, because a share
  link carries its answers inside the link itself and stays with whoever received it (see section 4).
</p>
<ClearMyData />
<p>
  You may ask us to access or correct personal information we hold about you, or to delete it where
  applicable, by contacting <a href="mailto:{ORG.email}">{ORG.email}</a>. We may need to verify your
  identity before acting. As explained above, a de-identified research record holds nothing that
  could locate it, so we are unable to retrieve or delete an individual research record.
</p>

<h2>12. Complaints</h2>
<p>Privacy questions or complaints can be sent to:</p>
<p>
  National Digital Privacy Contact<br />
  Email: <a href="mailto:{ORG.email}">{ORG.email}</a><br />
  Telephone: {ORG.phone}<br />
  {ORG.locality}, {ORG.state}, {ORG.country}
</p>
<p>
  We aim to acknowledge a privacy complaint within five business days and provide a substantive
  response within 30 days. If you are not satisfied, you may contact the Office of the Australian
  Information Commissioner.
</p>

<h2>13. Children and young people</h2>
<p>
  The core information tool may be viewed by younger people, but we do not knowingly accept research
  contributions from anyone under {RESEARCH_MIN_AGE}. A person must confirm that they are at least
  {RESEARCH_MIN_AGE} before submitting a research record. Because a contributed record is de-identified,
  we may be unable to locate a specific record later; we will delete a record contributed by a person
  under {RESEARCH_MIN_AGE} where we can identify it.
</p>

<h2>14. Changes to this policy</h2>
<p>
  We may update this policy when the Service, providers, research or law changes. The current
  version and effective date will be published on this page. Material changes to research collection
  or use will not be applied to a new research submission without a new or updated collection notice
  and consent.
</p>

<h2>15. Contact</h2>
<p>
  {ORG.tradingName}<br />
  ABN {ORG.abn}<br />
  ACN {ORG.acn}<br />
  Email: <a href="mailto:{ORG.email}">{ORG.email}</a><br />
  Telephone: {ORG.phone}<br />
  {ORG.locality}, {ORG.state}, {ORG.country}
</p>

<style>
  .updated {
    font-size: 13px;
    color: var(--ink3);
    margin-top: -4px;
  }
  .services {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin: 4px 0 14px;
    font-family: var(--ui);
    font-size: 13px;
  }
  .service {
    border: 1px solid var(--line);
    border-top: 2px solid var(--rule);
    border-radius: 6px;
    padding: 12px 14px;
  }
  .service-name {
    margin: 0 0 8px;
    font-size: 14px;
    font-weight: 700;
    line-height: 1.3;
  }
  .service-name :global(a) {
    color: var(--ink);
  }
  .prov {
    display: block;
    margin-top: 1px;
    font-weight: 400;
    color: var(--ink3);
  }
  .fields {
    margin: 0;
  }
  .field {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 4px 12px;
    padding: 6px 0;
    border-top: 1px solid var(--line);
  }
  .field dt {
    color: var(--ink);
    font-weight: 700;
  }
  .field dd {
    margin: 0;
    color: var(--ink2);
    line-height: 1.5;
  }
  @media (max-width: 520px) {
    .field {
      grid-template-columns: 1fr;
      gap: 2px;
    }
  }
</style>
