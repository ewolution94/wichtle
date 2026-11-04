<!-- "Wichtle" with its paper star; a link home. -->
<script lang="ts">
  import { nav } from '../lib/router.svelte.ts';
  import { STAR } from '../lib/paper.ts';
  let { small = false }: { small?: boolean } = $props();
</script>

<a class="wm" class:small href="/" onclick={nav}>{@html STAR}<span>Wichtle</span></a>

<style>
  .small {
    font-size: 25px;
  }
  .small :global(svg) {
    width: 20px;
    height: 20px;
  }
</style>
