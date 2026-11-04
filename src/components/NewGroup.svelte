<!--
  Starting a group: the party (its date is required: everything is deleted 30 days after it), the
  host's own name, the names (typed or pasted, one a line), how the draw goes, and the unseal code.
-->
<script lang="ts">
  import Header from './Header.svelte';
  import { post } from '../lib/api.ts';
  import { act, say } from '../lib/ui.svelte.ts';
  import { remember } from '../lib/known.svelte.ts';
  import { go } from '../lib/router.svelte.ts';
  import { locale, t } from '../lib/i18n.svelte.ts';
  import { longDay, parseBudget, today } from '../lib/format.ts';

  let name = $state('');
  let party = $state('');
  let time = $state('');
  let place = $state('');
  let budget = $state('');
  let note = $state('');
  let host = $state('');
  let joins = $state(true);
  let names = $state('');
  let handover = $state<'party' | 'post'>('party');
  let shape = $state<'chain' | 'any'>('chain');
  let moment = $state<'quiet' | 'live'>('quiet');
  let selfAdd = $state(true);
  let code = $state('');
  let tried = $state(false);
  let button: HTMLElement | undefined = $state();

  const list = $derived(
    names
      .split(/[\n,;]+/)
      .map((n) => n.replace(/\s+/g, ' ').trim())
      .filter(Boolean),
  );
  const fold = (s: string) => s.toLocaleLowerCase(locale());
  // The host's own name once, as the host, when they're in the draw.
  const unique = $derived(list.filter((n, i) => list.findIndex((m) => fold(m) === fold(n)) === i && !(joins && fold(n) === fold(host.trim()))));
  const count = $derived(unique.length + (joins && host.trim() ? 1 : 0));
  const cents = $derived(parseBudget(budget));
  const deleted = $derived.by(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(party)) return '';
    const d = new Date(`${party}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 30);
    return longDay(d.toISOString().slice(0, 10));
  });

  const errors = $derived({
    name: !name.trim() ? t('new.need.name') : '',
    party: !party ? t('new.need.party') : party < today() ? t('err.party') : '',
    host: !host.trim() ? t('new.need.host') : '',
    budget: Number.isNaN(cents) ? t('new.need.budget') : '',
    code: code.trim().length < 6 ? t('new.need.code') : '',
  });
  const valid = $derived(Object.values(errors).every((e) => !e));
  const show = (key: keyof typeof errors) => (tried ? errors[key] : '');

  const value = (e: Event) => (e.currentTarget as HTMLInputElement).value;

  async function submit(e: Event) {
    e.preventDefault();
    tried = true;
    if (!valid) {
      say(t('new.fix'));
      return;
    }
    const made = await act(
      button,
      () =>
        post<{ group: string; host: string; me: string | null }>('/groups', {
          name,
          party,
          time,
          place,
          budget: cents,
          note,
          handover,
          shape,
          moment,
          selfAdd,
          lang: locale(),
          host: { name: host, joins },
          names: unique,
          code,
        }),
      t('new.starting'),
    );
    if (!made) return;
    remember({ group: made.group, host: made.host, me: made.me ?? undefined, meName: joins ? host.trim() : undefined, name: name.trim(), party });
    say(t('new.started'), 'ok');
    go(`/h/${made.host}`, { replace: true });
  }
</script>

<Header title={t('new.title')} />
<main>
  <form class="grid" onsubmit={submit} novalidate>
    <div class="intro">
      <h1 class="disp">{t('new.title')}</h1>
      <p class="hint">{t('new.lead')}</p>
    </div>

    <section class="card">
      <h3>{t('new.party')}</h3>
      <ewo-field label={t('new.name')} placeholder={t('new.namePh')} value={name} maxlength="60" required error={show('name')} oninput={(e) => (name = value(e))}></ewo-field>
      <div class="two">
        <ewo-field label={t('new.date')} type="date" min={today()} value={party} required error={show('party')} oninput={(e) => (party = value(e))} onchange={(e) => (party = value(e))}></ewo-field>
        <ewo-field label={t('new.time')} type="time" value={time} hint={t('optional')} oninput={(e) => (time = value(e))} onchange={(e) => (time = value(e))}></ewo-field>
      </div>
      <ewo-field label={t('new.place')} placeholder={t('new.placePh')} value={place} maxlength="120" hint={t('optional')} oninput={(e) => (place = value(e))}></ewo-field>
      <ewo-field label={t('new.budget')} placeholder="25€" value={budget} inputmode="decimal" hint={t('new.budgetHint')} error={show('budget')} oninput={(e) => (budget = value(e))}></ewo-field>
      <ewo-field label={t('new.note')} placeholder={t('new.notePh')} value={note} multiline rows="3" autogrow maxlength="600" hint={t('optional')} oninput={(e) => (note = value(e))}></ewo-field>
      {#if deleted}<p class="hint">{t('new.deleted', { date: deleted })}</p>{/if}
    </section>

    <section class="card">
      <h3>{t('new.people')}</h3>
      <ewo-field label={t('new.you')} value={host} maxlength="40" autocomplete="given-name" required error={show('host')} oninput={(e) => (host = value(e))}></ewo-field>
      <ewo-switch row checked={joins} onchange={(e) => (joins = e.detail.checked)}>{t('new.joins')}<span slot="hint">{t('new.joinsHint')}</span></ewo-switch>
      <ewo-field label={t('new.names')} placeholder={t('new.namesPh')} value={names} multiline rows="6" autogrow hint={t('new.namesHint', { n: count })} oninput={(e) => (names = value(e))}></ewo-field>
      <ewo-switch row checked={selfAdd} onchange={(e) => (selfAdd = e.detail.checked)}>{t('new.selfAdd')}<span slot="hint">{t('new.selfAddHint')}</span></ewo-switch>
    </section>

    <section class="card">
      <h3>{t('new.draw')}</h3>
      <div class="fld">
        <span class="lbl">{t('draw.shape')}</span>
        <ewo-segmented stretch label={t('draw.shape')} value={shape} onchange={(e) => (shape = e.detail.value as typeof shape)}>
          <option value="chain">{t('draw.chain')}</option>
          <option value="any">{t('draw.any')}</option>
        </ewo-segmented>
        <p class="hint">{shape === 'chain' ? t('draw.chainHint') : t('draw.anyHint')}</p>
      </div>
      <div class="fld">
        <span class="lbl">{t('draw.moment')}</span>
        <ewo-segmented stretch label={t('draw.moment')} value={moment} onchange={(e) => (moment = e.detail.value as typeof moment)}>
          <option value="quiet">{t('draw.quiet')}</option>
          <option value="live">{t('draw.live')}</option>
        </ewo-segmented>
        <p class="hint">{moment === 'quiet' ? t('draw.quietHint') : t('draw.liveHint')}</p>
      </div>
      <div class="fld">
        <span class="lbl">{t('new.handover')}</span>
        <ewo-segmented stretch label={t('new.handover')} value={handover} onchange={(e) => (handover = e.detail.value as typeof handover)}>
          <option value="party">{t('handover.party')}</option>
          <option value="post">{t('handover.post')}</option>
        </ewo-segmented>
        <p class="hint">{t('new.handoverHint')}</p>
      </div>
    </section>

    <section class="card">
      <h3>{t('new.code')}</h3>
      <p>{t('new.codeBody')}</p>
      <ewo-field label={t('new.codeLabel')} value={code} maxlength="64" autocomplete="off" required error={show('code')} hint={t('new.codeHint')} oninput={(e) => (code = value(e))}></ewo-field>
    </section>

    <div class="submit">
      <ewo-button bind:this={button} type="submit" variant="primary" size="lg">{t('new.go')}</ewo-button>
      <p class="hint">{t('new.after')}</p>
    </div>
  </form>
</main>

<style>
  main {
    max-width: 1280px;
    margin: 0 auto;
    padding: 32px max(28px, env(safe-area-inset-right)) 64px max(28px, env(safe-area-inset-left));
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px;
    align-items: start;
  }

  .intro,
  .submit {
    grid-column: 1 / -1;
    display: grid;
    gap: 6px;
  }

  .submit {
    justify-items: start;
    gap: 10px;
    padding-top: 6px;
  }

  h1 {
    font-size: clamp(40px, 5vw, 56px);
  }

  .two {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    gap: 12px;
  }

  .fld {
    display: grid;
    gap: 6px;
  }

  @media (max-width: 859px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (max-width: 559px) {
    main {
      padding: 20px max(16px, env(safe-area-inset-right)) 48px max(16px, env(safe-area-inset-left));
    }
  }
</style>
