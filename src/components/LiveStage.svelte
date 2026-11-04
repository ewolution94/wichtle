<!--
  The live draw on the host's screen (the laptop on the call or the shared screen): the candle arch
  lights one candle per person, then every open page opens its door at once.
-->
<script lang="ts">
  import Arch from './Arch.svelte';
  import { t } from '../lib/i18n.svelte.ts';

  let { n, until, offset, onclose }: { n: number; until: number; offset: number; onclose: () => void } = $props();
  let done = $state(false);
</script>

<div class="stage" class:done role="dialog" aria-modal="true" aria-label={t('stage.title')}>
  <p class="cap">{t('stage.drawing', { n })}</p>
  <Arch {n} {until} {offset} ondone={() => (done = true)} />
  <div class="end" aria-live="polite">
    {#if done}
      <h2 class="disp">{t('stage.done')}</h2>
      <p>{t('stage.doneBody')}</p>
      <ewo-button variant="primary" onclick={onclose}>{t('stage.back')}</ewo-button>
    {/if}
  </div>
</div>

<style>
  .stage {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: var(--m-stage);
    color: var(--m-ink);
    display: grid;
    grid-template-rows: auto 1fr auto;
    justify-items: center;
    align-items: center;
    gap: 12px;
    padding: max(28px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(36px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left));
  }

  .cap {
    font-size: 17px;
    color: var(--m-ink-2);
    letter-spacing: 0.02em;
  }

  .end {
    min-height: 150px;
    display: grid;
    justify-items: center;
    align-content: start;
    gap: 10px;
    text-align: center;
    max-width: 560px;
  }

  .end h2 {
    font-size: 52px;
    line-height: 1;
    animation: rise 0.5s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }

  .end p {
    color: var(--m-ink-2);
    font-size: 16px;
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
</style>
