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
  .prog {
    height: 3px;
    background: var(--line);
    margin: 0 var(--gutter);
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
