<script lang="ts">
  /**
   * Per-page metadata: title, description, canonical URL and OpenGraph/Twitter tags.
   * Resolves the current route from `page.url.pathname` against the seo.ts map, so most pages just
   * render <Meta />. Pass `title`/`description` only to override (e.g. a dynamic quiz title); the
   * canonical, robots and social tags always follow the resolved route.
   */
  import { page } from "$app/state";
  import {
    SITE_URL,
    SITE_NAME,
    OG_IMAGE,
    OG_IMAGE_WIDTH,
    OG_IMAGE_HEIGHT,
    OG_LOCALE,
    canonicalPath,
    resolveMeta,
  } from "$lib/seo";

  let {
    title,
    description,
    image,
    type = "website",
  }: {
    title?: string;
    description?: string;
    image?: string;
    type?: "website" | "article";
  } = $props();

  const path = $derived(canonicalPath(page.url.pathname));
  const meta = $derived(resolveMeta(path));
  const t = $derived(title ?? meta.title);
  const d = $derived(description ?? meta.description);
  const img = $derived(image ?? OG_IMAGE);
  const canonical = $derived(SITE_URL + path);
  const indexable = $derived(meta.index !== false);
</script>

<svelte:head>
  <title>{t}</title>
  <meta name="description" content={d} />
  <link rel="canonical" href={canonical} />
  {#if !indexable}<meta name="robots" content="noindex, follow" />{/if}

  <meta property="og:type" content={type} />
  <meta property="og:site_name" content={SITE_NAME} />
  <meta property="og:title" content={t} />
  <meta property="og:description" content={d} />
  <meta property="og:url" content={canonical} />
  <meta property="og:locale" content={OG_LOCALE} />
  <meta property="og:image" content={img} />
  <meta property="og:image:width" content={String(OG_IMAGE_WIDTH)} />
  <meta property="og:image:height" content={String(OG_IMAGE_HEIGHT)} />
  <meta property="og:image:alt" content="how2vote — vote on their record" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={t} />
  <meta name="twitter:description" content={d} />
  <meta name="twitter:image" content={img} />
</svelte:head>
