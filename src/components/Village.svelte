<!--
  The paper-cut village: a house per person, a household one wider house, each window lit once its
  person has joined (or, after the draw, opened their door). The houses shrink to fit the street and
  take a second or third street for a big group; below the size where names stay readable they go,
  and the house keeps its name for screen readers and as a tooltip. On the host's page before the
  draw the houses are buttons: pick two or more to make a household.
-->
<script lang="ts">
  import { HEIGHTS, HILLS, starPoints } from '../lib/paper.ts';

  export interface Unit {
    key: string;
    ids: string[];
    names: string[];
    lit: boolean[];
  }

  let {
    units,
    label,
    selectable = false,
    selected = new Set<string>(),
    compact = false,
    onpick,
  }: {
    units: Unit[];
    label: string;
    selectable?: boolean;
    selected?: Set<string>;
    compact?: boolean;
    onpick?: (unit: Unit) => void;
  } = $props();

  let width = $state(800);
  const natural = (u: Unit) => 16 + 44 * u.ids.length;

  /** The streets: as few as keep the houses at 62 % or more of their size. */
  const layout = $derived.by(() => {
    const room = Math.max(200, width - 32);
    const total = units.reduce((sum, u) => sum + natural(u) + 10, 0);
    let rows = 1;
    while (rows < 4 && room / (total / rows) < 0.62) rows++;
    const scale = Math.min(compact ? 0.82 : 1, room / (total / rows));
    const streets: Unit[][] = [];
    const per = total / rows;
    let street: Unit[] = [];
    let used = 0;
    for (const u of units) {
      if (street.length && used + natural(u) > per * 1.04 && streets.length < rows - 1) {
        streets.push(street);
        street = [];
        used = 0;
      }
      street.push(u);
      used += natural(u) + 10;
    }
    if (street.length) streets.push(street);
    return { streets, scale: Math.max(0.42, scale), names: scale >= 0.74 };
  });

  const nameOf = (u: Unit) => u.names.join(' & ');
</script>

<div class="vil" class:compact bind:clientWidth={width} role="group" aria-label={label} style="--s:{layout.scale}">
  <svg class="back" viewBox="0 0 848 160" preserveAspectRatio="none" aria-hidden="true">{@html HILLS}</svg>
  <svg class="star" viewBox="-12 -12 24 24" aria-hidden="true"><polygon points={starPoints(8, 11.5, 4.6)} /></svg>
  <div class="streets">
    {#each layout.streets as street, row (row)}
      <div class="street" class:names={layout.names}>
        <div class="houses">
          {#each street as u (u.key)}
            {@const index = units.indexOf(u)}
            {@const sel = u.ids.some((id) => selected.has(id))}
            {#if selectable}
              <button
                type="button"
                class="plain hs"
                class:sel
                class:step={index % 3 === 1}
                style="--w:{natural(u)}px; --hgt:{HEIGHTS[index % HEIGHTS.length]}px"
                aria-pressed={sel}
                title={nameOf(u)}
                onclick={() => onpick?.(u)}
              >
                <span class="roof"></span>
                <span class="body">
                  <span class="wins">{#each u.lit as on, w (w)}<i class="win" class:lit={on}></i>{/each}</span>
                  <i class="door"></i>
                </span>
                <span class="nm">{nameOf(u)}</span>
              </button>
            {:else}
              <span class="hs" class:step={index % 3 === 1} style="--w:{natural(u)}px; --hgt:{HEIGHTS[index % HEIGHTS.length]}px" title={nameOf(u)} role="img" aria-label={nameOf(u)}>
                <span class="roof"></span>
                <span class="body">
                  <span class="wins">{#each u.lit as on, w (w)}<i class="win" class:lit={on}></i>{/each}</span>
                  <i class="door"></i>
                </span>
                <span class="nm" aria-hidden="true">{nameOf(u)}</span>
              </span>
            {/if}
          {/each}
        </div>
        <div class="ground"></div>
      </div>
    {/each}
  </div>
</div>

<style>
  .vil {
    position: relative;
    border-radius: var(--m-r);
    overflow: hidden;
    background: linear-gradient(var(--m-sky-1), var(--m-sky-2));
    border: 1px solid var(--m-line);
    padding-top: 56px;
    min-height: 262px;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }

  .vil.compact {
    min-height: 196px;
    padding-top: 40px;
  }

  .back {
    position: absolute;
    left: 0;
    right: 0;
    top: 20px;
    width: 100%;
    height: 150px;
  }

  .compact .back {
    height: 110px;
  }

  .back :global(.c2) {
    fill: var(--m-cut-2);
  }

  .back :global(.c3) {
    fill: var(--m-cut-3);
  }

  .star {
    position: absolute;
    right: 34px;
    top: 18px;
    width: 46px;
    height: 46px;
    fill: var(--m-star);
  }

  .streets {
    position: relative;
    display: grid;
  }

  .street {
    display: grid;
  }

  .houses {
    display: flex;
    justify-content: center;
    align-items: flex-end;
    gap: calc(10px * var(--s));
    padding: 0 16px;
  }

  .street.names .houses {
    padding-bottom: 0;
  }

  .ground {
    height: calc(31px * var(--s));
    min-height: 14px;
    background: var(--m-cut);
  }

  .street + .street {
    margin-top: -2px;
  }

  .hs {
    position: relative;
    width: calc(var(--w) * var(--s));
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .roof {
    width: 100%;
    height: calc(32px * var(--s));
    background: var(--m-cut);
    clip-path: polygon(50% 0, 100% 100%, 0 100%);
  }

  .hs.step .roof {
    height: calc(40px * var(--s));
    width: 86%;
    clip-path: polygon(0 100%, 0 72%, 14% 72%, 14% 46%, 28% 46%, 28% 22%, 40% 22%, 40% 0, 60% 0, 60% 22%, 72% 22%, 72% 46%, 86% 46%, 86% 72%, 100% 72%, 100% 100%);
  }

  .body {
    width: 86%;
    height: calc(var(--hgt) * var(--s));
    background: var(--m-cut);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    padding-top: calc(10px * var(--s));
  }

  .wins {
    display: flex;
    gap: calc(10px * var(--s));
  }

  .win {
    position: relative;
    width: calc(17px * var(--s));
    height: calc(21px * var(--s));
    border-radius: 9px 9px 0 0;
    background: var(--m-win);
    overflow: hidden;
    transition:
      background 0.4s,
      box-shadow 0.4s;
  }

  .win::before {
    content: '';
    position: absolute;
    left: 50%;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--m-cut);
  }

  .win::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 48%;
    height: 2px;
    background: var(--m-cut);
  }

  .win.lit {
    background: var(--m-glow);
    box-shadow: 0 0 14px 4px var(--m-glow-sh);
    overflow: visible;
  }

  .door {
    width: calc(15px * var(--s));
    height: calc(23px * var(--s));
    border-radius: 8px 8px 0 0;
    background: var(--m-win);
  }

  .nm {
    display: none;
  }

  .names .nm {
    display: block;
    position: absolute;
    bottom: -24px;
    left: 50%;
    transform: translateX(-50%);
    white-space: nowrap;
    font: 500 14px/1 var(--m-body);
    letter-spacing: 0.03em;
    color: var(--m-paper-ink);
    z-index: 1;
    max-width: calc(var(--w) * var(--s) + 8px);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .names .houses {
    margin-bottom: 0;
  }

  /* The names stand on the ground strip: it's tall enough for them at full size. */
  .street.names .ground {
    height: 31px;
  }

  button.hs:focus-visible {
    outline: var(--ewo-focus);
    outline-offset: 4px;
    border-radius: 4px;
  }

  .hs.sel .roof,
  .hs.sel .body,
  .hs.sel .win::before,
  .hs.sel .win::after {
    background-color: var(--m-accent);
  }

  .hs.sel .win:not(.lit),
  .hs.sel .door {
    background: var(--m-win);
  }

  @media (hover: hover) {
    button.hs:hover .body,
    button.hs:hover .roof {
      filter: brightness(1.15);
    }
  }
</style>
