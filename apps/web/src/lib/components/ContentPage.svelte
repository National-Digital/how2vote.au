<script lang="ts">
  import type { Snippet } from "svelte";
  import { goto } from "$app/navigation";
  import TopBar from "./TopBar.svelte";

  let { title, children }: { title: string; children: Snippet } = $props();
</script>

<TopBar label={title} onback={() => goto("/")} backLabel="Back to start" />

<!-- `.prose` is a global class (app.css) rather than styles scoped here: the same body markup is
     also rendered inside DocDialog, and typography that existed only on the page would make the
     dialog a visibly different copy of the document the reader was promised. -->
<article class="prose">
  <h1>{title}</h1>
  {@render children()}
</article>
