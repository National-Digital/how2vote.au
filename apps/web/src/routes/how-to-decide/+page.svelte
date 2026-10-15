<script lang="ts">
  import ContentPage from "$lib/components/ContentPage.svelte";
  import ExternalLink from "$lib/components/ExternalLink.svelte";
  import GlossaryTerm from "$lib/components/GlossaryTerm.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import StructuredData from "$lib/components/StructuredData.svelte";
  import { compareLead, decideFaqs } from "$lib/content/how-to-decide";
  import { faqGraph } from "$lib/structured-data";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const faqs = $derived(decideFaqs(data));
</script>

<Meta />
<StructuredData node={faqGraph(faqs)} />

<ContentPage title="How to decide your vote">
  {#each faqs as faq (faq.question)}
    <h2>{faq.question}</h2>
    <p>{faq.answer}</p>
  {/each}

  <h2>Compare your views</h2>
  <p>
    {compareLead(data.stage)}
    When you review your answers, you can mark a strongly agree or strongly disagree answer as extremely
    important. <a href="/start">Start the questions</a>.
  </p>
  <p>
    To read the record first, browse the propositions and how each party is recorded voting on them
    in <a href={data.issuesHref}>Where parties stand</a>, or follow any proposition to the
    <GlossaryTerm id="division">divisions</GlossaryTerm> behind it on
    <ExternalLink href="https://theyvoteforyou.org.au/">They Vote For You</ExternalLink>. The
    scoring method is set out in full on <a href="/methodology">How it works</a>.
  </p>
</ContentPage>
