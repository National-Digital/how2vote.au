<script lang="ts">
  import type { Snippet } from "svelte";
  import { goto } from "$app/navigation";
  import TopBar from "./TopBar.svelte";

  let { title, children }: { title: string; children: Snippet } = $props();
</script>

<TopBar label={title} onback={() => goto("/")} backLabel="Back to start" />

<article class="prose">
  <h1>{title}</h1>
  {@render children()}
</article>

<style>
  .prose {
    padding: 8px var(--gutter) 24px;
    font-size: 16px;
    line-height: 1.62;
  }
  .prose :global(h1) {
    font-size: 28px;
    margin: 8px 0 16px;
  }
  .prose :global(h2) {
    font-size: 20px;
    margin: 28px 0 8px;
  }
  .prose :global(p) {
    margin: 0 0 14px;
    color: var(--ink2);
  }
  .prose :global(li) {
    color: var(--ink2);
    margin-bottom: 6px;
  }
  .prose :global(strong) {
    color: var(--ink);
  }
  .prose :global(a) {
    color: var(--ink);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .prose :global(code) {
    font-family: var(--mono);
    font-size: 0.85em;
    background: var(--wash);
    padding: 1px 5px;
    border-radius: 3px;
  }
</style>
