<!-- The party's details: when, where, the budget and the host's note. -->
<script lang="ts">
  import type { Details } from '../lib/api.ts';
  import { longDay, price } from '../lib/format.ts';
  import { t } from '../lib/i18n.svelte.ts';
  let { group }: { group: Details } = $props();
</script>

<dl class="dl">
  <dt>{t('event.when')}</dt>
  <dd>{longDay(group.party)}{#if group.time}, {group.time}{/if}</dd>
  {#if group.place}<dt>{t('event.where')}</dt><dd>{group.place}</dd>{/if}
  {#if group.budget !== null}<dt>{t('event.budget')}</dt><dd>{t('event.about', { price: price(group.budget) })}</dd>{/if}
  {#if group.note}<dt>{t('event.note')}</dt><dd>{group.note}</dd>{/if}
</dl>
