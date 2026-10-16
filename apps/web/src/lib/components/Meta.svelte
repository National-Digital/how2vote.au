<script lang="ts">
  /**
   * Per-page metadata: title, description, canonical URL and OpenGraph/Twitter tags.
   * Resolves the current route from `page.url.pathname` against the seo.ts map, so most pages just
   * render <Meta />. Pass `title`/`description` only to override (e.g. a dynamic quiz title); the
   * canonical, robots and social tags always follow the resolved route.
   */
  import { page } from "$app/state";
  import { env } from "$env/dynamic/public";
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
  import { dataPageModified } from "$lib/page-date";
  import { isNativeShell } from "$lib/channel";
  import { markdownTwinHref } from "$lib/markdown-twin";

  let {
    title,
    description,
    image,
    type = "website",
    asAt,
  }: {
    title?: string;
    description?: string;
    image?: string;
    type?: "website" | "article";
    /** For a data page, the date another source it shows was read (`dataPageModified`). */
    asAt?: string;
  } = $props();

  const path = $derived(canonicalPath(page.url.pathname));
  const meta = $derived(resolveMeta(path));
  const t = $derived(title ?? meta.title);
  const d = $derived(description ?? meta.description);
  const img = $derived(image ?? OG_IMAGE);
  const canonical = $derived(SITE_URL + path);
  const indexable = $derived(meta.index !== false);
  // Twins are published by indexable web builds only; app bundles and previews carry none.
  const twinsPublished = !isNativeShell && env.PUBLIC_NOINDEX !== "1";
  const twin = $derived(twinsPublished && indexable ? markdownTwinHref(page.route.id, path) : null);
  const election = $derived(page.params.election);
  const section = $derived(path.split("/")[2] ?? "");
  const modified = $derived(
    type === "article" && election ? dataPageModified(election, section, asAt) : null,
  );
</script>

<svelte:head>
  <title>{t}</title>
  <meta name="description" content={d} />
  <link rel="canonical" href={canonical} />
  {#if !indexable}<meta name="robots" content="noindex, follow" />{/if}
  {#if twin}<link rel="alternate" type="text/markdown" href={twin} />{/if}

  <meta property="og:type" content={type} />
  <meta property="og:site_name" content={SITE_NAME} />
  <meta property="og:title" content={t} />
  <meta property="og:description" content={d} />
  <meta property="og:url" content={canonical} />
  <meta property="og:locale" content={OG_LOCALE} />
  <meta property="og:image" content={img} />
  <meta property="og:image:width" content={String(OG_IMAGE_WIDTH)} />
  <meta property="og:image:height" content={String(OG_IMAGE_HEIGHT)} />
  <meta property="og:image:alt" content="How2Vote — vote on their record" />
  {#if modified}<meta property="article:modified_time" content={modified} />{/if}

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={t} />
  <meta name="twitter:description" content={d} />
  <meta name="twitter:image" content={img} />
</svelte:head>
