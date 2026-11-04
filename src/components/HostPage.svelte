<!--
  The host's page (the host link, kept on this device): who has joined, households (pick houses in the
  village to tie them together), how the draw goes and the draw itself; after it who has opened their
  door and got their gift ready, never who drew whom. Names can still come and go after the draw:
  either the draw is fitted (only the people next to them change) or everyone draws again. Host tools
  hold the unseal (every pair, address and wish for 30 minutes, with the code), the log, the code, a
  new host link and deleting the group.
-->
<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import Header from './Header.svelte';
  import Village, { type Unit } from './Village.svelte';
  import Event from './Event.svelte';
  import Gone from './Gone.svelte';
  import Practice from './Practice.svelte';
  import LiveStage from './LiveStage.svelte';
  import WishList from './WishList.svelte';
  import { ApiError, post, type HostPerson, type HostView, type LogLine } from '../lib/api.ts';
  import { Loader } from '../lib/loader.svelte.ts';
  import { byGroup, byKey, forget, remember } from '../lib/known.svelte.ts';
  import { go, link, linkTo } from '../lib/router.svelte.ts';
  import { act, copy, say } from '../lib/ui.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { clock, day, dayOf, list, parseBudget, price, stamp, today } from '../lib/format.ts';

  let { key }: { key: string } = $props();

  // The unseal: a token from the code, sent with every load while it lasts (30 minutes, in memory).
  let token = $state('');
  let tokenUntil = $state(0);
  let sealTimer: ReturnType<typeof setTimeout> | undefined;

  const data = new Loader<HostView>(`/h/${key}`, key, (): Record<string, string> => (token ? { 'x-unseal': token } : {}));
  onMount(() => data.start());
  onDestroy(() => clearTimeout(sealTimer));

  const view = $derived(data.view);
  const g = $derived(view?.group);
  const drawn = $derived(!!view?.draw);
  const mine = $derived(view ? byGroup(view.groupKey) : undefined);
  const inside = $derived(view?.unsealed ?? null);

  $effect(() => {
    if (!view) return;
    remember({ group: view.groupKey, host: key, name: view.group.name, party: view.group.party, practice: view.group.practice });
    document.title = `${view.group.name} · Wichtle`;
  });
  $effect(() => {
    const entry = data.gone ? byKey(key) : null;
    if (entry?.host === key) forget(entry.group, 'host');
  });

  // ---- the village and households ----

  const units = $derived.by<Unit[]>(() => {
    if (!view) return [];
    const byId = new Map(view.people.map((p) => [p.id, p]));
    const done = new Set<string>();
    const out: Unit[] = [];
    const lit = (p: HostPerson) => (drawn ? p.opened : p.joined);
    for (const p of view.people) {
      if (done.has(p.id)) continue;
      const house = view.households.find((h) => h.includes(p.id));
      const members = (house ?? [p.id]).map((id) => byId.get(id)).filter((x): x is HostPerson => !!x);
      members.forEach((m) => done.add(m.id));
      out.push({ key: members.map((m) => m.id).join('+'), ids: members.map((m) => m.id), names: members.map((m) => m.name), lit: members.map(lit) });
    }
    return out;
  });

  let picked = $state<Set<string>>(new Set());
  const pickedUnits = $derived(units.filter((u) => u.ids.some((id) => picked.has(id))));
  const canTie = $derived(pickedUnits.length >= 2);
  const canUntie = $derived(pickedUnits.some((u) => u.ids.length > 1));

  function pick(u: Unit) {
    const next = new Set(picked);
    const on = u.ids.some((id) => next.has(id));
    for (const id of u.ids) on ? next.delete(id) : next.add(id);
    picked = next;
  }

  async function households(next: string[][], control: Element | null | undefined, redraw = false) {
    try {
      await post(`/h/${key}/households`, { households: next, redraw });
      picked = new Set();
      say(t('house.saved'), 'ok');
      void data.load();
    } catch (error) {
      if (error instanceof ApiError && error.body.error === 'redraw') {
        ask = {
          title: t('house.redrawTitle'),
          body: t('house.redrawBody'),
          options: [{ label: t('house.redrawYes'), variant: 'primary', run: (c) => households(next, c, true) }],
        };
        return;
      }
      await act(control, () => Promise.reject(error));
    }
  }

  let tieButton: HTMLElement | undefined = $state();
  let untieButton: HTMLElement | undefined = $state();
  const tie = () => {
    if (!view) return;
    const ids = pickedUnits.flatMap((u) => u.ids);
    void households([...view.households.filter((h) => !h.some((id) => ids.includes(id))), ids], tieButton);
  };
  const untie = () => {
    if (!view) return;
    const ids = new Set(pickedUnits.flatMap((u) => u.ids));
    void households(
      view.households.filter((h) => !h.some((id) => ids.has(id))),
      untieButton,
    );
  };

  // ---- asking first ----

  type Option = { label: string; variant?: 'primary' | 'danger'; run: (control: Element | null) => Promise<unknown> | void };
  let ask = $state<{ title: string; body: string; options: Option[] } | null>(null);
  let asking = $state(false);

  async function answer(o: Option, e: MouseEvent) {
    const control = e.currentTarget as Element;
    asking = true;
    try {
      await o.run(control);
    } finally {
      asking = false;
      ask = null;
    }
  }

  // ---- people ----

  let person = $state<HostPerson | null>(null);
  let renameTo = $state('');
  let renameButton: HTMLElement | undefined = $state();
  const personInside = $derived(person && inside ? inside.people.find((p) => p.id === person!.id) : undefined);
  const givesTo = (id: string) => inside?.pairs.find((p) => p.giver === id)?.to ?? '';

  function openPerson(p: HostPerson) {
    person = p;
    renameTo = p.name;
  }

  async function rename(e: SubmitEvent) {
    e.preventDefault();
    if (!person || !renameTo.trim() || renameTo.trim() === person.name) return;
    const done = await act(renameButton, () => post(`/h/${key}/rename`, { id: person!.id, name: renameTo.trim() }));
    if (!done) return;
    say(t('person.renamed'), 'ok');
    person = null;
    void data.load();
  }

  function resetClaim(p: HostPerson) {
    person = null;
    ask = {
      title: t('person.resetTitle', { name: p.name }),
      body: t('person.resetBody', { name: p.name }),
      options: [
        {
          label: t('person.resetYes'),
          variant: 'primary',
          run: async (c) => {
            if (await act(c, () => post(`/h/${key}/reset`, { id: p.id }))) {
              say(t('person.resetDone', { name: p.name }), 'ok');
              person = null;
              void data.load();
            }
          },
        },
      ],
    };
  }

  function remove(p: HostPerson) {
    const run = (mode?: 'patch' | 'redraw') => async (c: Element | null) => {
      const res = await act(c, () => post<{ changes: number; redrawn: boolean }>(`/h/${key}/remove`, { id: p.id, mode }));
      if (!res) return;
      person = null;
      say(res.redrawn ? t('person.removedRedrawn', { name: p.name }) : drawn ? t('person.removedPatched', { name: p.name, n: res.changes }) : t('person.removed', { name: p.name }), 'ok');
      void data.load();
    };
    person = null;
    ask = drawn
      ? {
          title: t('person.removeTitle', { name: p.name }),
          body: t('person.removeDrawn', { name: p.name }),
          options: [
            { label: t('person.removePatch'), variant: 'primary', run: run('patch') },
            { label: t('person.removeRedraw'), run: run('redraw') },
          ],
        }
      : {
          title: t('person.removeTitle', { name: p.name }),
          body: p.joined ? t('person.removeJoined', { name: p.name }) : t('person.removeBody', { name: p.name }),
          options: [{ label: t('person.removeYes'), variant: 'danger', run: run() }],
        };
  }

  // ---- adding names ----

  let names = $state('');
  let addButton: HTMLElement | undefined = $state();
  let addRedrawButton: HTMLElement | undefined = $state();
  const toAdd = $derived(
    names
      .split(/[\n,;]+/)
      .map((n) => n.replace(/\s+/g, ' ').trim())
      .filter(Boolean),
  );

  async function add(mode: 'patch' | 'redraw' | undefined, control: HTMLElement | undefined) {
    if (!toAdd.length) return;
    const res = await act(control, () => post<{ changes: number; redrawn: boolean }>(`/h/${key}/add`, { names: toAdd, mode }));
    if (!res) return;
    say(res.redrawn ? t('add.redrawn', { n: toAdd.length }) : drawn ? t('add.patched', { n: res.changes }) : t('add.done', { n: toAdd.length }), 'ok');
    names = '';
    void data.load();
  }

  // ---- the draw ----

  let drawButton: HTMLElement | undefined = $state();
  let sure = $state(false);
  let stageClosed = $state(0);
  // A live draw's stage, kept once seen: the server stops reporting it once its clock runs out (and
  // every door that opens fetches the view again), but the host's screen stays on "Drawn!" until closed.
  let stage = $state<{ until: number; n: number } | null>(null);
  $effect(() => {
    const s = view?.stage;
    if (s && s.until !== stageClosed && s.until !== untrack(() => stage?.until)) stage = s;
  });
  const joined = $derived(view ? view.people.filter((p) => p.joined).length : 0);
  const opened = $derived(view ? view.people.filter((p) => p.opened).length : 0);
  const ready = $derived(view ? view.people.filter((p) => p.ready).length : 0);
  const anyPost = $derived(!!view?.people.some((p) => p.handover === 'post'));

  async function setting(body: Record<string, unknown>) {
    try {
      await post(`/h/${key}/settings`, body);
    } catch (error) {
      await act(null, () => Promise.reject(error));
    }
    void data.load();
  }

  async function makeDraw() {
    const res = await act(drawButton, () => post<{ stage: { until: number; n: number } | null }>(`/h/${key}/draw`), t('draw.drawing'));
    sure = false;
    if (!res) return;
    if (res.stage) stage = res.stage;
    else say(t('draw.done'), 'ok');
    void data.load();
  }

  function redraw() {
    ask = {
      title: t('drawn.redrawTitle'),
      body: t('drawn.redrawBody'),
      options: [
        {
          label: t('drawn.redrawYes'),
          variant: 'danger',
          run: async (c) => {
            if (await act(c, () => post(`/h/${key}/redraw`))) {
              say(t('drawn.redrawn'), 'ok');
              void data.load();
            }
          },
        },
      ],
    };
  }

  const checkText = $derived.by(() => {
    const c = view?.check;
    if (!c || c.ok) return '';
    if (c.reason === 'few') return t('draw.few');
    const house = view!.households[c.household ?? -1] ?? [];
    const who = house.map((id) => view!.people.find((p) => p.id === id)?.name ?? '').filter(Boolean);
    return t('draw.household', { names: list(who) });
  });

  // ---- invite and remind ----

  const reminder = $derived.by(() => {
    if (!view) return '';
    const link = linkTo('g', view.groupKey);
    const names = (ps: HostPerson[]) => list(ps.map((p) => p.name));
    if (!drawn) {
      const missing = view.people.filter((p) => !p.joined);
      return missing.length ? t('remind.join', { group: view.group.name, names: names(missing), link }) : '';
    }
    const closed = view.people.filter((p) => !p.opened);
    if (closed.length) return t('remind.open', { group: view.group.name, names: names(closed), link });
    const waiting = view.people.filter((p) => !p.ready);
    return waiting.length ? t('remind.ready', { group: view.group.name, names: names(waiting), date: day(view.group.party) }) : '';
  });

  // ---- the party's details ----

  let editing = $state(false);
  let edit = $state({ name: '', party: '', time: '', place: '', budget: '', note: '', handover: 'post' as 'party' | 'post', selfAdd: true });
  let editButton: HTMLElement | undefined = $state();
  const editCents = $derived(parseBudget(edit.budget));

  function openEdit() {
    if (!g) return;
    edit = {
      name: g.name,
      party: g.party,
      time: g.time,
      place: g.place,
      budget: g.budget === null ? '' : price(g.budget),
      note: g.note,
      handover: g.handover,
      selfAdd: g.selfAdd,
    };
    editing = true;
  }

  async function saveEdit(e: SubmitEvent) {
    e.preventDefault();
    if (!edit.name.trim() || !edit.party || Number.isNaN(editCents)) return say(t('new.fix'));
    const body = { ...edit, budget: editCents };
    if (await act(editButton, () => post(`/h/${key}/settings`, body))) {
      editing = false;
      say(t('edit.saved'), 'ok');
      void data.load();
    }
  }

  // ---- host tools ----

  let tools = $state(false);
  let code = $state('');
  let unsealButton: HTMLElement | undefined = $state();
  let oldCode = $state('');
  let nextCode = $state('');
  let codeButton: HTMLElement | undefined = $state();
  let codeOpen = $state(false);

  async function unseal(e: SubmitEvent) {
    e.preventDefault();
    const res = await act(unsealButton, () => post<{ token: string; until: number }>(`/h/${key}/unseal`, { code }));
    if (!res) return;
    token = res.token;
    tokenUntil = res.until;
    code = '';
    tools = false;
    clearTimeout(sealTimer);
    sealTimer = setTimeout(() => seal(false), Math.max(0, res.until - (Date.now() + data.offset)));
    void data.load();
  }

  async function seal(tell = true) {
    const was = token;
    token = '';
    tokenUntil = 0;
    clearTimeout(sealTimer);
    if (was) post(`/h/${key}/seal`, { token: was }).catch(() => {});
    if (tell) say(t('tools.sealed'), 'ok');
    void data.load();
  }

  async function changeCode(e: SubmitEvent) {
    e.preventDefault();
    if (nextCode.trim().length < 6) return say(t('new.need.code'));
    if (await act(codeButton, () => post(`/h/${key}/code`, { old: oldCode, next: nextCode }))) {
      oldCode = nextCode = '';
      codeOpen = false;
      token = '';
      say(t('tools.codeChanged'), 'ok');
      void data.load();
    }
  }

  function rekey() {
    ask = {
      title: t('tools.rekeyTitle'),
      body: t('tools.rekeyBody'),
      options: [
        {
          label: t('tools.rekeyYes'),
          variant: 'primary',
          run: async (c) => {
            const res = await act(c, () => post<{ host: string }>(`/h/${key}/rekey`));
            if (!res || !view) return;
            remember({ group: view.groupKey, host: res.host });
            tools = false;
            say(t('tools.rekeyed'), 'ok');
            go(`/h/${res.host}`, { replace: true });
          },
        },
      ],
    };
  }

  function remove_group() {
    ask = {
      title: t('tools.deleteTitle'),
      body: t('tools.deleteBody'),
      options: [
        {
          label: t('tools.deleteYes'),
          variant: 'danger',
          run: async (c) => {
            if (!view) return;
            const group = view.groupKey;
            const res = await act(c, () => post(`/h/${key}/delete`).then(() => true));
            if (!res) return;
            forget(group);
            tools = false;
            say(t('tools.deleted'), 'ok');
            go('/', { replace: true });
          },
        },
      ],
    };
  }

  const logLine = (l: LogLine) => {
    const words: Record<string, string> = {
      created: t('log.created', { n: l.n ?? '' }),
      claim: t('log.claim', { n: l.n ?? '' }),
      join: t('log.join', { n: l.n ?? '' }),
      added: t('log.added', { n: l.n ?? '' }),
      removed: t('log.removed', { n: l.n ?? '' }),
      renamed: t('log.renamed', { n: l.n ?? '', to: l.to ?? '' }),
      reset: t('log.reset', { n: l.n ?? '' }),
      households: t('log.households'),
      drawn: l.live ? t('log.drawnLive') : t('log.drawn'),
      redrawn: t('log.redrawn'),
      patched: t('log.patched', { n: l.c ?? 0 }),
      unseal: t('log.unseal'),
      locked: t('log.locked'),
      code: t('log.code'),
      rekey: t('log.rekey'),
      recover: t('log.recover'),
    };
    return words[l.t] ?? l.t;
  };

  const meta = (d: HostView['group']) => [day(d.party) + (d.time ? `, ${d.time}` : ''), d.place, d.budget !== null ? t('event.about', { price: price(d.budget) }) : ''].filter(Boolean).join(' · ');
  const handoverWord = (h: HostPerson['handover']) => (h === 'post' ? t('handover.postShort') : t('handover.partyShort'));
</script>

<Header title={view?.group.name}>
  <ewo-connection state={data.conn}></ewo-connection>
  {#if view}
    <span class="chip">{t('host.chip')}</span>
    <ewo-button size="sm" onclick={() => (tools = true)}>{t('tools.open')}</ewo-button>
  {/if}
</Header>

{#if data.gone}
  <Gone kind="h" />
{:else if view && g}
  <main>
    {#if g.practice}<Practice until={g.deleteAt} host />{/if}
    {#if inside}
      <div class="banner warn unsealed" role="status">
        <span>{t('tools.unsealedLine', { time: clock(tokenUntil || inside.until) })}</span>
        <ewo-button size="sm" variant="primary" onclick={() => seal()}>{t('tools.seal')}</ewo-button>
      </div>
    {/if}

    <div class="intro">
      <p class="eye">{t('host.eye')}</p>
      <h1 class="disp">{g.name}</h1>
      <p class="meta">{meta(g)}</p>
    </div>

    <div class="cols">
      <div class="left">
        <section class="card vcard">
          <div class="sec-h">
            <h3>{drawn ? t('host.villageDrawn', { n: opened, all: view.people.length }) : t('host.villageJoined', { n: joined, all: view.people.length })}</h3>
          </div>
          <Village {units} label={t('village.label')} selectable selected={picked} onpick={pick} />
          <div class="house-bar">
            {#if picked.size}
              <ewo-button bind:this={tieButton} size="sm" variant="primary" disabled={!canTie} onclick={tie}>{t('house.tie')}</ewo-button>
              {#if canUntie}<ewo-button bind:this={untieButton} size="sm" onclick={untie}>{t('house.untie')}</ewo-button>{/if}
              <ewo-button size="sm" variant="quiet" onclick={() => (picked = new Set())}>{t('house.clear')}</ewo-button>
            {:else}
              <p class="hint">{t('house.hint')}</p>
            {/if}
          </div>
        </section>

        <section class="card o-people">
          <h3>{t('host.people', { n: view.people.length })}</h3>
          <ewo-table hover sticky label={t('host.people', { n: view.people.length })}>
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('col.name')}</th>
                  {#if drawn}
                    <th scope="col">{t('col.opened')}</th>
                    <th scope="col">{t('col.ready')}</th>
                    {#if anyPost}<th scope="col">{t('col.parcel')}</th>{/if}
                    {#if inside}<th scope="col">{t('col.gives')}</th>{/if}
                  {:else}
                    <th scope="col">{t('col.joined')}</th>
                    <th scope="col">{t('col.handover')}</th>
                    <th scope="col">{t('col.wishes')}</th>
                  {/if}
                  {#if inside}<th scope="col">{t('col.address')}</th>{/if}
                  <th scope="col"><span class="vh">{t('col.actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {#each view.people as p (p.id)}
                  {@const pi = inside?.people.find((x) => x.id === p.id)}
                  <tr>
                    <th scope="row">
                      <span class="pn">
                        {p.name}
                        {#if p.host}<span class="tag">{t('host.tag')}</span>{/if}
                        {#if p.dummy}<span class="tag dummy">{t('practice.dummy')}</span>{/if}
                      </span>
                    </th>
                    {#if drawn}
                      <td><span class="mk" class:on={p.opened}></span><span class="vh">{p.opened ? t('yes') : t('no')}</span></td>
                      <td><span class="mk" class:on={p.ready}></span><span class="vh">{p.ready ? t('yes') : t('no')}</span></td>
                      {#if anyPost}<td class="small">{p.handover === 'post' ? (p.parcel === 'arrived' ? t('parcel.arrived') : p.parcel === 'way' ? t('parcel.way') : t('parcel.none')) : '–'}</td>{/if}
                      {#if inside}<td class="small"><b>{givesTo(p.id)}</b></td>{/if}
                    {:else}
                      <td><span class="mk" class:on={p.joined}></span><span class="vh">{p.joined ? t('yes') : t('no')}</span></td>
                      <td class="small">{p.joined ? handoverWord(p.handover) : '–'}</td>
                      <td class="small">{p.joined ? (p.wishes ? t('yes') : t('no')) : '–'}</td>
                    {/if}
                    {#if inside}<td class="small addr">{pi?.handover === 'post' ? pi.address || t('person.noAddress') : '–'}</td>{/if}
                    <td class="act">
                      {#if p.key}<a class="look" href={`/p/${p.key}`} target="_blank" rel="noopener">{t('practice.look')}</a>{/if}
                      <ewo-button size="sm" variant="quiet" onclick={() => openPerson(p)}>{t('person.edit')}</ewo-button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </ewo-table>
          <form class="add" onsubmit={(e) => (e.preventDefault(), !drawn && add(undefined, addButton))}>
            <ewo-field
              label={t('add.label')}
              placeholder={t('add.ph')}
              value={names}
              hint={drawn ? t('add.hintDrawn') : t('add.hint')}
              oninput={(e) => (names = e.currentTarget.value)}
            ></ewo-field>
            <div class="add-acts">
              {#if drawn}
                <ewo-button bind:this={addButton} variant="primary" disabled={!toAdd.length} onclick={() => add('patch', addButton)}>{t('add.patch')}</ewo-button>
                <ewo-button bind:this={addRedrawButton} disabled={!toAdd.length} onclick={() => add('redraw', addRedrawButton)}>{t('add.redraw')}</ewo-button>
              {:else}
                <ewo-button bind:this={addButton} type="submit" variant="primary" disabled={!toAdd.length}>{toAdd.length > 1 ? t('add.many', { n: toAdd.length }) : t('add.one')}</ewo-button>
              {/if}
            </div>
          </form>
        </section>
      </div>

      <div class="right">
        {#if !view.draw}
          <section class="card o-draw">
            <h3>{t('draw.title')}</h3>
            <div class="fld">
              <span class="lbl">{t('draw.shape')}</span>
              <ewo-segmented stretch label={t('draw.shape')} value={g.shape} onchange={(e) => setting({ shape: e.detail.value })}>
                <option value="chain">{t('draw.chain')}</option>
                <option value="any">{t('draw.any')}</option>
              </ewo-segmented>
              <p class="hint">{g.shape === 'chain' ? t('draw.chainHint') : t('draw.anyHint')}</p>
            </div>
            <div class="fld">
              <span class="lbl">{t('draw.moment')}</span>
              <ewo-segmented stretch label={t('draw.moment')} value={g.moment} onchange={(e) => setting({ moment: e.detail.value })}>
                <option value="quiet">{t('draw.quiet')}</option>
                <option value="live">{t('draw.live')}</option>
              </ewo-segmented>
              <p class="hint">{g.moment === 'quiet' ? t('draw.quietHint') : t('draw.liveHint')}</p>
            </div>
            {#if checkText}
              <div class="banner warn">{checkText}</div>
            {:else}
              <p class="hint">{joined < view.people.length ? t('draw.notAll', { n: view.people.length - joined }) : t('draw.all')}</p>
            {/if}
            {#if sure}
              <div class="sure">
                <p><b>{t('draw.sure', { n: view.people.length })}</b></p>
                <div class="acts">
                  <ewo-button bind:this={drawButton} variant="primary" onclick={makeDraw}>{g.moment === 'live' ? t('draw.goLive') : t('draw.go')}</ewo-button>
                  <ewo-button variant="quiet" onclick={() => (sure = false)}>{t('draw.notYet')}</ewo-button>
                </div>
              </div>
            {:else}
              <ewo-button variant="primary" size="lg" stretch disabled={!view.check.ok} onclick={() => (sure = true)}>{t('draw.button')}</ewo-button>
            {/if}
          </section>
        {:else}
          <section class="card o-draw">
            <h3>{t('drawn.title')}</h3>
            <dl class="dl">
              <dt>{t('drawn.when')}</dt>
              <dd>{stamp(view.draw.at)}{#if view.draw.round > 1} · {t('drawn.round', { n: view.draw.round })}{/if}</dd>
              <dt>{t('draw.shape')}</dt>
              <dd>{view.draw.shape === 'chain' ? t('draw.chain') : t('draw.any')}</dd>
              <dt>{t('drawn.opened')}</dt>
              <dd>{t('drawn.of', { n: opened, all: view.people.length })}</dd>
              <dt>{t('drawn.ready')}</dt>
              <dd>{t('drawn.of', { n: ready, all: view.people.length })}</dd>
            </dl>
            {#if !inside}<p class="hint">{t('drawn.sealed')}</p>{/if}
            <ewo-button variant="quiet" onclick={redraw}>{t('drawn.redraw')}</ewo-button>
          </section>
        {/if}

        <section class="card">
          <h3>{t('invite.title')}</h3>
          <p>{t('invite.body')}</p>
          <div class="linkrow"><code>{linkTo('g', view.groupKey)}</code><ewo-button size="sm" variant="primary" onclick={() => copy(linkTo('g', view.groupKey), t('copy.done'))}>{t('copy.link')}</ewo-button></div>
          {#if reminder}
            <ewo-button onclick={() => copy(reminder, t('remind.copied'))}>{t('remind.copy')}</ewo-button>
            <p class="hint">{t('remind.hint')}</p>
          {/if}
          {#if mine?.me}
            <ewo-button variant="quiet" href={`/p/${mine.me}`} onclick={link(`/p/${mine.me}`)}>{t('host.own')}</ewo-button>
          {/if}
        </section>

        <section class="card">
          <div class="sec-h"><h3>{t('event.title')}</h3><span class="sp"></span><ewo-button size="sm" variant="quiet" onclick={openEdit}>{t('edit.open')}</ewo-button></div>
          <Event group={g} />
          <p class="hint">{g.handover === 'post' ? t('edit.handoverPost') : t('edit.handoverParty')}</p>
        </section>

        <section class="card keep">
          <h3>{t('host.keepTitle')}</h3>
          <p class="hint">{t('host.keep')}</p>
          <div class="linkrow"><code>{linkTo('h', key)}</code><ewo-button size="sm" onclick={() => copy(linkTo('h', key), t('copy.done'))}>{t('copy.link')}</ewo-button></div>
          <p class="hint">{t('group.deleted', { date: dayOf(g.deleteAt) })}</p>
        </section>
      </div>
    </div>
  </main>

  {#if stage}
    <LiveStage n={stage.n} until={stage.until} offset={data.offset} onclose={() => ((stageClosed = stage?.until ?? 0), (stage = null))} />
  {/if}
{:else if data.failed}
  <main><ewo-empty heading={t('err.offline')} variant="dashed"><ewo-button slot="actions" onclick={() => data.load()}>{t('retry')}</ewo-button></ewo-empty></main>
{/if}

<!-- One person -->
<ewo-sheet open={!!person} label={person?.name ?? ''} oncancel={() => (person = null)} onclose={() => (person = null)}>
  <span slot="heading" class="disp sheet-h">{person?.name ?? ''}</span>
  {#if person}
    <div class="form">
      <p class="hint">
        {person.joined ? t('person.joined') : t('person.notJoined')}
        {#if drawn} · {person.opened ? t('person.opened') : t('person.notOpened')}{/if}
      </p>
      {#if personInside}
        <div class="inside">
          {#if drawn}<p><b>{t('person.gives', { name: givesTo(person.id) })}</b></p>{/if}
          <p class="lbl">{t('me.handover')}</p>
          <p>{personInside.handover === 'post' ? personInside.address || t('person.noAddress') : t('handover.party')}</p>
          <p class="lbl">{t('me.wishes')}</p>
          {#if personInside.wishes.length}<WishList wishes={personInside.wishes} />{:else}<p class="hint">{t('person.noWishes')}</p>{/if}
          {#if personInside.not}<p><b>{t('me.not')}:</b> {personInside.not}</p>{/if}
        </div>
      {/if}
      <form class="row" onsubmit={rename}>
        <ewo-field label={t('person.rename')} value={renameTo} maxlength="40" oninput={(e) => (renameTo = e.currentTarget.value)}></ewo-field>
        <ewo-button bind:this={renameButton} type="submit" disabled={!renameTo.trim() || renameTo.trim() === person.name}>{t('person.save')}</ewo-button>
      </form>
      {#if person.key}
        <ewo-button variant="quiet" href={`/p/${person.key}`} target="_blank">{t('practice.lookAs', { name: person.name })}</ewo-button>
      {/if}
      {#if person.joined}
        <div class="danger-row">
          <ewo-button stretch onclick={() => person && resetClaim(person)}>{t('person.reset')}</ewo-button>
          <p class="hint">{t('person.resetHint')}</p>
        </div>
      {/if}
      <ewo-button variant="danger" stretch onclick={() => person && remove(person)}>{t('person.remove')}</ewo-button>
    </div>
  {/if}
</ewo-sheet>

<!-- The party's details -->
<ewo-sheet open={editing} label={t('edit.title')} oncancel={() => (editing = false)} onclose={() => (editing = false)}>
  <span slot="heading" class="disp sheet-h">{t('edit.title')}</span>
  <form class="form" onsubmit={saveEdit} novalidate>
    <ewo-field label={t('new.name')} value={edit.name} maxlength="60" required oninput={(e) => (edit.name = e.currentTarget.value)}></ewo-field>
    <div class="two">
      <ewo-field label={t('new.date')} type="date" min={edit.party && edit.party < today() ? edit.party : today()} value={edit.party} required onchange={(e) => (edit.party = e.currentTarget.value)} oninput={(e) => (edit.party = e.currentTarget.value)}></ewo-field>
      <ewo-field label={t('new.time')} type="time" value={edit.time} hint={t('optional')} onchange={(e) => (edit.time = e.currentTarget.value)} oninput={(e) => (edit.time = e.currentTarget.value)}></ewo-field>
    </div>
    <ewo-field label={t('new.place')} value={edit.place} maxlength="120" hint={t('optional')} oninput={(e) => (edit.place = e.currentTarget.value)}></ewo-field>
    <ewo-field label={t('new.budget')} placeholder="25€" value={edit.budget} inputmode="decimal" hint={t('new.budgetHint')} error={Number.isNaN(editCents) ? t('new.need.budget') : ''} oninput={(e) => (edit.budget = e.currentTarget.value)}></ewo-field>
    <ewo-field label={t('new.note')} value={edit.note} multiline rows="3" autogrow maxlength="600" hint={t('optional')} oninput={(e) => (edit.note = e.currentTarget.value)}></ewo-field>
    <div class="fld">
      <span class="lbl">{t('new.handover')}</span>
      <ewo-segmented stretch label={t('new.handover')} value={edit.handover} onchange={(e) => (edit.handover = e.detail.value as 'party' | 'post')}>
        <option value="party">{t('handover.party')}</option>
        <option value="post">{t('handover.post')}</option>
      </ewo-segmented>
      <p class="hint">{t('new.handoverHint')}</p>
    </div>
    <ewo-switch row checked={edit.selfAdd} disabled={drawn} onchange={(e) => (edit.selfAdd = e.detail.checked)}>{t('new.selfAdd')}<span slot="hint">{drawn ? t('edit.selfAddDrawn') : t('new.selfAddHint')}</span></ewo-switch>
    <ewo-button bind:this={editButton} type="submit" variant="primary" stretch>{t('edit.save')}</ewo-button>
  </form>
</ewo-sheet>

<!-- Host tools -->
<ewo-sheet open={tools} label={t('tools.title')} oncancel={() => (tools = false)} onclose={() => (tools = false)}>
  <span slot="heading" class="disp sheet-h">{t('tools.title')}</span>
  <div class="form tools">
    <section class="tool">
      <h4>{t('tools.unsealTitle')}</h4>
      {#if inside}
        <p>{t('tools.unsealedLine', { time: clock(tokenUntil || inside.until) })}</p>
        <ewo-button variant="primary" onclick={() => seal()}>{t('tools.seal')}</ewo-button>
      {:else}
        <p class="hint">{t('tools.unsealBody')}</p>
        <form class="row" onsubmit={unseal}>
          <ewo-field label={t('tools.code')} value={code} autocomplete="off" required oninput={(e) => (code = e.currentTarget.value)}></ewo-field>
          <ewo-button bind:this={unsealButton} type="submit" variant="primary" disabled={!code.trim()}>{t('tools.unseal')}</ewo-button>
        </form>
      {/if}
    </section>

    <section class="tool">
      <h4>{t('tools.logTitle')}</h4>
      <p class="hint">{t('tools.logBody')}</p>
      <ol class="log">
        {#each [...view?.log ?? []].reverse() as l, i (i)}
          <li><span class="when">{stamp(l.at)}</span><span>{logLine(l)}</span></li>
        {/each}
      </ol>
    </section>

    <section class="tool">
      <h4>{t('tools.codeTitle')}</h4>
      {#if codeOpen}
        <form class="form" onsubmit={changeCode}>
          <ewo-field label={t('tools.oldCode')} value={oldCode} autocomplete="off" required oninput={(e) => (oldCode = e.currentTarget.value)}></ewo-field>
          <ewo-field label={t('tools.newCode')} value={nextCode} autocomplete="off" maxlength="64" required hint={t('new.codeHint')} oninput={(e) => (nextCode = e.currentTarget.value)}></ewo-field>
          <ewo-button bind:this={codeButton} type="submit" variant="primary">{t('tools.changeCode')}</ewo-button>
        </form>
      {:else}
        <p class="hint">{t('tools.codeBody')}</p>
        <ewo-button onclick={() => (codeOpen = true)}>{t('tools.changeCode')}</ewo-button>
      {/if}
    </section>

    <section class="tool">
      <h4>{t('tools.rekeyTitle')}</h4>
      <p class="hint">{t('tools.rekeyHint')}</p>
      <ewo-button onclick={rekey}>{t('tools.rekey')}</ewo-button>
    </section>

    <section class="tool">
      <h4>{t('tools.deleteTitle')}</h4>
      <p class="hint">{t('tools.deleteHint', { date: g ? dayOf(g.deleteAt) : '' })}</p>
      <ewo-button variant="danger" onclick={remove_group}>{t('tools.delete')}</ewo-button>
    </section>
  </div>
</ewo-sheet>

<!-- Asking first -->
<ewo-sheet open={!!ask} label={ask?.title ?? ''} oncancel={() => !asking && (ask = null)} onclose={() => !asking && (ask = null)}>
  <span slot="heading" class="disp sheet-h">{ask?.title ?? ''}</span>
  {#if ask}
    <div class="form">
      <p>{ask.body}</p>
      {#each ask.options as o (o.label)}
        <ewo-button variant={o.variant ?? 'default'} stretch onclick={(e) => answer(o, e)}>{o.label}</ewo-button>
      {/each}
      <ewo-button variant="quiet" stretch onclick={() => (ask = null)}>{t('cancel')}</ewo-button>
    </div>
  {/if}
</ewo-sheet>

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
    white-space: nowrap;
  }

  .unsealed {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
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

  h4 {
    font-size: 16px;
    font-weight: 700;
  }

  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1.65fr) minmax(0, 1fr);
    gap: 28px;
    align-items: start;
  }

  .left,
  .right {
    display: grid;
    gap: 18px;
    min-width: 0;
  }

  .sec-h {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .vcard {
    padding-bottom: 14px;
  }

  .house-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    min-height: 34px;
  }

  .pn {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-weight: 700;
  }

  .tag {
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.03em;
    padding: 1px 8px;
    border-radius: 999px;
    background: color-mix(in oklab, var(--m-accent) 14%, transparent);
    color: var(--m-accent);
  }

  .tag.dummy {
    background: var(--m-sunk);
    color: var(--m-ink-3);
  }

  td.small {
    font-size: 13.5px;
    color: var(--m-ink-2);
  }

  td.addr {
    white-space: pre-line;
    min-width: 160px;
  }

  td.act {
    text-align: end;
    white-space: nowrap;
  }

  .look {
    font-size: 13px;
    font-weight: 700;
    color: var(--m-accent);
    margin-right: 6px;
  }

  .add {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    align-items: start;
    padding-top: 4px;
  }

  .add-acts {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding-top: 24px;
  }

  .fld {
    display: grid;
    gap: 6px;
  }

  .sure {
    display: grid;
    gap: 10px;
    padding: 12px 14px;
    border-radius: var(--m-r);
    background: var(--m-sunk);
  }

  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .sheet-h {
    font-size: 28px;
  }

  .form {
    display: grid;
    gap: 12px;
  }

  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    align-items: end;
  }

  .two {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    gap: 12px;
  }

  .inside {
    display: grid;
    gap: 6px;
    padding: 12px 14px;
    border-radius: var(--m-r);
    background: color-mix(in oklab, var(--m-warn) 8%, var(--m-card));
    border: 1px solid color-mix(in oklab, var(--m-warn) 30%, transparent);
    white-space: pre-line;
  }

  .danger-row {
    display: grid;
    gap: 6px;
  }

  .tools {
    gap: 22px;
  }

  .tool {
    display: grid;
    gap: 8px;
    justify-items: start;
  }

  .tool > form,
  .tool > .row {
    justify-self: stretch;
  }

  .log {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
    max-height: 280px;
    overflow: auto;
    justify-self: stretch;
    font-size: 14px;
  }

  .log li {
    display: grid;
    grid-template-columns: 112px minmax(0, 1fr);
    gap: 10px;
  }

  .when {
    color: var(--m-ink-3);
    font-variant-numeric: tabular-nums;
  }

  /* One column: the draw comes right after the village, before the list of everyone. */
  @media (max-width: 959px) {
    .cols {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 18px;
    }
    .left,
    .right {
      display: contents;
    }
    .o-draw {
      order: 1;
    }
    .o-people,
    .right > :not(.o-draw) {
      order: 2;
    }
  }

  @media (max-width: 559px) {
    main {
      padding: 16px max(16px, env(safe-area-inset-right)) 48px max(16px, env(safe-area-inset-left));
    }
    .add {
      grid-template-columns: minmax(0, 1fr);
    }
    .add-acts {
      padding-top: 0;
    }
    .two {
      grid-template-columns: minmax(0, 1fr);
    }
    .chip {
      display: none;
    }
  }
</style>
