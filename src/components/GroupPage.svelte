<!--
  The group link, the one in the group chat: the party, the village, and the names to claim. A claim is
  a tap and a confirm, never a page load (messengers fetch links for their previews); this device then
  keeps that person's own link. Someone missing adds themselves (if the host allows it, until the
  draw); a host who lost their page gets a new host link here with the unseal code.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import Header from './Header.svelte';
  import Village, { type Unit } from './Village.svelte';
  import Event from './Event.svelte';
  import Gone from './Gone.svelte';
  import Practice from './Practice.svelte';
  import { post, type GroupView, type Roll } from '../lib/api.ts';
  import { Loader } from '../lib/loader.svelte.ts';
  import { byGroup, remember } from '../lib/known.svelte.ts';
  import { go, link } from '../lib/router.svelte.ts';
  import { act, say } from '../lib/ui.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { dayOf, day, price } from '../lib/format.ts';

  let { key }: { key: string } = $props();

  const data = new Loader<GroupView>(`/g/${key}`, key);
  onMount(() => data.start());

  const view = $derived(data.view);
  const mine = $derived(byGroup(key));
  const units = $derived<Unit[]>((view?.people ?? []).map((p) => ({ key: p.id, ids: [p.id], names: [p.name], lit: [p.joined] })));

  let picked = $state<Roll | null>(null);
  let claimButton: HTMLElement | undefined = $state();
  let missing = $state(false);
  let newName = $state('');
  let joinButton: HTMLElement | undefined = $state();
  let hostOpen = $state(false);
  let code = $state('');
  let recoverButton: HTMLElement | undefined = $state();

  $effect(() => {
    if (view) document.title = `${view.group.name} · Wichtle`;
  });

  async function claim() {
    if (!picked || !view) return;
    const who = picked;
    const res = await act(claimButton, () => post<{ me: string }>(`/g/${key}/claim`, { id: who.id }));
    picked = null;
    if (!res) return void data.load();
    remember({ group: key, me: res.me, meName: who.name, name: view.group.name, party: view.group.party, practice: view.group.practice });
    go(`/p/${res.me}`);
  }

  async function join(e: SubmitEvent) {
    e.preventDefault();
    if (!view || !newName.trim()) return;
    const name = newName.trim();
    const res = await act(joinButton, () => post<{ me: string }>(`/g/${key}/join`, { name }));
    if (!res) return;
    remember({ group: key, me: res.me, meName: name, name: view.group.name, party: view.group.party, practice: view.group.practice });
    go(`/p/${res.me}`);
  }

  async function recover(e: SubmitEvent) {
    e.preventDefault();
    if (!view) return;
    const res = await act(recoverButton, () => post<{ host: string }>(`/g/${key}/recover`, { code }));
    if (!res) return;
    remember({ group: key, host: res.host, name: view.group.name, party: view.group.party, practice: view.group.practice });
    hostOpen = false;
    say(t('recover.done'), 'ok');
    go(`/h/${res.host}`);
  }

  const meta = (g: GroupView['group']) => [day(g.party) + (g.time ? `, ${g.time}` : ''), g.place, g.budget !== null ? t('event.about', { price: price(g.budget) }) : ''].filter(Boolean).join(' · ');
</script>

<Header title={view?.group.name}>
  <ewo-connection state={data.conn}></ewo-connection>
</Header>

{#if data.gone}
  <Gone kind="g" />
{:else if view}
  <main>
    {#if view.group.practice}<Practice until={view.group.deleteAt} />{/if}
    {#if mine?.me}
      <div class="banner back">
        <span>{t('group.back', { name: mine.meName ?? '' })}</span>
        <ewo-button size="sm" variant="primary" href={`/p/${mine.me}`} onclick={link(`/p/${mine.me}`)}>{t('group.open')}</ewo-button>
      </div>
    {/if}
    {#if view.group.drawn}<div class="banner">{t('group.drawn')}</div>{/if}

    <div class="cols">
      <div class="left">
        <div class="intro">
          {#if view.group.host}<p class="eye">{t('group.invites', { name: view.group.host })}</p>{/if}
          <h1 class="disp">{view.group.name}</h1>
          <p class="meta">{meta(view.group)}</p>
        </div>
        <Village {units} label={t('village.label')} compact />
        <div class="card"><Event group={view.group} /></div>
      </div>

      <section class="right">
        <h2>{t('group.who')}</h2>
        <ul class="claim">
          {#each view.people as p (p.id)}
            <li>
              <button type="button" class="plain cl" class:taken={p.joined} disabled={p.joined} onclick={() => (picked = p)}>
                <span class="cn">{p.name}</span>
                <span class="cs">{p.joined ? t('group.joined') : t('group.tap')}</span>
              </button>
            </li>
          {/each}
        </ul>
        {#if view.group.selfAdd}
          {#if missing}
            <form class="join" onsubmit={join}>
              <ewo-field label={t('group.yourName')} value={newName} maxlength="40" autocomplete="given-name" required oninput={(e) => (newName = e.currentTarget.value)}></ewo-field>
              <ewo-button bind:this={joinButton} type="submit" variant="primary">{t('group.join')}</ewo-button>
            </form>
          {:else}
            <button type="button" class="plain miss" onclick={() => (missing = true)}>{t('group.missing')}</button>
          {/if}
        {:else}
          <p class="hint">{t('group.askHost', { name: view.group.host || t('group.theHost') })}</p>
        {/if}
        <p class="hint">{t('group.remembers')}</p>
        <p class="hint">{t('group.deleted', { date: dayOf(view.group.deleteAt) })}</p>
        <button type="button" class="plain hostlink" onclick={() => (hostOpen = true)}>{t('group.hostLost')}</button>
      </section>
    </div>
  </main>
{:else if data.failed}
  <main><ewo-empty heading={t('err.offline')} variant="dashed"><ewo-button slot="actions" onclick={() => data.load()}>{t('retry')}</ewo-button></ewo-empty></main>
{/if}

<ewo-sheet open={!!picked} label={t('claim.title', { name: picked?.name ?? '' })} oncancel={() => (picked = null)} onclose={() => (picked = null)}>
  <span slot="heading" class="disp sheet-h">{t('claim.title', { name: picked?.name ?? '' })}</span>
  <div class="form">
    <p>{t('claim.body', { name: picked?.name ?? '' })}</p>
    <ewo-button bind:this={claimButton} variant="primary" stretch onclick={claim}>{t('claim.yes', { name: picked?.name ?? '' })}</ewo-button>
    <ewo-button variant="quiet" stretch onclick={() => (picked = null)}>{t('claim.no')}</ewo-button>
  </div>
</ewo-sheet>

<ewo-sheet open={hostOpen} label={t('recover.title')} oncancel={() => (hostOpen = false)} onclose={() => (hostOpen = false)}>
  <span slot="heading" class="disp sheet-h">{t('recover.title')}</span>
  <form class="form" onsubmit={recover}>
    <p>{t('recover.body')}</p>
    <ewo-field label={t('recover.code')} value={code} autocomplete="off" required oninput={(e) => (code = e.currentTarget.value)}></ewo-field>
    <ewo-button bind:this={recoverButton} type="submit" variant="primary" stretch>{t('recover.go')}</ewo-button>
    <p class="hint">{t('recover.hint')}</p>
  </form>
</ewo-sheet>

<style>
  main {
    max-width: 1280px;
    margin: 0 auto;
    padding: 24px max(28px, env(safe-area-inset-right)) 64px max(28px, env(safe-area-inset-left));
    display: grid;
    gap: 16px;
  }

  .back {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
    gap: 32px;
    align-items: start;
  }

  .left,
  .right {
    display: grid;
    gap: 16px;
    min-width: 0;
  }

  .intro {
    display: grid;
    gap: 6px;
  }

  .eye {
    font-size: 15px;
    color: var(--m-ink-2);
    font-weight: 500;
  }

  h1 {
    font-size: clamp(36px, 4.4vw, 52px);
    line-height: 1;
    overflow-wrap: anywhere;
  }

  .meta {
    font-size: 15px;
    color: var(--m-ink-2);
  }

  h2 {
    font-size: 19px;
    font-weight: 700;
  }

  .claim {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 6px;
  }

  .cl {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 16px;
    border-radius: var(--m-r);
    background: var(--m-card);
    border: 1px solid var(--m-line);
  }

  .cl::before {
    content: '';
    width: 18px;
    height: 22px;
    flex: none;
    background: var(--m-cut);
    clip-path: polygon(50% 0, 100% 38%, 100% 100%, 0 100%, 0 38%);
  }

  .cl.taken::before {
    background: radial-gradient(circle at 50% 66%, var(--m-glow) 0 3.5px, var(--m-cut) 4px);
  }

  .cl:not(:disabled):hover {
    border-color: color-mix(in oklab, var(--m-accent) 50%, transparent);
  }

  .cn {
    font-weight: 700;
    font-size: 16px;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .cs {
    margin-left: auto;
    font-size: 13.5px;
    color: var(--m-accent);
    font-weight: 700;
    white-space: nowrap;
  }

  .cl.taken {
    background: transparent;
    cursor: default;
  }

  .cl.taken .cn {
    color: var(--m-ink-2);
    font-weight: 500;
  }

  .cl.taken .cs {
    color: var(--m-ink-3);
    font-weight: 500;
  }

  .miss,
  .hostlink {
    justify-self: start;
    font-size: 15px;
    font-weight: 700;
    color: var(--m-accent);
    padding: 4px 0;
  }

  .hostlink {
    font-size: 13.5px;
    font-weight: 500;
    color: var(--m-ink-3);
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .join {
    display: grid;
    gap: 10px;
    justify-items: start;
  }

  .sheet-h {
    font-size: 28px;
  }

  .form {
    display: grid;
    gap: 12px;
  }

  @media (max-width: 859px) {
    .cols {
      grid-template-columns: minmax(0, 1fr);
      gap: 24px;
    }
  }

  @media (max-width: 559px) {
    main {
      padding: 16px max(16px, env(safe-area-inset-right)) 48px max(16px, env(safe-area-inset-left));
    }
  }
</style>
