<script lang="ts">
  /**
   * The body of /how-to-decide for one stage of the current election. The route renders it for the
   * stage now; the build also renders it for every stage (`routes/states/how-to-decide`), which the
   * iOS app draws for the stage now.
   */
  import ContentPage from "./ContentPage.svelte";
  import ExternalLink from "./ExternalLink.svelte";
  import GlossaryTerm from "./GlossaryTerm.svelte";
  import StructuredData from "./StructuredData.svelte";
  import { compareLead, decideFaqs } from "$lib/content/how-to-decide";
  import type { Stage } from "$lib/election-stage";
  import { faqGraph } from "$lib/structured-data";

  let props: {
    label: string;
    propositions: number;
    stage: Stage;
    electorateLess: boolean;
    issuesHref: string;
  } = $props();
  const faqs = $derived(decideFaqs(props));
</script>

<StructuredData node={faqGraph(faqs)} />

<ContentPage title="How to decide your vote">
  {#each faqs as faq (faq.question)}
    <h2>{faq.question}</h2>
    <p>{faq.answer}</p>
  {/each}

  <h2>Compare your views</h2>
  <p>
    {compareLead(props.stage, props.electorateLess)}
    When you review your answers, you can mark a strongly agree or strongly disagree answer as extremely
    important. <a href="/start">Start the questions</a>.
  </p>
  <p>
    To read the record first, browse the propositions and how each party is recorded voting on them
    in <a href={props.issuesHref}>Where parties stand</a>, or follow any proposition to the
    <GlossaryTerm id="division">divisions</GlossaryTerm> behind it on
    <ExternalLink href="https://theyvoteforyou.org.au/">They Vote For You</ExternalLink>. The
    scoring method is set out in full on <a href="/methodology">How it works</a>.
  </p>
</ContentPage>
