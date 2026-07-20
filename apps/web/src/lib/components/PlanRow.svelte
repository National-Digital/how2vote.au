<script lang="ts">
  // One row of the BUILD stage: a blank ballot line the voter fills in themselves. Preference is
  // entered by typing a number directly OR with the labelled move-up / move-down buttons — never by
  // dragging (WCAG 2.5.7). Nothing is pre-filled: an unranked row shows an empty box. The
  // candidate/group name stays in official ballot order.
  let {
    uid,
    candidate,
    party,
    pref,
    total,
    onset,
    onup,
    ondown,
  }: {
    /** Page-unique key for this row; sanitised into the input's DOM id for the label association. */
    uid: string;
    candidate: string;
    party: string;
    /** 1-based preference, or 0 when unranked. */
    pref: number;
    total: number;
    onset: (n: number) => void;
    onup: () => void;
    ondown: () => void;
  } = $props();

  const name = $derived(`${candidate}, ${party || "Independent"}`);
  // Candidate names carry spaces/commas/apostrophes — never valid in a DOM id — so derive a safe one.
  const inputId = $derived(`pref-${uid.replace(/[^a-zA-Z0-9]+/g, "-")}`);

  // Commit on `change` (blur / Enter), not on every keystroke: the box shows the contiguous rank,
  // so committing per-keystroke would rewrite a multi-digit entry ("12") as you type it. The
  // move-up/down buttons remain the immediate, fully-keyboard path.
  function onCommit(e: Event): void {
    const raw = (e.currentTarget as HTMLInputElement).value.trim();
    onset(raw === "" ? NaN : Number(raw));
  }
</script>

<li class="row">
  <div class="pref">
    <label class="visually-hidden" for={inputId}>
      Preference number for {name}
    </label>
    <input
      id={inputId}
      class="box tnum"
      type="number"
      inputmode="numeric"
      min="1"
      max={total}
      value={pref === 0 ? "" : pref}
      placeholder="–"
      onchange={onCommit}
    />
  </div>
  <div class="who">
    <b>{candidate}</b>
    <span class="party">{party || "Independent"}</span>
  </div>
  <div class="moves">
    <button type="button" class="mv" onclick={onup} aria-label={`Give ${name} a higher preference`}>
      ↑
    </button>
    <button
      type="button"
      class="mv"
      onclick={ondown}
      aria-label={`Give ${name} a lower preference`}
    >
      ↓
    </button>
  </div>
</li>

<style>
  .row {
    display: grid;
    grid-template-columns: 52px 1fr auto;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
    align-items: center;
  }
  .box {
    width: 48px;
    height: 46px;
    border: 2px solid var(--rule);
    border-radius: 4px;
    text-align: center;
    font-family: var(--serif);
    font-size: 20px;
    font-weight: 600;
    color: var(--ink);
    background: var(--raise);
    /* Native number spinners are inconsistent and tiny; the move buttons are the accessible path. */
    -moz-appearance: textfield;
    appearance: textfield;
  }
  .box::-webkit-outer-spin-button,
  .box::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .who b {
    display: block;
    font-family: var(--ui);
    font-size: 14.5px;
    color: var(--ink);
  }
  .party {
    font-size: 12px;
    color: var(--ink2);
    display: block;
    line-height: 1.4;
    font-family: var(--ui);
  }
  .moves {
    display: flex;
    gap: 6px;
  }
  .mv {
    width: 40px;
    height: 40px;
    border: 1.5px solid var(--rule);
    border-radius: var(--radius);
    background: var(--raise);
    color: var(--ink);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }
  .mv:hover,
  .mv:focus-visible {
    border-color: var(--ink);
  }
</style>
