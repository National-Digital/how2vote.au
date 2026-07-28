<script lang="ts">
  /** Visual breadcrumb trail for the data-derived content pages. The matching BreadcrumbList
   * JSON-LD is emitted separately by DataPage; this is the on-page navigation only. */
  export type Crumb = { label: string; href?: string };
  let { crumbs }: { crumbs: Crumb[] } = $props();
</script>

<nav class="crumbs ui app-top" aria-label="Breadcrumb">
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
    /* Sticky (app-top in app.css): a little bottom padding so, when stuck, scrolled content
       doesn't butt straight against the trail's descenders. */
    padding: 12px var(--gutter) 10px;
    font-size: 12px;
    color: var(--ink3);
  }
  /* The trail stays on ONE line. Pinned (app-top), its height is what the focus scroll-padding
     reserves — a wrapped two-line trail exceeds that reserve on a 320px screen, leaving a focused
     control partly under the bar (WCAG 2.2 SC 2.4.11), and it grows further with text zoom. */
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: nowrap;
    gap: 6px;
    /* NOT `overflow: hidden` — the row's box is exactly the crumb links' box, so clipping here
       erases their focus ring (2px outline at a 2px offset) and keyboard users lose the indicator
       entirely. Every crumb can ellipsise instead, so there is nothing to clip. */
  }
  /* All crumbs may shrink and ellipsise, so the row always fits without sideways scrolling
     (SC 1.4.10) and no crumb is ever cut mid-word with no cue. The CURRENT-PAGE crumb absorbs it
     first — a far larger shrink factor, and it is the one that grows into any spare room — so the
     "up" links stay whole in every realistic trail; the ancestors only start ellipsising when even
     that is exhausted. `min-width` on the current crumb keeps at least an ellipsis visible rather
     than collapsing it to nothing. Truncation is visual only: the full text stays in the DOM for
     assistive tech, and the last crumb repeats in the <h1> directly beneath. */
  li {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 1 auto;
    min-width: 0;
  }
  li:last-child {
    flex: 1 1 auto;
    flex-shrink: 999;
  }
  /* The floor that keeps an ellipsis visible instead of a half-drawn glyph goes on the LINK/SPAN,
     not the li: the li's box also carries the "›" separator and the 6px gap (~15px at large text),
     which would be eaten out of any floor set there.
     Both units are needed, because the two ways text gets bigger resolve them differently:
       em  — against the SPECIFIED font-size, which Blink's minimum-font-size setting does not
             raise, so em alone stays 24px and the ellipsis is clipped away;
       ch  — against the USED font metrics, which minimum-font-size does raise, but which text
             zoom scales less generously.
     max() takes whichever is larger, so the cue survives both. */
  li:last-child > :is(a, span[aria-current]) {
    min-width: max(2em, 3ch);
  }
  /* Known limitation: past roughly 200% text there is not enough room for three crumbs on a
     320px screen, so the ancestors ellipsise too ("2…"). The trail is supplementary navigation —
     the <h1>, the page content and the browser's own Back remain unaffected. */
  li > :is(a, span[aria-current]) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
       exception does not apply — give each link a 24px-tall hit area without resizing the type.
       A BLOCK box (not inline-flex): text-overflow only ellipsises a block container's own text,
       and a flex container would wrap that text in an anonymous item it can never clip. The line
       height carries the target size instead of align-items. */
    display: block;
    line-height: 24px;
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
