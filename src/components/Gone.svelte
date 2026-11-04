<!-- A link that stopped working: the group was deleted, or the host reset this claim or made a new host link. -->
<script lang="ts">
  import { link } from '../lib/router.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';
  let { kind }: { kind: 'g' | 'h' | 'p' } = $props();
</script>

<main class="gone">
  <ewo-empty heading={t('gone.title')} variant="dashed">
    {kind === 'p' ? t('gone.p') : kind === 'h' ? t('gone.h') : t('gone.g')}
    <ewo-button slot="actions" variant="primary" href="/" onclick={link('/')}>{t('missing.home')}</ewo-button>
  </ewo-empty>
</main>

<style>
  .gone {
    max-width: 620px;
    margin: 0 auto;
    padding: 64px max(16px, env(safe-area-inset-right)) 48px max(16px, env(safe-area-inset-left));
  }
</style>
