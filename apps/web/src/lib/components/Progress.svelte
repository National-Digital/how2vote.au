<script lang="ts">
  let {
    value,
    max = 1,
    label = "Progress",
  }: { value: number; max?: number; label?: string } = $props();
  const pct = $derived(Math.max(0, Math.min(100, (value / max) * 100)));
</script>

<div
  class="prog"
  role="progressbar"
  aria-label={label}
  aria-valuenow={Math.round(pct)}
  aria-valuemin={0}
  aria-valuemax={100}
>
  <i style="width: {pct}%"></i>
</div>

<style>
  /* Scrolls with the content, deliberately. A pinned rail would need an offset derived from the
     sticky bar's height, and no source for that number is correct for everyone (see the note on
     .app-top in app.css). The pinned bar states the position in words anyway. */
  .prog {
    height: 3px;
    background: var(--line);
    /* Separation on BOTH sides, restoring what the rail had as a pinned row — without it the 3px
       line reads as welded to the bar above and the content below. */
    margin: 8px var(--gutter);
    border-radius: 2px;
    overflow: hidden;
  }
  i {
    display: block;
    height: 100%;
    background: var(--ink);
    transition: width var(--dur-advance) ease-out;
  }
</style>
