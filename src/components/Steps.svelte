<!--
  Where the group (or one person) stands: six steps on a line, the done ones ticked, the current one
  lit, each with a short word under it ("7 of 9"). Read at a glance; nothing in it is a control.
-->
<script lang="ts">
  import { t } from '../lib/i18n.svelte.ts';

  let { label, items, now }: { label: string; items: { label: string; sub?: string }[]; now: number } = $props();
</script>

<ol class="steps" aria-label={label} style:--p={Math.min(now, items.length - 1) / (items.length - 1)} style:--n={items.length}>
  {#each items as s, i (i)}
    <li class:done={i < now} class:now={i === now} aria-current={i === now ? 'step' : undefined}>
      <i aria-hidden="true">
        {#if i < now}<svg viewBox="0 0 12 12"><path d="M2.5 6.3 5 8.6l4.6-5" /></svg>{/if}
      </i>
      <b>{s.label}</b>
      {#if s.sub}<span class="sub">{s.sub}</span>{/if}
      {#if i < now}<span class="vh">{t('steps.done')}</span>{/if}
    </li>
  {/each}
</ol>

<style>
  .steps {
    position: relative;
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    grid-template-columns: repeat(var(--n), minmax(0, 1fr));
  }

  /* The line from the first dot to the last, and the stretch walked so far over it. */
  .steps::before,
  .steps::after {
    content: '';
    position: absolute;
    top: 10px;
    left: calc(50% / var(--n));
    height: 2px;
    border-radius: 2px;
  }

  .steps::before {
    right: calc(50% / var(--n));
    background: var(--ewo-line-strong);
  }

  .steps::after {
    width: calc((100% - 100% / var(--n)) * var(--p));
    background: var(--m-invert);
  }

  li {
    position: relative;
    z-index: 1;
    display: grid;
    justify-items: center;
    align-content: start;
    gap: 2px;
    min-width: 0;
    text-align: center;
    line-height: 1.25;
  }

  i {
    width: 22px;
    height: 22px;
    margin-bottom: 4px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--m-bg);
    border: 2px solid var(--ewo-line-strong);
  }

  svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: var(--m-invert-ink);
    stroke-width: 2.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .done i {
    background: var(--m-invert);
    border-color: var(--m-invert);
  }

  .now i {
    background: var(--m-accent);
    border-color: var(--m-accent);
    box-shadow: 0 0 0 5px color-mix(in oklab, var(--m-accent) 20%, transparent);
  }

  b {
    font-size: 14px;
    font-weight: 700;
    color: var(--m-ink-2);
    max-width: 100%;
    overflow-wrap: anywhere;
  }

  li:not(.done, .now) b {
    font-weight: 500;
    color: var(--m-ink-3);
  }

  .now b {
    color: var(--m-accent);
  }

  .sub {
    font-size: 12.5px;
    color: var(--m-ink-3);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* On a phone the words under the dots go; the step's name stays. */
  @media (max-width: 559px) {
    b {
      font-size: 12px;
    }
    .sub {
      display: none;
    }
  }
</style>
