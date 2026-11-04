<!--
  Wishes: a few lines, each with a link the person pasted themselves (shown as a plain link, never
  fetched or rewritten). Editing: Enter adds a line (a link anywhere in it becomes the line's link),
  × takes one away.
-->
<script lang="ts">
  import type { Wish } from '../lib/api.ts';
  import { t } from '../lib/i18n.svelte.ts';

  let { wishes, edit = false, onchange }: { wishes: Wish[]; edit?: boolean; onchange?: (next: Wish[]) => void } = $props();

  let draft = $state('');
  const MAX = 8;

  /** "Socks https://shop.example/socks" → the words and the link. */
  function parse(text: string): Wish | null {
    const url = /https?:\/\/\S+/i.exec(text)?.[0] ?? '';
    const words = text.replace(url, '').replace(/\s+/g, ' ').trim().slice(0, 120);
    return words || url ? { t: words, l: url } : null;
  }

  function add(e?: Event) {
    e?.preventDefault();
    const wish = parse(draft);
    if (!wish || wishes.length >= MAX) return;
    onchange?.([...wishes, wish]);
    draft = '';
  }

  const host = (url: string) => {
    try {
      return new URL(url).host.replace(/^www\./, '');
    } catch {
      return url;
    }
  };
</script>

{#if wishes.length}
  <ul class="wl" class:ro={!edit}>
    {#each wishes as w, i (i)}
      <li>
        <span class="wt">
          {#if w.t}<span>{w.t}</span>{/if}
          {#if w.l}<a class="lk" href={w.l} target="_blank" rel="noopener noreferrer nofollow">{host(w.l)}</a>{/if}
        </span>
        {#if edit}
          <button type="button" class="plain x" aria-label={t('wish.remove', { wish: w.t || host(w.l) })} onclick={() => onchange?.(wishes.filter((_, j) => j !== i))}>×</button>
        {/if}
      </li>
    {/each}
  </ul>
{/if}
{#if edit}
  {#if wishes.length < MAX}
    <form class="add" onsubmit={add}>
      <ewo-field
        label={t('wish.add')}
        value={draft}
        maxlength="400"
        placeholder={t('wish.addPh')}
        hint={t('wish.addHint')}
        oninput={(e) => (draft = e.currentTarget.value)}
      ></ewo-field>
      <ewo-button type="submit" disabled={!draft.trim()}>{t('wish.addButton')}</ewo-button>
    </form>
  {:else}
    <p class="hint">{t('wish.full')}</p>
  {/if}
{/if}

<style>
  .add {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: start;
  }

  .add ewo-button {
    margin-top: 25px;
  }

  .wl {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    border-radius: var(--m-r);
    background: var(--m-card);
    border: 1px solid var(--m-line);
  }

  li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px 10px 16px;
    font-size: 15.5px;
  }

  li + li {
    border-top: 1px solid var(--m-line);
  }

  .wt {
    display: grid;
    gap: 1px;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .lk {
    font-size: 13px;
    color: var(--m-ink-3);
    text-decoration: underline;
    text-underline-offset: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .x {
    margin-left: auto;
    width: 32px;
    height: 32px;
    flex: none;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: var(--m-ink-3);
    font-size: 20px;
    line-height: 1;
  }

  .x:hover {
    background: var(--m-sunk);
    color: var(--m-ink);
  }
</style>
