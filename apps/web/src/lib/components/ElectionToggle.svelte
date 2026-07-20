<script lang="ts">
  /**
   * Segmented control for choosing which election a page shows. Rendered as real links so the choice
   * lives in a crawlable, shareable URL — not just client state. Two-tone by design (UI-DESIGN):
   * ink-on-paper, the current segment inverts. `active` is the page's election id.
   *
   * Without `section` it links to each election's landing (current → `/`, past → `/2019`). With a
   * `section` (e.g. "issues") it links to that data section for each election (`/2019/issues`,
   * `/2025/issues`, …), which every election has — so the same content page toggles across years.
   */
  import { CURRENT_ELECTION_ID, ELECTIONS } from "@how2vote/data-schema";

  let { active, section }: { active: string; section?: string } = $props();

  const href = (id: string): string =>
    section ? `/${id}/${section}` : id === CURRENT_ELECTION_ID ? "/" : `/${id}`;
</script>

<div class="toggle ui" role="group" aria-label="Choose an election">
  {#each ELECTIONS as e (e.id)}
    <a
      class:on={active === e.id}
      aria-current={active === e.id ? "page" : undefined}
      href={href(e.id)}
    >
      {e.shortLabel}
    </a>
  {/each}
</div>

<style>
  .toggle {
    display: inline-flex;
    max-width: 100%;
    border: 1px solid var(--line2);
    border-radius: var(--radius);
    overflow: hidden;
  }
  /* Selectors are scoped under .toggle so they out-specify a host page's link styles (e.g. the
     content pages render the toggle inside a .prose block whose `a` rule would otherwise override
     the active segment's colour, giving ink-on-ink). */
  .toggle a {
    background: none;
    border: 0;
    padding: 8px 16px;
    font-family: var(--ui);
    font-size: 13px;
    font-weight: 600;
    color: var(--ink2);
    text-decoration: none;
    cursor: pointer;
  }
  .toggle a + a {
    border-left: 1px solid var(--line2);
  }
  .toggle a.on {
    background: var(--ink);
    color: var(--on-fill);
  }
</style>
