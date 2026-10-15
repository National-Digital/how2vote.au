<script lang="ts">
  /** The CC BY 4.0 notice for the ABS postcode correspondence: source, attribution and licence. */
  import ExternalLink from "./ExternalLink.svelte";

  let {
    sources,
    attribution,
    licenceUrl,
  }: { sources: { title: string; url: string }[]; attribution: string; licenceUrl: string } =
    $props();

  const sep = (i: number): string =>
    i < sources.length - 2 ? ", " : i === sources.length - 2 ? " and " : "";
</script>

<p class="source">
  Source: Australian Bureau of Statistics, {#each sources as s, i (s.url)}<ExternalLink href={s.url}
      >{s.title}</ExternalLink
    >{sep(i)}{/each}. {attribution}
  (<ExternalLink href={licenceUrl}>licence</ExternalLink>), adapted by How2Vote and provided without
  warranty (see licence).
</p>
