<script lang="ts">
  // The wordmark "how[2]vote": a preference "2" marked inside a ballot-paper box.
  // Rendered from baked Newsreader outlines ($lib/brand/mark.mjs) so
  // the mark is identical everywhere — no font dependency, no platform serif drift.
  // Monochrome via currentColor, survives at any size, on any ground. `box` renders
  // the icon alone.
  import { MARK, WORDMARK } from "$lib/brand/mark.mjs";
  let { size = "md", box = false }: { size?: "sm" | "md" | "xl"; box?: boolean } = $props();
</script>

{#if box}
  <svg
    class="logo {size}"
    viewBox={MARK.viewBox}
    style="aspect-ratio: 1"
    role="img"
    aria-label="How2Vote"
  >
    <rect
      x={MARK.rect.x}
      y={MARK.rect.y}
      width={MARK.rect.width}
      height={MARK.rect.height}
      rx={MARK.rect.rx}
      fill="none"
      stroke="currentColor"
      stroke-width={MARK.rect.strokeWidth}
    />
    <path fill="currentColor" d={MARK.numeralD} />
  </svg>
{:else}
  <svg
    class="logo {size}"
    viewBox={WORDMARK.viewBox}
    style="aspect-ratio: {WORDMARK.width} / {WORDMARK.height}"
    role="img"
    aria-label="How2Vote"
  >
    <path fill="currentColor" d={WORDMARK.textD} />
    <rect
      x={WORDMARK.rect.x}
      y={WORDMARK.rect.y}
      width={WORDMARK.rect.width}
      height={WORDMARK.rect.height}
      rx={WORDMARK.rect.rx}
      fill="none"
      stroke="currentColor"
      stroke-width={WORDMARK.rect.strokeWidth}
    />
    <path fill="currentColor" d={WORDMARK.numeralD} />
  </svg>
{/if}

<style>
  .logo {
    display: inline-block;
    width: auto;
    vertical-align: middle;
    color: inherit;
  }
  .sm {
    height: 20px;
  }
  .md {
    height: 30px;
  }
  .xl {
    height: clamp(40px, 9vw, 64px);
  }
</style>
