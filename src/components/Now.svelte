<!--
  The one thing to do now, at the top of a page: "Next step", a title that says it, and whatever the
  page puts under it (a sentence, the buttons for it). The page decides what it is from the group's
  state; this only frames it.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../lib/i18n.svelte.ts';

  let { title, eye, children }: { title: string; eye?: string; children?: Snippet } = $props();
  const id = $props.id();
</script>

<section class="now" aria-labelledby={id}>
  <p class="eye">{eye ?? t('now.eye')}</p>
  <h2 class="disp" {id}>{title}</h2>
  {@render children?.()}
</section>

<style>
  .now {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    align-content: start;
    padding: 22px 24px;
    border-radius: 14px;
    background: var(--m-card);
    border: 1.5px solid color-mix(in oklab, var(--m-accent) 32%, var(--m-line));
    box-shadow: 0 14px 34px -22px color-mix(in oklab, var(--m-ink) 45%, transparent);
  }

  .eye {
    font-size: 12.5px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--m-accent);
  }

  h2 {
    font-size: clamp(28px, 3vw, 36px);
    line-height: 1.02;
    overflow-wrap: anywhere;
  }

  @media (max-width: 559px) {
    .now {
      padding: 18px;
    }
  }
</style>
