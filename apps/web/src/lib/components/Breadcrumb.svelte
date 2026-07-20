<script lang="ts">
  /** Visual breadcrumb trail for the data-derived content pages. The matching BreadcrumbList
   * JSON-LD is emitted separately by DataPage; this is the on-page navigation only. */
  export type Crumb = { label: string; href?: string };
  let { crumbs }: { crumbs: Crumb[] } = $props();
</script>

<nav class="crumbs ui" aria-label="Breadcrumb">
  <ol>
    {#each crumbs as c, i (i)}
      <li>
        {#if c.href}
          <a href={c.href}>{c.label}</a>
        {:else}
          <span aria-current="page">{c.label}</span>
        {/if}
      </li>
    {/each}
  </ol>
</nav>

<style>
  .crumbs {
    padding: 12px var(--gutter) 0;
    font-size: 12px;
    color: var(--ink3);
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  li + li::before {
    content: "›";
    color: var(--ink3);
  }
  a {
    color: var(--ink2);
    text-decoration: underline;
    text-underline-offset: 3px;
    /* WCAG 2.2 SC 2.5.8 Target Size (Minimum): crumbs sit 6px apart (< 24px), so the spacing
       exception does not apply — give each link a 24px-tall hit area without resizing the type. */
    display: inline-flex;
    align-items: center;
    min-height: 24px;
  }
  a:hover,
  a:focus-visible {
    color: var(--ink);
  }
  span[aria-current] {
    color: var(--ink);
  }
</style>
