<!--
  The live draw's candle arch, one candle per person, lit one after another on the server's clock: the
  draw is made before the first candle, and when the last has burnt a moment every open page opens its
  door at once. `until` is when (server time), `offset` how far this device's clock is off.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { arch } from '../lib/paper.ts';

  const PER = 280;
  const TAIL = 2200;

  let { n, until, offset = 0, small = false, ondone }: { n: number; until: number; offset?: number; small?: boolean; ondone?: () => void } = $props();

  let lit = $state(0);
  let done = $state(false);
  let frame = 0;

  const tick = () => {
    const now = Date.now() + offset;
    const start = until - n * PER - TAIL;
    lit = Math.max(0, Math.min(n, Math.floor((now - start) / PER) + 1));
    if (now >= until) {
      if (!done) {
        done = true;
        ondone?.();
      }
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  onDestroy(() => cancelAnimationFrame(frame));

  let svg = $derived(arch(n));
  let box: HTMLDivElement | undefined = $state();
  $effect(() => {
    const candles = box?.querySelectorAll('.cd');
    candles?.forEach((c, i) => c.classList.toggle('lit', i < lit));
  });
</script>

<div class="stagebox" class:small class:all={lit >= n} bind:this={box}>{@html svg}</div>

<style>
  .stagebox {
    width: min(900px, 100%);
  }

  .stagebox :global(.arch) {
    width: 100%;
    height: auto;
    display: block;
    transition: filter 0.6s;
  }

  .stagebox :global(.c1) {
    fill: var(--m-cut);
  }

  .stagebox :global(.cb) {
    fill: var(--m-door);
    stroke: var(--m-cut);
    stroke-width: 1.5;
  }

  .stagebox :global(.fl) {
    fill: var(--m-glow);
    opacity: 0;
    transition: opacity 0.35s;
    transform-box: fill-box;
    transform-origin: 50% 100%;
  }

  .stagebox :global(.cd.lit .fl) {
    opacity: 1;
    animation: flick 1.1s ease-in-out infinite alternate;
    filter: drop-shadow(0 0 7px var(--m-glow));
  }

  .all :global(.arch) {
    filter: drop-shadow(0 0 26px var(--m-glow-sh));
  }

  @keyframes -global-flick {
    from {
      transform: scaleY(1) skewX(0);
    }
    to {
      transform: scaleY(1.12) skewX(3deg);
    }
  }
</style>
