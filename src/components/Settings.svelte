<!--
  Settings, the family's way (Folio's ewo-sheet, General first with ewo-settings-basics), then what's
  kept where.
-->
<script lang="ts">
  import { ui } from '../lib/ui.svelte.ts';
  import { theme, type ThemePreference } from '../lib/theme.svelte.ts';
  import { i18n, setLanguage, t, type LangChoice } from '../lib/i18n.svelte.ts';

  let shown = $state(false);
  $effect(() => {
    if (ui.settings) shown = true;
  });
</script>

<ewo-sheet open={ui.settings} label={t('settings.title')} oncancel={() => (ui.settings = false)} onclose={() => ((shown = false), (ui.settings = false))}>
  <span slot="heading" class="heading"><b class="disp">{t('settings.title')}</b><span>{t('settings.line')}</span></span>
  {#if shown}
    <section>
      <h3 class="lbl">{t('settings.general')}</h3>
      <ewo-settings-basics
        language={i18n.choice}
        theme={theme.preference}
        onlanguage-change={(e) => setLanguage(e.detail.value as LangChoice)}
        ontheme-change={(e) => theme.set(e.detail.value as ThemePreference)}
      ></ewo-settings-basics>
    </section>
    <p class="privacy">{t('settings.privacy')}</p>
    <p class="privacy">{t('settings.deleted')}</p>
  {/if}
</ewo-sheet>

<style>
  .heading {
    display: grid;
  }

  .heading b {
    font-size: 30px;
    line-height: 1;
  }

  .heading span {
    font-size: 13px;
    color: var(--m-ink-2);
    margin-top: 4px;
  }

  section {
    display: grid;
    gap: 6px;
    padding-bottom: 16px;
  }

  .privacy {
    font-size: 14px;
    color: var(--m-ink-2);
    padding: 4px 0 8px;
  }
</style>
