<script lang="ts">
  import { loadStateMap, type StateMap } from "$lib/maps";
  import { MAP_LICENCE_NAME, MAP_LICENCE_NOTICE, MAP_LICENCE_URL } from "$lib/mapLicence";
  import { stateName } from "$lib/data";
  import { isMapAvailable } from "$lib/governance";

  let {
    electionId,
    stateCode,
    electorate,
  }: { electionId: string; stateCode: string; electorate: string } = $props();

  let map = $state<StateMap | null>(null);

  $effect(() => {
    let live = true;
    map = null;
    // Fail-closed map kill switch: a suspended (or tampered) <electionId>/<STATE> map is
    // simply not loaded — the text confirmation stands alone, exactly as for a missing file.
    if (!isMapAvailable(`${electionId}/${stateCode.toUpperCase()}`)) return;
    loadStateMap(electionId, stateCode).then(
      (m) => {
        if (live) map = m;
      },
      () => {
        /* offline-before-first-cache or missing file: the text confirmation stands alone */
      },
    );
    return () => {
      live = false;
    };
  });

  const chosen = $derived(map?.divisions.find((d) => d.name === electorate) ?? null);
  const W = $derived(map?.viewBox[0] ?? 0);
  const H = $derived(map?.viewBox[1] ?? 0);

  /**
   * Inner-metro divisions are invisible at state scale, so they get an atlas-style inset:
   * a square window around the division, wide enough to show neighbours and the nearest
   * city marker. Placed over whichever bottom corner is farther from the division.
   */
  const inset = $derived.by(() => {
    if (!map || !chosen) return null;
    const [bx, by, bw, bh] = chosen.bbox;
    const span = Math.max(bw, bh);
    if (span >= W * 0.12) return null;
    const size = Math.max(span * 4.5, W * 0.07);
    const cx = bx + bw / 2;
    const cy = by + bh / 2;
    const x = Math.min(Math.max(cx - size / 2, 0), W - size);
    const y = Math.min(Math.max(cy - size / 2, 0), H - size);
    return { x, y, size, cx, cy, left: cx > W / 2 };
  });

  const insetCities = $derived(
    map && inset
      ? map.cities.filter(
          (c) =>
            c.x > inset.x &&
            c.x < inset.x + inset.size &&
            c.y > inset.y &&
            c.y < inset.y + inset.size,
        )
      : [],
  );

  // A large division filled solid ink would dominate the page; hatch is the brand's device
  // for big areas, solid fill for small ones (which read as a mark, not a mass).
  const bigChosen = $derived(chosen ? Math.max(chosen.bbox[2], chosen.bbox[3]) > W * 0.18 : false);

  // Type sizes in viewBox units so labels track the rendered map size like print.
  const label = $derived(W * 0.022);
  const insetLabel = $derived(inset ? inset.size * 0.09 : 0);

  // Cap the rendered height so the confirm button stays above the fold on tall states
  // (WA, QLD, NT); width follows from the aspect ratio.
  const frameWidth = $derived(H > 0 ? `min(100%, calc(44vh * ${(W / H).toFixed(4)}))` : "100%");
</script>

{#if map && chosen}
  <figure class="map ui">
    <div class="frame" style:aspect-ratio={`${W} / ${H}`} style:width={frameWidth}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Map of ${stateName(stateCode)} with the ${electorate} electorate marked`}
      >
        {#if bigChosen}
          <defs>
            <pattern
              id="hatch-main"
              patternUnits="userSpaceOnUse"
              width={W / 110}
              height={W / 110}
              patternTransform="rotate(45)"
            >
              <line y2={W / 110} class="hatch-line" stroke-width={W / 550} />
            </pattern>
          </defs>
        {/if}
        <g class="divisions">
          {#each map.divisions as d (d.name)}
            <path d={d.path} vector-effect="non-scaling-stroke" />
          {/each}
        </g>
        <path
          class="chosen"
          class:hatched-main={bigChosen}
          d={chosen.path}
          vector-effect="non-scaling-stroke"
        />
        {#if inset}
          <circle
            class="locator"
            cx={inset.cx}
            cy={inset.cy}
            r={Math.max(inset.size * 0.35, W * 0.02)}
            vector-effect="non-scaling-stroke"
          />
        {/if}
        <g class="cities">
          {#each map.cities as c (c.name)}
            <circle cx={c.x} cy={c.y} r={W * 0.004} />
            <text
              x={c.x + (c.x > W * 0.72 ? -W * 0.009 : W * 0.009)}
              y={c.y + label * 0.35}
              text-anchor={c.x > W * 0.72 ? "end" : "start"}
              font-size={label}>{c.name}</text
            >
          {/each}
        </g>
      </svg>

      {#if inset}
        <svg
          class="inset"
          class:left={inset.left}
          viewBox={`${inset.x} ${inset.y} ${inset.size} ${inset.size}`}
          aria-hidden="true"
        >
          <defs>
            <pattern
              id="hatch"
              patternUnits="userSpaceOnUse"
              width={inset.size / 28}
              height={inset.size / 28}
              patternTransform="rotate(45)"
            >
              <rect width={inset.size / 28} height={inset.size / 28} class="hatch-bg" />
              <line y2={inset.size / 28} class="hatch-line" stroke-width={inset.size / 140} />
            </pattern>
          </defs>
          <g class="divisions">
            {#each map.divisions as d (d.name)}
              <path d={d.path} vector-effect="non-scaling-stroke" />
            {/each}
          </g>
          <path
            class="chosen hatched"
            d={chosen.path}
            fill="url(#hatch)"
            vector-effect="non-scaling-stroke"
          />
          <g class="cities">
            {#each insetCities as c (c.name)}
              <circle cx={c.x} cy={c.y} r={inset.size * 0.008} />
              <text x={c.x + inset.size * 0.015} y={c.y + insetLabel * 0.35} font-size={insetLabel}
                >{c.name}</text
              >
            {/each}
          </g>
        </svg>
      {/if}
    </div>
    <figcaption>
      <span class="credit">{map.attribution}</span>
      <details class="licence">
        <summary>Map data and licence</summary>
        <div class="notice">
          {#each MAP_LICENCE_NOTICE as line (line)}
            <p>{line}</p>
          {/each}
          <p>
            <a href={MAP_LICENCE_URL} target="_blank" rel="noreferrer noopener"
              >{MAP_LICENCE_NAME}</a
            >
          </p>
        </div>
      </details>
    </figcaption>
  </figure>
{/if}

<style>
  .map {
    margin: 18px 0 0;
  }
  .frame {
    position: relative;
    margin-inline: auto;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .divisions path {
    fill: var(--wash);
    stroke: var(--line2);
    stroke-width: 1;
    stroke-linejoin: round;
  }
  .chosen {
    fill: var(--ink);
    stroke: var(--rule);
    stroke-width: 1.5;
    stroke-linejoin: round;
  }
  .chosen.hatched {
    fill: url(#hatch);
  }
  .chosen.hatched-main {
    fill: url(#hatch-main);
  }
  .hatch-bg {
    fill: var(--raise);
  }
  .hatch-line {
    stroke: var(--ink);
  }
  .locator {
    fill: none;
    stroke: var(--rule);
    stroke-width: 1.5;
    stroke-dasharray: 4 3;
  }
  .cities circle {
    fill: var(--ink2);
  }
  .cities text {
    fill: var(--ink2);
    font-family: var(--ui);
    letter-spacing: 0.04em;
    /* paper halo keeps labels legible where they cross boundaries or the chosen fill */
    paint-order: stroke;
    stroke: var(--paper);
    stroke-width: 3px;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .inset {
    position: absolute;
    right: 2%;
    bottom: 2%;
    width: 42%;
    height: auto;
    aspect-ratio: 1;
    background: var(--raise);
    border: 1.5px solid var(--rule);
    border-radius: var(--radius-box);
  }
  .inset.left {
    right: auto;
    left: 2%;
  }
  figcaption {
    font-size: 10.5px;
    color: var(--ink3);
    margin-top: 6px;
  }
  figcaption .credit {
    display: block;
  }
  /* The AEC Spatial Data Download licence requires the full prescribed derivative-product notice
     wherever the boundary geometry is shown; a disclosure keeps it adjacent to every map without
     crowding the confirmation screen. <details>/<summary> is natively keyboard-operable. */
  .licence {
    margin-top: 2px;
  }
  .licence summary {
    cursor: pointer;
    color: var(--ink2);
  }
  .licence summary:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
    border-radius: 2px;
  }
  .licence .notice {
    margin-top: 4px;
    max-width: 62ch;
  }
  .licence .notice p {
    margin: 0 0 4px;
  }
  .licence .notice a {
    color: var(--ink2);
  }
</style>
