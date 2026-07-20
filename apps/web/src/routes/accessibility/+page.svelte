<script lang="ts">
  import ContentPage from "$lib/components/ContentPage.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import { ORG } from "$lib/org";

  // The full conformance claim is deliberately withheld until the whole-journey accessibility audit
  // is complete (docs/adr/0006) — this page states "being tested", not "conformant".
  const lastUpdated = "14 July 2026";
</script>

<Meta />

<ContentPage title="Accessibility">
  <p class="updated">Last updated: {lastUpdated}</p>

  <h2>Our commitment</h2>
  <p>
    We want people to be able to use how2vote regardless of disability, device, input method,
    browser or assistive technology.
  </p>
  <p>
    We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at Level AA and to provide
    equal access to the Service consistently with the Disability Discrimination Act 1992 (Cth).
  </p>
  <p>
    WCAG conformance supports accessibility, but it does not replace our obligation to respond to an
    individual barrier or provide a reasonable alternative where needed.
  </p>

  <h2>Current conformance status</h2>
  <p>
    The Service is being tested against WCAG 2.2 Level AA. We do not claim full conformance until
    the complete user journey has been tested and material issues have been remediated.
  </p>
  <p>
    Testing must cover the quiz, electorate selection, comparison results, manual preference-order
    builder, saved and shared plans, print and download functions, consent controls, feedback forms
    and privacy settings.
  </p>

  <h2>Accessibility features</h2>
  <p>The Service is designed to provide:</p>
  <ul>
    <li>semantic headings, landmarks, labels and instructions;</li>
    <li>full keyboard access with a visible focus indicator;</li>
    <li>no requirement to use drag-and-drop, a pointer device, colour or visual maps;</li>
    <li>text search as an alternative to electorate maps;</li>
    <li>high text contrast and content that reflows at high zoom and on small screens;</li>
    <li>controls with accessible names, states and error messages;</li>
    <li>screen-reader announcements when answers or preference positions change;</li>
    <li>controls to move a candidate or group up or down and to enter a number directly;</li>
    <li>reduced-motion support;</li>
    <li>saved progress so information does not need to be entered repeatedly; and</li>
    <li>
      an accessible HTML version of a voting plan, even where a printable or image version is also
      provided.
    </li>
  </ul>

  <h2>Manual preference ordering</h2>
  <p>
    The preference-order builder is usable without dragging. Keyboard and screen-reader users can
    choose numbers directly or use labelled move-up and move-down controls.
  </p>
  <p>
    The Service identifies duplicate, missing or incomplete numbers in text and does not rely on
    colour alone. Focus moves to, or a summary links to, the relevant issue.
  </p>

  <h2>Known and potential limitations</h2>
  <p>
    The following areas require particular testing and may create limitations if not implemented
    correctly:
  </p>
  <ul>
    <li>electorate maps, which remain optional and have a complete text alternative;</li>
    <li>long Senate candidate lists and preference-order controls;</li>
    <li>print, PDF or image versions of a voting plan;</li>
    <li>third-party form protection such as Cloudflare Turnstile; and</li>
    <li>content or data supplied by third parties.</li>
  </ul>
  <p>
    A plain HTML plan and direct email and telephone contact are available as alternatives to
    inaccessible download or form functions.
  </p>

  <h2>Feedback and alternative formats</h2>
  <p>
    If any part of the Service is difficult to use, please tell us what page or step you were using,
    what went wrong, and the browser or assistive technology involved if you are comfortable
    providing that information.
  </p>
  <p>You can also ask for information in a different accessible format.</p>
  <p>
    Email: <a href="mailto:{ORG.email}">{ORG.email}</a><br />
    Telephone: {ORG.phone}
  </p>
  <p>
    We aim to acknowledge accessibility feedback within five business days and to provide a response
    or practical alternative as soon as reasonably possible.
  </p>

  <h2>Escalating a complaint</h2>
  <p>
    We will try to resolve accessibility concerns directly. If you are not satisfied, you may make a
    complaint to the Australian Human Rights Commission or seek other available remedies.
  </p>

  <h2>Review</h2>
  <p>This statement and the Service's accessibility are reviewed:</p>
  <ul>
    <li>before each supported election;</li>
    <li>after a material change to the quiz, results, plan builder or third-party services;</li>
    <li>after a significant accessibility complaint; and</li>
    <li>at least annually.</li>
  </ul>
</ContentPage>

<style>
  .updated {
    font-size: 13px;
    color: var(--ink3);
    margin-top: -4px;
  }
</style>
