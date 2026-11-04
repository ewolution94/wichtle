<!--
  The home: what Wichtle does, "Start a group", the practice run, and the groups this device knows.
-->
<script lang="ts">
  import Header from './Header.svelte';
  import Village, { type Unit } from './Village.svelte';
  import { known, forget, type Known } from '../lib/known.svelte.ts';
  import { go, link, nav } from '../lib/router.svelte.ts';
  import { post } from '../lib/api.ts';
  import { act, say } from '../lib/ui.svelte.ts';
  import { remember } from '../lib/known.svelte.ts';
  import { locale, t } from '../lib/i18n.svelte.ts';
  import { day } from '../lib/format.ts';

  const demo: Unit[] = ['Anna', 'Ben & Carla', 'David', 'Elif', 'Finn', 'Greta & Jonas', 'Lena'].map((n, i) => {
    const names = n.split(' & ');
    return { key: n, ids: names, names, lit: names.map((_, w) => (i + w) % 4 !== 3) };
  });

  let practiceOpen = $state(false);
  let practiceName = $state('');
  let practiceButton: HTMLElement | undefined = $state();

  async function practice(e: Event) {
    e.preventDefault();
    const name = practiceName.trim();
    if (!name) return;
    const made = await act(practiceButton, () => post<{ group: string; host: string; me: string }>('/groups', { practice: true, host: { name }, lang: locale() }));
    if (!made) return;
    remember({ group: made.group, host: made.host, me: made.me, meName: name, name: locale() === 'de' ? 'Probelauf' : 'Practice run', practice: true });
    practiceOpen = false;
    say(t('practice.started'), 'ok');
    go(`/h/${made.host}`);
  }

  const role = (k: Known) => (k.host ? (k.me ? t('home.hostAndIn') : t('home.host')) : t('home.in', { name: k.meName ?? '' }));
  const open = (k: Known) => (k.host ? `/h/${k.host}` : `/p/${k.me}`);
  const sorted = $derived([...known.list].sort((a, b) => (a.party || '9').localeCompare(b.party || '9')));
</script>

<Header />
<main>
  <section class="hero">
    <div class="copy">
      <h1 class="disp">{t('home.title')}</h1>
      <p class="lead">{t('home.lead')}</p>
      <div class="acts">
        <ewo-button variant="primary" size="lg" href="/new" onclick={link('/new')}>{t('home.start')}</ewo-button>
        <ewo-button size="lg" onclick={() => (practiceOpen = true)}>{t('home.practice')}</ewo-button>
      </div>
      <p class="hint">{t('home.practiceHint')}</p>
    </div>
    <div class="pic" aria-hidden="true">
      <Village units={demo} label="" />
    </div>
  </section>

  {#if sorted.length}
    <section class="mine">
      <h2 class="disp">{t('home.mine')}</h2>
      <ul>
        {#each sorted as k (k.group)}
          <li class="card row">
            <a class="go" href={open(k)} onclick={nav}>
              <b>{k.name || t('home.unnamed')}</b>
              <span class="meta">
                {#if k.party}{day(k.party)} · {/if}{role(k)}{#if k.practice} · {t('practice.badge')}{/if}
              </span>
            </a>
            <ewo-button size="sm" variant="quiet" onclick={() => forget(k.group)}>{t('home.remove')}</ewo-button>
          </li>
        {/each}
      </ul>
      <p class="hint">{t('home.mineHint')}</p>
    </section>
  {/if}

  <section class="how">
    <h2 class="disp">{t('home.how')}</h2>
    <ol>
      <li><b>{t('home.how1')}</b><span>{t('home.how1b')}</span></li>
      <li><b>{t('home.how2')}</b><span>{t('home.how2b')}</span></li>
      <li><b>{t('home.how3')}</b><span>{t('home.how3b')}</span></li>
      <li><b>{t('home.how4')}</b><span>{t('home.how4b')}</span></li>
    </ol>
  </section>
</main>

<ewo-sheet open={practiceOpen} label={t('practice.title')} oncancel={() => (practiceOpen = false)} onclose={() => (practiceOpen = false)}>
  <span slot="heading" class="disp sheet-h">{t('practice.title')}</span>
  <form class="form" onsubmit={practice}>
    <p>{t('practice.body')}</p>
    <ewo-field label={t('practice.name')} value={practiceName} maxlength="40" autocomplete="given-name" required oninput={(e) => (practiceName = e.currentTarget.value)}></ewo-field>
    <ewo-button bind:this={practiceButton} type="submit" variant="primary" stretch>{t('practice.go')}</ewo-button>
    <p class="hint">{t('practice.hint')}</p>
  </form>
</ewo-sheet>

<style>
  main {
    max-width: 1280px;
    margin: 0 auto;
    padding: 40px max(28px, env(safe-area-inset-right)) 64px max(28px, env(safe-area-inset-left));
    display: grid;
    gap: 48px;
  }

  .hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
    gap: 48px;
    align-items: center;
  }

  h1 {
    font-size: clamp(44px, 6vw, 72px);
    line-height: 0.95;
  }

  .copy {
    display: grid;
    gap: 18px;
    justify-items: start;
  }

  .lead {
    font-size: 19px;
    color: var(--m-ink-2);
    max-width: 34em;
  }

  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  h2 {
    font-size: 30px;
    margin-bottom: 12px;
  }

  .mine ul {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 10px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 12px 12px 18px;
  }

  .go {
    flex: 1;
    min-width: 0;
    display: grid;
    text-decoration: none;
  }

  .go b {
    font-size: 17px;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .go:hover b {
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .meta {
    font-size: 13.5px;
    color: var(--m-ink-3);
  }

  .how ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
    counter-reset: step;
  }

  .how li {
    counter-increment: step;
    display: grid;
    gap: 4px;
    align-content: start;
    padding: 16px 18px;
    border-radius: var(--m-r);
    background: var(--m-card);
    border: 1px solid var(--m-line);
  }

  .how li::before {
    content: counter(step);
    font: 700 34px/1 var(--m-disp);
    color: var(--m-accent);
  }

  .how b {
    font-size: 16px;
  }

  .how span {
    font-size: 14px;
    color: var(--m-ink-2);
  }

  .sheet-h {
    font-size: 28px;
  }

  .form {
    display: grid;
    gap: 14px;
  }

  @media (max-width: 899px) {
    .hero {
      grid-template-columns: minmax(0, 1fr);
      gap: 28px;
    }
    .how ol {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 559px) {
    main {
      padding: 24px max(16px, env(safe-area-inset-right)) 48px max(16px, env(safe-area-inset-left));
      gap: 36px;
    }
    .how ol {
      grid-template-columns: minmax(0, 1fr);
    }
    .mine ul {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
