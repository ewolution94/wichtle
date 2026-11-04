<script lang="ts">
  import Home from './components/Home.svelte';
  import NewGroup from './components/NewGroup.svelte';
  import GroupPage from './components/GroupPage.svelte';
  import HostPage from './components/HostPage.svelte';
  import PersonPage from './components/PersonPage.svelte';
  import Settings from './components/Settings.svelte';
  import Header from './components/Header.svelte';
  import { route, link, pageOf } from './lib/router.svelte.ts';
  import { t } from './lib/i18n.svelte.ts';

  const page = $derived(pageOf(route.path));
</script>

{#key route.path}
  {#if page.kind === 'home'}
    <Home />
  {:else if page.kind === 'new'}
    <NewGroup />
  {:else if page.kind === 'g'}
    <GroupPage key={page.key} />
  {:else if page.kind === 'h'}
    <HostPage key={page.key} />
  {:else if page.kind === 'p'}
    <PersonPage key={page.key} />
  {:else}
    <Header />
    <main class="missing">
      <h1 class="disp">{t('missing.title')}</h1>
      <p>{t('missing.body')}</p>
      <ewo-button variant="primary" href="/" onclick={link('/')}>{t('missing.home')}</ewo-button>
    </main>
  {/if}
{/key}
<Settings />
<ewo-toaster position="bottom"></ewo-toaster>

<style>
  .missing {
    max-width: 560px;
    margin: 0 auto;
    padding: 80px max(20px, env(safe-area-inset-left)) 40px;
    display: grid;
    justify-items: start;
    gap: 16px;
  }

  h1 {
    font-size: 44px;
  }
</style>
