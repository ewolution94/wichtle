<!--
  A person's own page (their personal link, kept on this device). It opens with where they stand and
  the one thing to do now: add wishes, wait for the draw, open the door; then, beside the open door,
  their person's wishes, rather-nots and address with the gift's switches. On the side what's
  theirs (wishes, rather-nots, how their gift reaches them) as a summary, edited in a sheet that
  saves each change and says so; the party, their link, who's in. The name behind the door comes
  from a POST after a tap, never with the page.
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
  import RoleTabs from './RoleTabs.svelte';
  import Steps from './Steps.svelte';
  import Now from './Now.svelte';
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

  // What changed is saved at once; each section says so beside its own heading ("Saving…", then
  // "Saved" for a few seconds), right where the change was made.
  type Part = 'handover' | 'wishes' | 'not';
  let status = $state<Record<Part, '' | 'saving' | 'saved'>>({ handover: '', wishes: '', not: '' });
  const timers: Partial<Record<Part, ReturnType<typeof setTimeout>>> = {};

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

  async function save(part: Part, body: Record<string, unknown>) {
    clearTimeout(timers[part]);
    status[part] = 'saving';
    try {
      await post(`/p/${key}/me`, body);
      status[part] = 'saved';
      timers[part] = setTimeout(() => (status[part] = ''), 2600);
      await data.load();
      return true;
    } catch (error) {
      status[part] = '';
      say(problem(error));
      void data.load();
      return false;
    }
  }

  // The address is typed, so it has a Save button while it differs from what's saved; leaving the
  // field saves it too.
  let address = $state<string | null>(null);
  const addressDirty = $derived(!!me && address !== null && address !== me.address);
  let addressSending = '';
  async function saveAddress() {
    if (!me || address === null || address === me.address || address === addressSending) return;
    const value = address;
    addressSending = value;
    if (await save('handover', { address: value })) {
      if (address === value) address = null;
    }
    addressSending = '';
  }

  async function step(body: { ready?: boolean; posted?: boolean; arrived?: boolean }, control?: Element | null) {
    const done = await act(control, () => post(`/p/${key}/steps`, body));
    if (done) {
      if ('ready' in body) ready = !!body.ready;
      if ('posted' in body) posted = !!body.posted;
      void data.load();
    } else void data.load();
  }

  const wishes = (list: Wish[]) => save('wishes', { wishes: list });
  const nots = (list: Wish[]) => save('not', { not: list.map((w) => w.t) });
  const asWishes = (list: string[]) => list.map((w) => ({ t: w, l: '' }));
  // A host who takes part too, on this device: the tabs to their host page.
  const own = $derived(view ? byGroup(view.groupKey) : undefined);
  const doorNumber = $derived(view ? Number(view.group.party.slice(8, 10)) : 0);
  const joined = $derived(view ? view.people.filter((p) => p.joined).length : 0);
  const host = $derived(view?.group.host || t('group.theHost'));

  // ---- where this person stands: the step line and the one thing to do now ----

  const inDraw = $derived(!!view?.group.drawn && !!me?.inDraw);
  const byPost = $derived(recipient?.handover === 'post');
  const pnow = $derived.by(() => {
    if (!view || !me) return 0;
    if (!view.group.drawn) return me.wishes.length ? 2 : 1;
    if (!me.inDraw) return 2;
    if (!recipient) return 3;
    if (!ready) return 4;
    return byPost && posted ? 6 : 5;
  });
  const psteps = $derived.by(() => {
    if (!view || !me) return [];
    return [
      { label: t('pstep.name') },
      { label: t('pstep.wishes'), sub: me.wishes.length ? t('pstep.wishesN', { n: me.wishes.length }) : t('optional') },
      { label: t('pstep.draw'), sub: view.group.drawn ? '' : host },
      { label: t('pstep.door') },
      { label: t('pstep.gift'), sub: recipient ? t('pstep.for', { name: recipient.name }) : '' },
      byPost ? { label: t('pstep.post') } : { label: t('pstep.party'), sub: day(view.group.party) },
    ];
  });
  const giftTitle = $derived(!recipient ? '' : !ready ? t('pnow.gift', { name: recipient.name }) : byPost ? (posted ? t('pnow.posted', { name: recipient.name }) : t('pnow.post', { name: recipient.name })) : t('pnow.bring'));
  const giftBody = $derived.by(() => {
    if (!view || !recipient) return '';
    const parts = [recipient.budget !== null ? t('pnow.budget', { price: price(recipient.budget) }) : '', byPost ? t('pnow.byPost') : t('pnow.atParty', { date: day(view.group.party) }), t('me.onlyYou')];
    return parts.filter(Boolean).join(' ');
  });

  // ---- my own wishes, rather-nots and how my gift reaches me: a summary, edited in a sheet ----

  let editing = $state(false);
  function closeEdit() {
    if (addressDirty) void saveAddress();
    editing = false;
  }
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
    {#if own?.host && own.me === key}<RoleTabs host={own.host} me={key} current="me" />{/if}

    <h1 class="vh">{recipient ? t('me.youGive', { name: recipient.name }) : `${t('me.hi', { name: me.name })}: ${view.group.name}`}</h1>
    <Steps label={t('pstep.label')} items={psteps} now={pnow} />

    <div class="cols">
      <div class="left">
        {#if view.stage}
          <Now eye={t('me.hi', { name: me.name })} title={t('stage.title')}>
            <p class="body">{t('stage.wait')}</p>
            <div class="stage"><Arch n={view.stage.n} until={view.stage.until} offset={data.offset} small ondone={stageDone} /></div>
          </Now>
        {:else if inDraw}
          {#if me.changed && !recipient}<div class="banner">{t('me.changed')}</div>{/if}
          <div class="a-door">
            <Door n={doorNumber} open={!!recipient} name={recipient?.name ?? ''} to={t('door.to')} hint={t('door.hint')} label={t('door.label', { n: doorNumber })} busy={revealing} onopen={() => reveal(true)} />
            {#if recipient}
              <div class="rbody">
                <Now title={giftTitle}>
                  <p class="body">{giftBody}</p>
                  {#if wishesChanged}<div class="banner">{t('me.wishesChanged', { name: recipient.name })}</div>{/if}
                  <h3 class="sub-h">{t('me.wishesOf', { name: recipient.name })}</h3>
                  {#if recipient.wishes.length}<WishList wishes={recipient.wishes} />{:else}<p class="hint">{t('me.noWishes', { name: recipient.name })}</p>{/if}
                  {#if recipient.not.length}<p class="pn"><b>{t('me.not')}:</b> {recipient.not.join(' · ')}</p>{/if}
                  {#if byPost}
                    <h3 class="sub-h">{t('me.byPost', { name: recipient.name })}</h3>
                    {#if recipient.address}<address class="addr">{recipient.address}</address>{:else}<p class="hint">{t('me.noAddress', { name: recipient.name })}</p>{/if}
                    <p class="hint">{t('me.addressOnly', { date: dayOf(view.group.deleteAt) })}</p>
                  {/if}
                  <div class="gift">
                    <ewo-switch row checked={ready} onchange={(e) => step({ ready: e.detail.checked }, e.currentTarget as Element)}>{t('steps.ready')}<span slot="hint">{t('steps.readyHint', { host })}</span></ewo-switch>
                    {#if byPost}
                      <ewo-switch row checked={posted} onchange={(e) => step({ posted: e.detail.checked }, e.currentTarget as Element)}>{t('steps.posted')}<span slot="hint">{t('steps.postedHint', { name: recipient.name })}</span></ewo-switch>
                    {/if}
                  </div>
                </Now>
              </div>
            {:else}
              <Now title={t('me.drawn')}>
                <p class="body">{t('me.drawnMeta', { host })}</p>
              </Now>
            {/if}
          </div>
        {:else if view.group.drawn}
          <Now title={t('pnow.out')}>
            <p class="body">{t('me.notInDraw')}</p>
          </Now>
        {:else if !me.wishes.length}
          <Now title={t('pnow.wishes')}>
            <p class="body">{t('pnow.wishesBody', { host, joined, all: view.people.length })}</p>
            <div class="acts"><ewo-button variant="primary" size="lg" onclick={() => (editing = true)}>{t('pnow.wishesAdd')}</ewo-button></div>
          </Now>
        {:else}
          <Now title={t('pnow.wait')}>
            <p class="body">{t('pnow.waitBody', { host, joined, all: view.people.length })}</p>
          </Now>
        {/if}
      </div>

      <div class="right">
        <section class="sec mine">
          <div class="sec-h"><h2 class="disp">{t('me.mineTitle')}</h2><ewo-button size="sm" onclick={() => (editing = true)}>{t('me.edit')}</ewo-button></div>
          <dl class="sum">
            <dt>{t('me.sumWishes')}</dt>
            <dd>{#if me.wishes.length}<WishList wishes={me.wishes} />{:else}<span class="hint">{t('me.noneYet')}</span>{/if}</dd>
            <dt>{t('me.not')}</dt>
            <dd>{#if me.not.length}{me.not.join(' · ')}{:else}<span class="hint">{t('me.noneYet')}</span>{/if}</dd>
            <dt>{t('me.handover')}</dt>
            <dd>
              {me.handover === 'post' ? t('handover.post') : t('handover.party')}
              {#if me.handover === 'post'}
                {#if me.address}<address class="addr small">{me.address}</address>{:else}<span class="hint warn-t">{t('me.noAddressYet')}</span>{/if}
              {/if}
            </dd>
          </dl>
          <p class="hint">{t('me.mineHint')}</p>
        </section>

        {#if view.group.drawn && me.handover === 'post'}
          <section class="sec">
            <h2 class="disp">{t('me.parcel')}</h2>
            <div class="gift">
              <p class="parcel">{me.incoming ? t('me.onItsWay') : t('me.notYet')}</p>
              {#if me.incoming || me.arrived}
                <ewo-switch row checked={me.arrived} onchange={(e) => step({ arrived: e.detail.checked }, e.currentTarget as Element)}>{t('steps.arrived')}<span slot="hint">{t('steps.arrivedHint')}</span></ewo-switch>
              {/if}
            </div>
          </section>
        {/if}

        <section class="sec">
          <h2 class="disp">{t('me.party')}</h2>
          <Event group={view.group} />
        </section>

        <section class="sec">
          <h2 class="disp">{t('me.link')}</h2>
          <p class="hint">{t('me.linkHint')}</p>
          <div class="linkrow"><code>{linkTo('p', key)}</code><ewo-button size="sm" onclick={() => copy(linkTo('p', key), t('copy.done'))}>{t('copy.link')}</ewo-button></div>
        </section>

        <section class="sec">
          <h2 class="disp">{t('me.who', { joined, n: view.people.length })}</h2>
          <ul class="who">
            {#each view.people as p (p.id)}<li class:on={p.joined}><span class="mk" class:on={p.joined}></span>{p.name}</li>{/each}
          </ul>
          <p class="hint">{t('group.deleted', { date: dayOf(view.group.deleteAt) })}</p>
        </section>
      </div>
    </div>
  </main>

  <!-- My wishes, rather-nots and how my gift reaches me: each saved as it changes, and says so -->
  <ewo-sheet open={editing} label={t('me.editTitle')} oncancel={closeEdit} onclose={closeEdit}>
    <span slot="heading" class="disp sheet-h">{t('me.editTitle')}</span>
    <div class="edit">
      <section class="sec">
        <div class="sec-h"><h2>{t('me.wishes')}</h2>{@render state('wishes')}</div>
        <p class="hint">{t('me.wishesHint')}</p>
        <WishList wishes={me.wishes} edit onchange={wishes} />
      </section>

      <section class="sec">
        <div class="sec-h"><h2>{t('me.not')}</h2>{@render state('not')}</div>
        <WishList kind="not" wishes={asWishes(me.not)} edit onchange={nots} />
      </section>

      <section class="sec">
        <div class="sec-h"><h2>{t('me.handover')}</h2>{@render state('handover')}</div>
        <ewo-segmented stretch label={t('me.handover')} value={me.handover} onchange={(e) => save('handover', { handover: e.detail.value })}>
          <option value="party">{t('handover.party')}</option>
          <option value="post">{t('handover.post')}</option>
        </ewo-segmented>
        {#if me.handover === 'post'}
          <ewo-field
            label={t('me.address')}
            multiline
            rows="4"
            autogrow
            maxlength="300"
            value={address ?? me.address}
            placeholder={t('me.addressPh')}
            hint={t('me.addressHint')}
            oninput={(e) => (address = e.currentTarget.value)}
            onchange={(e) => e.target === e.currentTarget && saveAddress()}
          ></ewo-field>
          {#if addressDirty}
            <div class="save-row"><ewo-button size="sm" variant="primary" onclick={saveAddress}>{t('me.addressSave')}</ewo-button></div>
          {/if}
        {/if}
      </section>

      <ewo-button variant="primary" stretch onclick={closeEdit}>{t('me.done')}</ewo-button>
    </div>
  </ewo-sheet>
{:else if data.failed}
  <main><ewo-empty heading={t('err.offline')} variant="dashed"><ewo-button slot="actions" onclick={() => data.load()}>{t('retry')}</ewo-button></ewo-empty></main>
{/if}

{#snippet state(part: Part)}
  <span class="saved" class:on={status[part] === 'saved'} aria-live="polite">
    {#if status[part] === 'saving'}
      {t('me.saving')}
    {:else if status[part] === 'saved'}
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>{t('me.saved')}
    {/if}
  </span>
{/snippet}

<style>
  main {
    max-width: 1280px;
    margin: 0 auto;
    padding: 24px max(28px, env(safe-area-inset-right)) 64px max(28px, env(safe-area-inset-left));
    display: grid;
    gap: 18px;
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

  /* The next step (and the door) on the left; what's mine and the party on the right, without boxes. */
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
    gap: 36px;
    align-items: start;
  }

  .left,
  .right {
    display: grid;
    gap: 18px;
    min-width: 0;
  }

  .body {
    font-size: 16px;
    color: var(--m-ink-2);
    max-width: 62ch;
  }

  .stage {
    display: grid;
    place-items: center;
    padding: 10px 0;
  }

  .a-door {
    display: grid;
    grid-template-columns: 280px minmax(0, 1fr);
    gap: 28px;
    align-items: start;
  }

  .rbody {
    display: grid;
    min-width: 0;
    animation: rise 0.5s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
  }

  .sub-h {
    font-size: 17px;
    font-weight: 700;
    margin-top: 4px;
  }

  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
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
    background: var(--m-sunk);
  }

  .addr.small {
    margin-top: 6px;
    padding: 8px 12px;
    font-size: 14.5px;
  }

  /* The gift's switches: one quiet panel, like a row of ticks. */
  .gift {
    display: grid;
    gap: 4px;
    padding: 6px 16px;
    border-radius: var(--m-r);
    background: var(--m-sunk);
  }

  .parcel {
    font-weight: 700;
    padding: 8px 0 4px;
  }

  .sec {
    display: grid;
    gap: 10px;
    min-width: 0;
  }

  .right .sec + .sec {
    border-top: 1px solid var(--m-line);
    padding-top: 18px;
  }

  .right .sec h2 {
    font-size: 24px;
  }

  .sec-h {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .sec-h h2 {
    flex: 1;
    min-width: 0;
  }

  .sum {
    margin: 0;
    display: grid;
    gap: 4px;
    font-size: 15px;
  }

  .sum dt {
    margin-top: 6px;
    font-size: 12.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--m-ink-3);
  }

  .sum dt:first-child {
    margin-top: 0;
  }

  .sum dd {
    margin: 0;
    min-width: 0;
  }

  .warn-t {
    color: var(--m-warn);
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

  .sheet-h {
    font-size: 28px;
  }

  .edit {
    display: grid;
    gap: 24px;
  }

  .edit .sec h2 {
    font-size: 17px;
    font-weight: 700;
  }

  /* Beside the heading of what just changed: a calm "Saving…", then a green "Saved" that fades. */
  .saved {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 26px;
    font-size: 13.5px;
    font-weight: 700;
    color: var(--m-ink-3);
    white-space: nowrap;
  }

  .saved.on {
    padding: 0 10px 0 8px;
    border-radius: 999px;
    color: var(--ewo-ok);
    background: color-mix(in oklab, var(--ewo-ok) 13%, var(--m-card));
    animation: saved 2.6s ease both;
  }

  .saved svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  @keyframes saved {
    0% {
      opacity: 0;
      transform: translateY(3px);
    }
    8%,
    80% {
      opacity: 1;
      transform: none;
    }
    100% {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .saved.on {
      animation: none;
    }
  }

  .save-row {
    display: flex;
    justify-content: flex-end;
    margin-top: -4px;
  }

  @media (max-width: 959px) {
    .cols {
      grid-template-columns: minmax(0, 1fr);
      gap: 28px;
    }
  }

  /* The door above its card on a narrow screen. */
  @media (max-width: 679px) {
    .a-door {
      grid-template-columns: minmax(0, 1fr);
      gap: 4px;
    }
  }

  @media (max-width: 559px) {
    main {
      padding: 16px max(16px, env(safe-area-inset-right)) 48px max(16px, env(safe-area-inset-left));
    }
  }
</style>
