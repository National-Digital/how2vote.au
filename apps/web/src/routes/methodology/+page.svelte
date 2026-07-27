<script lang="ts">
  import ContentPage from "$lib/components/ContentPage.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import StructuredData from "$lib/components/StructuredData.svelte";
  import { HOWTO_STEPS, methodologyHowToGraph } from "$lib/structured-data";
  import { METHODOLOGY_VERSION } from "$lib/provenance";
</script>

<Meta />
<StructuredData node={methodologyHowToGraph()} />

<ContentPage title="How it works">
  <p>
    How2Vote compares your views with what parties have <strong>actually done</strong> in federal parliament
    — the votes their members cast, not what they said in a campaign. The method is a fixed set of arithmetic
    steps, published in full below with nothing withheld: the same answers always produce the same result,
    and every step below is exactly what the scoring engine computes. Which issues to include and how
    to describe a division still involve editorial judgement, so this is one reasonable reading of the
    public record, not the only one.
  </p>

  <!-- The three steps, rendered from the same HOWTO_STEPS the HowTo JSON-LD is built from (they
       cannot drift apart). -->
  <h2>In short</h2>
  <ol>
    {#each HOWTO_STEPS as step (step.name)}
      <li><strong>{step.name}.</strong> {step.text}</li>
    {/each}
  </ol>

  <h2>Where the data comes from</h2>
  <p>
    Every <a href="/glossary#division">division</a> (formal vote) in the House and Senate is
    recorded in <a href="/glossary#hansard">Hansard</a> and published, in a machine-readable form,
    by the OpenAustralia Foundation's
    <a href="https://theyvoteforyou.org.au/" target="_blank" rel="noopener noreferrer"
      >They Vote For You</a
    >. For each issue, They Vote For You gives an <strong>agreement figure from 0 to 100</strong> for
    every member — how often that member voted the way the issue describes. We use those figures under
    the Open Database Licence (ODbL), and we credit They Vote For You on every screen and every printed
    card.
  </p>

  <h2>From members to parties</h2>
  <p>
    A party's score reflects the historical parliamentary voting record of its members. It describes
    the party, not any individual candidate's personal views, and does not predict how a candidate
    would vote in future. For each issue we take the <strong>plain average</strong> of the agreement figures
    of that party's members (each member counted once), then place the party on a five-point scale by
    dividing 0–100 into five equal bands:
  </p>
  <ul>
    <li><code>0–20</code> → <strong>1</strong>, strongly disagree</li>
    <li><code>20–40</code> → <strong>2</strong>, disagree</li>
    <li><code>40–60</code> → <strong>3</strong>, equal merits</li>
    <li><code>60–80</code> → <strong>4</strong>, agree</li>
    <li><code>80–100</code> → <strong>5</strong>, strongly agree</li>
  </ul>
  <p>
    Independents who have sat in parliament are scored as their own one-person “party”. A party or
    candidate with no member on the record for an issue simply has <strong>no position</strong> on it
    — it is never guessed, and it earns and risks nothing on that question.
  </p>

  <h2>Your answers</h2>
  <p>
    You answer each proposition on the same five-point scale (1 strongly disagree … 5 strongly
    agree), or skip it. When you review your answers at the end, you can <strong>star</strong> the
    issues that matter most to you as <strong>extremely important</strong>, which multiplies that
    one question's weight by <strong>exactly ten</strong>. Only your two strongest answers —
    <em>strongly disagree</em> and <em>strongly agree</em> — can be starred. Skipped questions count for
    nothing, for any party.
  </p>

  <h2>Scoring one question</h2>
  <p>
    For each question you answered, we compare your position with the party's using the plain gap
    between the two points on the scale — the <strong>distance</strong>
    <code>d = |party − you|</code>, a whole number from 0 (identical) to 4 (opposite ends). A party
    earns the most points when the gap is zero and fewer as it grows, down to none once the gap is
    wide enough. How much is on the table depends on how strongly <em>you</em> answered:
  </p>
  <ul>
    <li>
      a <strong>strong</strong> answer (strongly disagree/agree) is worth up to <code>4</code>
      points:
      <code>max(0, 4 − d)</code>;
    </li>
    <li>
      a <strong>moderate</strong> answer (disagree/agree) is worth up to <code>3</code>:
      <code>max(0, 3 − d)</code>;
    </li>
    <li>
      <strong>equal merits</strong> is worth up to <code>2</code>: <code>max(0, 2 − d)</code>.
    </li>
  </ul>
  <p>
    Marking a strong answer <strong>extremely important</strong> multiplies both the points earned
    and the points at stake by ten — up to <code>40</code> for that question:
    <code>max(0, 40 − 10d)</code>. The “points at stake” (the most a party could have earned) is
    tracked alongside the points it did earn, so a bigger question counts for proportionally more in
    the final total.
  </p>
  <p>
    For example, if you answer <em>strongly agree</em> and mark it extremely important, a party
    recorded at <em>agree</em> (a gap of 1) earns <code>40 − 10 = 30</code> of a possible
    <code>40</code>, while a party recorded at <em>strongly disagree</em> (a gap of 4) earns
    <code>0</code>.
  </p>

  <h2>Your overall match</h2>
  <p>
    Across every question you answered, we add up the points each party earned and the points it
    could have earned. Parties that have merged or been renamed between parliaments are combined
    <strong>at this stage</strong> — we add their raw earned and possible points together first, then
    compute a single percentage, so a merged party is treated as one continuous entity rather than an
    average of two rounded scores. The match is then
  </p>
  <p><code>match % = round( points earned ÷ points possible × 100 )</code>.</p>
  <p>
    A party you never had a scorable question in common with (it had no position on everything you
    answered) has no denominator, so it shows as <strong>no data</strong> rather than 0%.
  </p>

  <h2>Your comparison, then your plan</h2>
  <p>
    We compute a percentage for every party this way, then place those scores beside the candidates
    actually printed on <strong>your</strong> ballot — your House electorate and your Senate state —
    in <strong>official ballot order</strong>. This is shown as <strong>evidence only</strong>:
    nothing is ranked, nothing is crowned, and How2Vote never suggests who to put first. Every
    party's score links to the divisions behind it, so you can check any number.
  </p>
  <p>
    When you're ready, you build your own <strong>voting plan</strong> from a blank ballot — you choose
    every preference number yourself, by typing it or using the move-up / move-down controls. The order
    is entirely yours; we only offer a mechanical check that flags boxes you haven't numbered yet. Copy
    your numbers onto the real ballot paper and follow the AEC's instructions.
  </p>
  <p>
    For the Senate you can work <strong>above the line</strong> (the party groups; number at least
    six) or <strong>below the line</strong> (every individual candidate; number at least twelve), both
    in ballot order. Because our scoring is party-level, an above-the-line group takes the score of the
    party that heads it, and every candidate in a group shares that party's score. Number one way or the
    other — not both on the same paper.
  </p>

  <p>
    The scoring engine is open source and covered by tests that pin these numbers exactly; any
    change to the method is versioned and shown here and in the footer.
  </p>

  <h2>What the method does and doesn't capture</h2>
  <p>
    The comparison rests on editorial and methodological choices, and it is one reasonable reading
    of the public record — not the only one:
  </p>
  <ul>
    <li>
      <strong>Absences and pairs.</strong> A party's agreement figure comes from They Vote For You, whose
      figures already account for how members attended and voted; we do not add our own treatment of absences
      or paired votes, and we take each figure as published.
    </li>
    <li>
      <strong>Which issues appear.</strong> The propositions are selected from They Vote For You
      policies to span the parliamentary term; choosing and wording them is an editorial judgement.
      Each proposition states a concrete policy action alongside the genuine competing interest it
      trades off against, so agreeing and disagreeing are equally reasonable rather than a foregone
      conclusion. Each proposition links to the divisions behind it so you can read the record
      yourself. The set of propositions and the reasons for choosing them are recorded as a
      versioned
      <strong>proposition selection v3</strong>, bound to the published dataset, so any change to
      which issues appear is dated and explained rather than silent.
    </li>
    <li>
      <strong>Party-level records beside new candidates.</strong> A candidate with no personal voting
      record is shown against their party's historical record — that describes the party, not the candidate's
      own views, promises or future conduct.
    </li>
    <li>
      <strong>Ties.</strong> Equal alignment figures need no tie-break: candidates are never ranked by
      score, only ever shown in official ballot order.
    </li>
  </ul>

  <h2>Provenance and changes</h2>
  <p>
    The scoring method described on this page is versioned. It is currently
    <strong>methodology {METHODOLOGY_VERSION}</strong>. This number is bumped only when the method
    itself changes — the banding, the distance and points formula, the weighting, or how party
    records are combined — not when the data is simply refreshed.
  </p>
  <p>
    Each election's card records its <strong>data vintage</strong> (the latest division the
    positions were compiled from), the <strong>data</strong> and <strong>app</strong> versions, and the
    parliamentary voting source, so a saved or printed card carries its own provenance. The dataset also
    records the official source of its candidate ballots (AEC candidate nominations) and the data version
    they arrived in. Ballots are ingested through a manual, human-reviewed change process, and once an
    election's snapshot is locked, automated checks refuse any further change to it.
  </p>
  <p>
    We keep a published <a href="/corrections">correction and methodology-change history</a>: every
    correction we make and every change to the scoring method, dated and versioned. Suspected errors
    — a wrong candidate, party mapping, ballot order or figure — can be reported through the
    <a href="/contact">contact page</a>, and the channel is monitored during a campaign.
  </p>

  <h2>Aggregate insights</h2>
  <p>
    From the research contributions people choose to make after building a comparison, we publish
    aggregate figures on how views line up with these voting records. The analysis starts on the
    contributor's own device — their individual answers and weights never leave it; only the derived
    result travels — and what we store is <strong>group counts, not individual records</strong>. A
    figure appears only once a group is large enough that a single contribution cannot readily be
    singled out — see <a href="/insights">insights</a> and the
    <a href="/privacy">privacy page</a> for how that works. On election day we don't publish this analysis
    while people are still voting: insights are closed from midnight until the last polls close nationally
    (8&nbsp;pm AEST), and return after that.
  </p>
  <p>
    People may also answer an optional survey about themselves. Its questions follow Australian
    Bureau of Statistics categories and Australian Election Study conventions, so the responses can
    be compared against Census and other public data; the exact wordings are recorded in our
    research codebook. We hold no name, contact detail, IP address or device identifier, and no
    per-person research record exists at all — though no technique eliminates every possible risk:
    while counts are small, a rare category could still say something about a person known to have
    contributed. That is why counts pairing results with sensitive answers are kept national-only,
    stored counts are kept apart from operational systems, and only privacy-protected aggregates are
    published — see the <a href="/privacy">privacy page</a>.
  </p>
</ContentPage>
