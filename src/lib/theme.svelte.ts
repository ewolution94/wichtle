// Mirrors public/boot.js, which applies the theme before first paint; keep them in step. The order: this
// device's pick, then Dashboard's default (#ewo-config, the family's), then the system's.
import { themeShift } from '../../vendor/ewo/elements/theme-shift.js';
import { readConfig } from '../../vendor/ewo/elements/config-client.js';

export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'wichtle:theme';
const PAGE = { light: '#f7efe3', dark: '#1c120b' };
const media = matchMedia('(prefers-color-scheme: dark)');

function load(): ThemePreference {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

/** Dashboard's theme for a device that hasn't picked, if it sets one. */
const family = (): 'light' | 'dark' | null => {
  const value = readConfig().theme;
  return value === 'light' || value === 'dark' ? value : null;
};

class Theme {
  preference = $state<ThemePreference>(load());
  #systemDark = $state(media.matches);
  resolved = $derived<'light' | 'dark'>(this.preference === 'system' ? (family() ?? (this.#systemDark ? 'dark' : 'light')) : this.preference);

  constructor() {
    media.addEventListener('change', (e) => (this.#systemDark = e.matches));
  }

  /** The control updates at once; the page follows under Folio's veil (themeShift), unless the
   *  pick changes nothing on screen. */
  set(next: ThemePreference) {
    if (next === this.preference) return;
    const before = this.resolved;
    this.preference = next;
    if (this.resolved === before) this.#apply(next);
    else themeShift(() => this.#apply(next));
  }

  #apply(next: ThemePreference) {
    const root = document.documentElement;
    const shown = next === 'system' ? family() : next;
    if (shown) root.dataset.theme = shown;
    else delete root.dataset.theme;
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {}
    // Folio's --ewo-bg is a light-dark() pair, which a custom property reads back unresolved, so
    // the page colours are written out here (as in boot.js). Following the system, each meta has its own.
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      const own = meta.media.includes('dark') ? 'dark' : 'light';
      meta.content = PAGE[shown ?? own];
    }
  }
}

export const theme = new Theme();
