<script lang="ts">
  /** Shared scaffold for the data-derived content pages: a breadcrumb trail and a prose article.
   * Kept strictly two-tone (ink on paper) like the rest of the tool — see the neutrality lint.
   *
   * Emits the BreadcrumbList JSON-LD from the SAME `crumbs` it renders visibly, so the structured
   * data can never drift from the on-page trail — every content page gets both from this one prop. */
  import type { Snippet } from "svelte";
  import { page } from "$app/state";
  import { breadcrumbItems } from "$lib/nav";
  import { breadcrumbGraph } from "$lib/structured-data";
  import Breadcrumb, { type Crumb } from "./Breadcrumb.svelte";
  import StructuredData from "./StructuredData.svelte";

  let {
    crumbs,
    title,
    intro,
    children,
  }: { crumbs: Crumb[]; title: string; intro?: string; children: Snippet } = $props();
</script>

<StructuredData node={breadcrumbGraph(breadcrumbItems(crumbs, page.url.pathname))} />
<Breadcrumb {crumbs} />

<article class="prose">
  <h1>{title}</h1>
  {#if intro}<p class="intro">{intro}</p>{/if}
  {@render children()}
</article>

<style>
  .prose {
    padding: 8px var(--gutter) 24px;
    font-size: 16px;
    line-height: 1.62;
  }
  .prose :global(h1) {
    font-size: 26px;
    line-height: 1.2;
    margin: 8px 0 12px;
  }
  .prose :global(h2) {
    font-size: 19px;
    margin: 28px 0 8px;
  }
  .intro {
    color: var(--ink2);
    margin: 0 0 18px;
  }
  /* Cross-election toggle sits between the intro and the content, like the insights dashboard. */
  .prose :global(.switch) {
    margin: 0 0 22px;
  }
  /* Inline transparency callout (e.g. party-merge disclosure). Two-tone: a ruled, quieter block. */
  .prose :global(.note) {
    border-left: 2px solid var(--rule, var(--line));
    padding: 2px 0 2px 12px;
    margin: 0 0 20px;
    color: var(--ink2);
    font-size: 14px;
  }
  .prose :global(p) {
    margin: 0 0 14px;
    color: var(--ink2);
  }
  .prose :global(a) {
    color: var(--ink);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  /* Compact, ruled lists used for candidate rosters, party positions and index links. */
  .prose :global(.rows) {
    list-style: none;
    padding: 0;
    margin: 0 0 20px;
  }
  .prose :global(.rows li) {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 0;
    border-top: 1px solid var(--line);
    color: var(--ink2);
  }
  .prose :global(.rows li:last-child) {
    border-bottom: 1px solid var(--line);
  }
  .prose :global(.rows .lead) {
    color: var(--ink);
  }
  .prose :global(.rows .meta) {
    color: var(--ink3);
    text-align: right;
    flex: 0 0 auto;
  }
  .prose :global(.cols) {
    columns: 2 200px;
    gap: 20px;
    padding: 0;
    margin: 0 0 20px;
    list-style: none;
  }
  .prose :global(.cols li) {
    padding: 5px 0;
    break-inside: avoid;
  }
  .prose :global(.source) {
    font-size: 13px;
    color: var(--ink3);
    border-top: 1px solid var(--line);
    padding-top: 14px;
    margin-top: 22px;
  }
</style>
