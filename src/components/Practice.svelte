<!-- The practice run's stripe, on every page of a practice group. -->
<script lang="ts">
  import { clock } from '../lib/format.ts';
  import { t } from '../lib/i18n.svelte.ts';
  let { until, host = false }: { until: number; host?: boolean } = $props();
</script>

<div class="practice" role="note">
  <b>{t('practice.badge')}</b>
  <span>{host ? t('practice.hostLine', { code: 'wichtel' }) : t('practice.line')}</span>
  <span class="sp"></span>
  <span class="hint">{t('practice.until', { time: clock(until) })}</span>
</div>
