import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Folio's elements (ewo-button, ewo-settings-button) are buttons with their own keyboard handling
// inside, which the compiler can't see: its "static element with a click handler" warnings on them
// are noise. Everything else still warns.
const STATIC = new Set(['a11y_click_events_have_key_events', 'a11y_no_static_element_interactions']);

export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    warningFilter: (warning) => !(STATIC.has(warning.code) && /`<ewo-[a-z-]+>`/.test(warning.message)),
  },
};
