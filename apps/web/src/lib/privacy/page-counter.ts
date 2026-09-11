/**
 * The cookieless page counter, loaded from code rather than from a tag in app.html.
 *
 * A share link encodes answers in the URL fragment, and the privacy policy promises the fragment
 * reaches no analytics. A tag in the document reads the address as the browser has it, so keeping
 * that promise would rest on what the vendor's script chooses to send. Loading it here does not:
 * where the address carries a fragment, the counter is never loaded at all, and the page simply
 * goes uncounted. Arrivals on a share link are the cost, and they are the visits whose address
 * carries the thing this site most has to protect.
 *
 * Registered as `cloudflare-web-analytics` in third-party-services.json, which is what puts
 * static.cloudflareinsights.com in script-src and cloudflareinsights.com in connect-src. Without
 * the registry entry the script below is refused; without the script the token counts nothing.
 */

const BEACON = "https://static.cloudflareinsights.com/beacon.min.js";
const TOKEN = "859ae981d4af49fc8b6cbb11f349c73f";

/** Load the counter, unless the address carries a fragment. Returns whether it was loaded. */
export function startPageCounter(doc: Document = document): boolean {
  if (doc.defaultView?.location.hash) return false;
  if (doc.querySelector(`script[src="${BEACON}"]`)) return false;
  const script = doc.createElement("script");
  script.type = "module";
  script.defer = true;
  script.src = BEACON;
  script.setAttribute("data-cf-beacon", JSON.stringify({ token: TOKEN }));
  doc.head.append(script);
  return true;
}
