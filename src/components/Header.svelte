<!-- The bar on every page: the wordmark home, the group's name, whatever the page adds, Settings. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Wordmark from './Wordmark.svelte';
  import { ui } from '../lib/ui.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';

  let { title = '', children }: { title?: string; children?: Snippet } = $props();
</script>

<header class="ah">
  <div class="in">
    <Wordmark />
    {#if title}<span class="grp">{title}</span>{/if}
    <span class="sp"></span>
    {@render children?.()}
    <ewo-settings-button label={t('settings.title')} onclick={() => (ui.settings = true)}></ewo-settings-button>
  </div>
</header>

<style>
  .ah {
    position: sticky;
    top: 0;
    z-index: 20;
    background: color-mix(in oklab, var(--m-bg) 88%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--m-line);
    padding-top: env(safe-area-inset-top);
  }

  .in {
    max-width: 1280px;
    margin: 0 auto;
    min-height: 64px;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0 max(28px, env(safe-area-inset-right)) 0 max(28px, env(safe-area-inset-left));
  }

  .grp {
    font-size: 15px;
    color: var(--m-ink-2);
    padding-left: 14px;
    border-left: 1px solid var(--m-line);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 699px) {
    .in {
      min-height: 56px;
      gap: 10px;
      padding: 0 max(16px, env(safe-area-inset-right)) 0 max(16px, env(safe-area-inset-left));
    }
    .in :global(.wm) {
      font-size: 25px;
    }
    .in :global(.wm svg) {
      width: 20px;
      height: 20px;
    }
    .grp {
      display: none;
    }
  }
</style>
