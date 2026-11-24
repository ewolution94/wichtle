<!--
  For a host who takes part too: their two pages for the group (the host link and their own link) as
  two tabs at the top of both pages, so one tap goes from organising to their wishes and door and
  back. Only when this device knows both links; the host link never hands out a personal one.
-->
<script lang="ts">
  import { nav } from '../lib/router.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';

  let { host, me, current }: { host: string; me: string; current: 'host' | 'me' } = $props();
</script>

<div class="roles">
  <nav aria-label={t('roles.label')}>
    <a href={`/h/${host}`} onclick={nav} aria-current={current === 'host' ? 'page' : undefined}>{t('roles.host')}</a>
    <a href={`/p/${me}`} onclick={nav} aria-current={current === 'me' ? 'page' : undefined}>{t('roles.me')}</a>
  </nav>
  <p class="hint">{current === 'host' ? t('roles.hostLine') : t('roles.meLine')}</p>
</div>

<style>
  .roles {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 16px;
  }

  nav {
    display: inline-grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    padding: 3px;
    border-radius: 999px;
    background: var(--ewo-fill);
    border: 1px solid var(--m-line);
  }

  a {
    display: grid;
    place-items: center;
    min-height: 36px;
    padding: 0 20px;
    border-radius: 999px;
    font-size: 15px;
    font-weight: 700;
    color: var(--m-ink-2);
    text-decoration: none;
    white-space: nowrap;
    transition: color 0.15s ease;
  }

  a:hover {
    color: var(--m-ink);
  }

  a[aria-current='page'] {
    background: var(--m-invert);
    color: var(--m-invert-ink);
  }

  .hint {
    min-width: 0;
    flex: 1 1 280px;
  }

  @media (max-width: 559px) {
    .roles {
      display: grid;
    }
    nav {
      display: grid;
    }
  }
</style>
