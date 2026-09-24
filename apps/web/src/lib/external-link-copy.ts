/**
 * What an external link says it does before it is followed (WCAG 3.2.5), by channel: the shells
 * open an in-app browser rather than a new tab. `ExternalLink.svelte` appends it to each link's
 * accessible name, and the site chrome hands the app's to the iOS native core for its own links.
 */
export const LINK_CUE = {
  app: "opens in an in-app browser",
  web: "opens in a new tab",
} as const;
