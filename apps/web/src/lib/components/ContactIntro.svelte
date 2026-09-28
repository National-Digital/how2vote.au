<script lang="ts">
  /**
   * The contact page's text above its form. The page renders it, and the build renders it into
   * `states/contact.html` for the iOS app, which draws its own form beneath it (ADR 0019 D4b).
   */
  import { ORG } from "$lib/org";
</script>

<p>
  Questions, corrections, or something not working? Send us a message and we'll get back to you. For
  a quick note on any screen you can also use the <strong>Feedback</strong> button.
</p>

<h2>Answers to common questions</h2>
<ul>
  <li>
    <a href="/methodology">How it works</a> — where the vote comparisons come from and how a match is
    calculated.
  </li>
  <li>
    <a href="/glossary">Glossary</a> — the parliamentary and electoral terms the app uses.
  </li>
  <li>
    <a href="/corrections">Corrections</a> — how to report an error in the data, and what has already
    been corrected.
  </li>
  <li>
    <a href="/accessibility">Accessibility</a> — alternative formats, and help using the app with assistive
    technology.
  </li>
  <li>
    <a href="/privacy">Privacy policy</a> — what stays on your device and what leaves it.
  </li>
</ul>

<h2>Contact us directly</h2>
<p>
  Email: <a href="mailto:{ORG.email}">{ORG.email}</a><br />
  Telephone: {ORG.phone}
</p>
<p>
  We read every message and reply to the email address you give us. Telling us which page or step
  you were on, and what you expected to happen, helps us answer sooner.
</p>

<h2>Send us a message</h2>
