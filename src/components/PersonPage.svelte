<!--
  A person's own page (their personal link, kept on this device): how their gift should reach them,
  their address if by post, their wishes; after the draw the Advent door with their person behind it,
  and their gift steps. The name behind the door comes from a POST after a tap, never with the page.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Header from './Header.svelte';
  import Door from './Door.svelte';
  import Arch from './Arch.svelte';
  import Event from './Event.svelte';
  import Gone from './Gone.svelte';
  import Practice from './Practice.svelte';
  import WishList from './WishList.svelte';
  import { ApiError, post, type PersonView, type Recipient, type Wish } from '../lib/api.ts';
  import { Loader } from '../lib/loader.svelte.ts';
  import { byGroup, byKey, forget, remember } from '../lib/known.svelte.ts';
  import { linkTo } from '../lib/router.svelte.ts';
  import { act, copy, problem, say } from '../lib/ui.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { day, dayOf, price } from '../lib/format.ts';

  let { key }: { key: string } = $props();

  const data = new Loader<PersonView>(`/p/${key}`, key);
  onMount(() => data.start());
  const view = $derived(data.view);
  const me = $derived(view?.me);

  let recipient = $state<Recipient | null>(null);
  let wishesChanged = $state(false);
  let revealing = $state(false);
  let ready = $state(false);
  let posted = $state(false);
  let saved = $state('');
  let savedTimer: ReturnType<typeof setTimeout> | undefined;

  // This device remembers the group (the home's list), and forgets it once the link stops working.
  // Someone else's page opened here (the host looking as a practice colleague) doesn't replace this
  // device's own person.
  $effect(() => {
    if (view) {
      const mine = untrack(() => byGroup(view.groupKey)?.me);
      if (!mine || mine === key) remember({ group: view.groupKey, me: key, meName: view.me.name, name: view.group.name, party: view.group.party, practice: view.group.practice });
      document.title = `${view.group.name} · Wichtle`;
    }
  });
  $effect(() => {
    const entry = data.gone ? byKey(key) : null;
    if (entry) forget(entry.group, 'me');
  });

  // Opened before: the door opens again by itself on this device. A changed draw closes it.
  $effect(() => {
    if (!me || !view) return;
    if (!me.opened) {
      recipient = null;
      return;
    }
    if (!recipient && !revealing && !view.stage) void reveal(false);
  });

  async function reveal(tapped = true) {
    if (revealing) return;
    revealing = true;
    try {
      const res = await post<{ recipient: Recipient; wishesChanged: boolean; ready: boolean; posted: boolean }>(`/p/${key}/reveal`);
      recipient = res.recipient;
      wishesChanged = res.wishesChanged;
      ready = res.ready;
      posted = res.posted;
    } catch (error) {
      // The arch is still burning on a clock a little behind: try again in a moment.
      if (error instanceof ApiError && error.status === 425) setTimeout(() => void reveal(tapped), 500);
      else if (tapped) say(problem(error));
    } finally {
      revealing = false;
    }
  }

  function stageDone() {
    void reveal(false);
  }

  // A live draw this page watched opens the door by itself once it's over, also when a fresh view
  // (someone else's door opening) takes the arch away before it got to say so.
  let watched = $state(false);
  $effect(() => {
    if (view?.stage) watched = true;
    else if (watched && view?.me.inDraw) {
      watched = false;
      untrack(() => void reveal(false));
    }
  });

  async function save(body: Record<string, unknown>) {
    try {
      await post(`/p/${key}/me`, body);
      saved = t('me.saved');
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => (saved = ''), 1800);
      void data.load();
    } catch (error) {
      say(problem(error));
      void data.load();
    }
  }

  async function step(body: { ready?: boolean; posted?: boolean; arrived?: boolean }, control?: Element | null) {
    const done = await act(control, () => post(`/p/${key}/steps`, body));
    if (done) {
      if ('ready' in body) ready = !!body.ready;
      if ('posted' in body) posted = !!body.posted;
      void data.load();
    } else void data.load();
  }

  const wishes = (list: Wish[]) => save({ wishes: list });
  const doorNumber = $derived(view ? Number(view.group.party.slice(8, 10)) : 0);
  const meta = (g: PersonView['group']) => [day(g.party) + (g.time ? `, ${g.time}` : ''), g.place, g.budget !== null ? t('event.about', { price: price(g.budget) }) : ''].filter(Boolean).join(' · ');
  const joined = $derived(view ? view.people.filter((p) => p.joined).length : 0);
</script>

<Header title={view?.group.name}>
  <ewo-connection state={data.conn}></ewo-connection>
  {#if me}<span class="chip">{me.name}</span>{/if}
</Header>

{#if data.gone}
  <Gone kind="p" />
{:else if view && me}
  <main>
    {#if view.group.practice}<Practice until={view.group.deleteAt} />{/if}
    <div class="cols">
      <div class="left">
        {#if view.stage}
          <div class="intro">
            <p class="eye">{t('me.hi', { name: me.name })}</p>
            <h1 class="disp">{t('stage.title')}</h1>
            <p class="meta">{t('stage.wait')}</p>
          </div>
          <div class="stage"><Arch n={view.stage.n} until={view.stage.until} offset={data.offset} small ondone={stageDone} /></div>
        {:else if view.group.drawn && me.inDraw}
          <div class="intro">
            <p class="eye">{t('me.hi', { name: me.name })}</p>
            {#if recipient}
              <h1 class="disp">{t('me.youGive', { name: recipient.name })}</h1>
              <p class="meta">{t('me.onlyYou')}</p>
            {:else}
              <h1 class="disp">{t('me.drawn')}</h1>
              <p class="meta">{t('me.drawnMeta', { host: view.group.host || t('group.theHost') })}</p>
            {/if}
          </div>
          {#if me.changed && !recipient}<div class="banner">{t('me.changed')}</div>{/if}
          <Door n={doorNumber} open={!!recipient} name={recipient?.name ?? ''} to={t('door.to')} hint={t('door.hint')} label={t('door.label', { n: doorNumber })} busy={revealing} onopen={() => reveal(true)} />
          {#if recipient}
            <div class="rbody">
              {#if wishesChanged}<div class="banner">{t('me.wishesChanged', { name: recipient.name })}</div>{/if}
              <section class="sec">
                <h2>{t('me.wishesOf', { name: recipient.name })}</h2>
                {#if recipient.wishes.length}<WishList wishes={recipient.wishes} />{:else}<p class="hint">{t('me.noWishes', { name: recipient.name })}</p>{/if}
                {#if recipient.not}<p class="pn"><b>{t('me.not')}:</b> {recipient.not}</p>{/if}
              </section>
              {#if recipient.handover === 'post'}
                <section class="sec">
                  <h2>{t('me.byPost', { name: recipient.name })}</h2>
                  {#if recipient.address}<address class="addr">{recipient.address}</address>{:else}<p class="hint">{t('me.noAddress', { name: recipient.name })}</p>{/if}
                  <p class="hint">{t('me.addressOnly', { date: dayOf(view.group.deleteAt) })}</p>
                </section>
              {:else}
                <section class="sec"><h2>{t('me.atParty', { name: recipient.name })}</h2></section>
              {/if}
              <section class="sec">
                <h2>{t('me.steps')}</h2>
                <div class="steps">
                  <ewo-switch row checked={ready} onchange={(e) => step({ ready: e.detail.checked }, e.currentTarget as Element)}>{t('steps.ready')}<span slot="hint">{t('steps.readyHint', { host: view.group.host || t('group.theHost') })}</span></ewo-switch>
                  {#if recipient.handover === 'post'}
                    <ewo-switch row checked={posted} onchange={(e) => step({ posted: e.detail.checked }, e.currentTarget as Element)}>{t('steps.posted')}<span slot="hint">{t('steps.postedHint', { name: recipient.name })}</span></ewo-switch>
                  {/if}
                </div>
              </section>
            </div>
          {/if}
        {:else}
          <div class="intro">
            <p class="eye">{t('me.hi', { name: me.name })}</p>
            <h1 class="disp">{view.group.name}</h1>
            <p class="meta">{meta(view.group)}</p>
          </div>
          {#if view.group.drawn}<div class="banner warn">{t('me.notInDraw')}</div>{:else}<p class="lead">{t('me.waiting', { host: view.group.host || t('group.theHost'), joined, n: view.people.length })}</p>{/if}
        {/if}

        {#if view.group.drawn && me.handover === 'post'}
          <section class="sec">
            <h2>{t('me.parcel')}</h2>
            <div class="steps">
              <p class="parcel">{me.incoming ? t('me.onItsWay') : t('me.notYet')}</p>
              {#if me.incoming || me.arrived}
                <ewo-switch row checked={me.arrived} onchange={(e) => step({ arrived: e.detail.checked }, e.currentTarget as Element)}>{t('steps.arrived')}<span slot="hint">{t('steps.arrivedHint')}</span></ewo-switch>
              {/if}
            </div>
          </section>
        {/if}

        <section class="card party">
          <h3>{t('me.party')}</h3>
          <Event group={view.group} />
        </section>
      </div>

      <div class="right">
        <section class="sec">
          <div class="sec-h"><h2>{t('me.handover')}</h2><span class="sp"></span><span class="saved" aria-live="polite">{saved}</span></div>
          <ewo-segmented stretch label={t('me.handover')} value={me.handover} onchange={(e) => save({ handover: e.detail.value })}>
            <option value="party">{t('handover.party')}</option>
            <option value="post">{t('handover.post')}</option>
          </ewo-segmented>
          {#if me.handover === 'post'}
            <ewo-field label={t('me.address')} multiline rows="4" autogrow maxlength="300" value={me.address} placeholder={t('me.addressPh')} hint={t('me.addressHint')} onchange={(e) => e.target === e.currentTarget && save({ address: e.currentTarget.value })}></ewo-field>
          {/if}
        </section>

        <section class="sec">
          <h2>{t('me.wishes')}</h2>
          <WishList wishes={me.wishes} edit onchange={wishes} />
          <ewo-field label={t('me.not')} value={me.not} maxlength="200" placeholder={t('me.notPh')} onchange={(e) => e.target === e.currentTarget && save({ not: e.currentTarget.value })}></ewo-field>
          <p class="hint">{t('me.wishesHint')}</p>
        </section>

        <section class="sec">
          <h2>{t('me.link')}</h2>
          <p class="hint">{t('me.linkHint')}</p>
          <div class="linkrow"><code>{linkTo('p', key)}</code><ewo-button size="sm" onclick={() => copy(linkTo('p', key), t('copy.done'))}>{t('copy.link')}</ewo-button></div>
        </section>

        <section class="sec">
          <h2>{t('me.who', { joined, n: view.people.length })}</h2>
          <ul class="who">
            {#each view.people as p (p.id)}<li class:on={p.joined}><span class="mk" class:on={p.joined}></span>{p.name}</li>{/each}
          </ul>
          <p class="hint">{t('group.deleted', { date: dayOf(view.group.deleteAt) })}</p>
        </section>
      </div>
    </div>
  </main>
{:else if data.failed}
  <main><ewo-empty heading={t('err.offline')} variant="dashed"><ewo-button slot="actions" onclick={() => data.load()}>{t('retry')}</ewo-button></ewo-empty></main>
{/if}

<style>
  main {
    max-width: 1280px;
    margin: 0 auto;
    padding: 24px max(28px, env(safe-area-inset-right)) 64px max(28px, env(safe-area-inset-left));
    display: grid;
    gap: 16px;
  }

  .chip {
    font-size: 13.5px;
    font-weight: 700;
    padding: 3px 12px;
    border-radius: 999px;
    background: var(--m-sunk);
    color: var(--m-ink-2);
    max-width: 30vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    gap: 40px;
    align-items: start;
  }

  .left,
  .right {
    display: grid;
    gap: 22px;
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
    font-size: clamp(34px, 4vw, 50px);
    line-height: 1.02;
    overflow-wrap: anywhere;
  }

  .meta,
  .lead {
    font-size: 15.5px;
    color: var(--m-ink-2);
  }

  .stage {
    display: grid;
    place-items: center;
    padding: 10px 0;
  }

  .rbody {
    display: grid;
    gap: 22px;
    animation: rise 0.5s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
  }

  .sec {
    display: grid;
    gap: 10px;
  }

  .sec h2 {
    font-size: 17px;
    font-weight: 700;
  }

  .sec-h {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .saved {
    font-size: 13px;
    color: var(--m-ink-3);
  }

  .pn {
    font-size: 15px;
  }

  .pn b {
    font-weight: 700;
  }

  .addr {
    font-style: normal;
    font-size: 15.5px;
    line-height: 1.5;
    white-space: pre-line;
    padding: 12px 16px;
    border-radius: var(--m-r);
    background: var(--m-card);
    border: 1px solid var(--m-line);
  }

  .steps {
    display: grid;
    gap: 4px;
    padding: 6px 16px;
    border-radius: var(--m-r);
    background: var(--m-card);
    border: 1px solid var(--m-line);
  }

  .parcel {
    font-weight: 700;
    padding: 8px 0 4px;
  }

  .who {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    font-size: 14.5px;
    color: var(--m-ink-3);
  }

  .who li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .who li.on {
    color: var(--m-ink);
  }

  @media (max-width: 859px) {
    .cols {
      grid-template-columns: minmax(0, 1fr);
      gap: 28px;
    }
  }

  @media (max-width: 559px) {
    main {
      padding: 16px max(16px, env(safe-area-inset-right)) 48px max(16px, env(safe-area-inset-left));
    }
  }
</style>
