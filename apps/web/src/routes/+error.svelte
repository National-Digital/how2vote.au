<script lang="ts">
  // Branded error page. Rendered by the router for any load/navigation error and, via the
  // adapter-static fallback (404.html), for unknown URLs. Copy for every status class (404, 403,
  // 429, 5xx, …) comes from the shared errors module — the same source the static edge error page
  // is generated from — so the two can never drift. Keeps the "ink on paper" design.
  import { page } from "$app/state";
  import Logo from "$lib/components/Logo.svelte";
  import { errorInfo } from "$lib/errors.js";

  const info = $derived(errorInfo(page.status, page.error?.message));

  function retry(): void {
    location.reload();
  }
</script>

<svelte:head>
  <title>{info.title} — How2Vote</title>
  <meta name="robots" content="noindex, follow" />
</svelte:head>

<div class="wrap">
  <header class="top ui"><Logo size="sm" /></header>
  <div class="body">
    <p class="code ui">{info.code}</p>
    <h1>{info.title}</h1>
    <p class="lede">{info.lede}</p>
    <div class="cta">
      {#if info.canRetry}
        <button type="button" class="btn" onclick={retry}>Try again</button>
        <a class="link" href="/">Back to the start</a>
      {:else}
        <a class="btn" href="/">Back to the start</a>
        <a class="link" href="/ballot">Build my comparison</a>
      {/if}
    </div>
  </div>
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .top {
    padding: 14px var(--gutter) 6px;
  }
  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 8px var(--gutter) 40px;
  }
  .code {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.13em;
    color: var(--ink3);
    margin: 0 0 8px;
  }
  h1 {
    font-size: clamp(27px, 7vw, 32px);
    line-height: 1.14;
    margin: 0;
  }
  .lede {
    font-size: 15px;
    color: var(--ink2);
    line-height: 1.55;
    margin: 14px 0 0;
  }
  .cta {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 28px;
  }
  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 50px;
    border: 0;
    border-radius: var(--radius);
    background: var(--ink);
    color: var(--on-fill);
    font-family: var(--ui);
    font-size: 15px;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }
  .link {
    text-align: center;
    color: var(--ink2);
    font-family: var(--ui);
    font-size: 14px;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
</style>
