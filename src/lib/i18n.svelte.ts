/**
 * German and English, German first (the user, 2026-11-04). The choice lives in Settings (General →
 * Language) under `ewo:lang`: Default (nothing saved) is Dashboard's family language if it sets one,
 * else German; Deutsch or English pins one. public/boot.js applies it before first paint. A group has
 * its own language too (the practice colleagues' wishes); the page shows the device's.
 *
 * The strings are in `strings.ts`: `t('key', { n: 3 })` in a template updates when the language changes.
 */

import { themeShift } from '../../vendor/ewo/elements/theme-shift.js';
import { readConfig } from '../../vendor/ewo/elements/config-client.js';
import { STRINGS } from './strings.ts';

export type Locale = 'de' | 'en';
export type LangChoice = Locale | 'system';

const KEY = 'ewo:lang';

function stored(): LangChoice {
  try {
    const value = localStorage.getItem(KEY);
    if (value === 'de' || value === 'en') return value;
  } catch {}
  return 'system';
}

/** Default: the family's language from Dashboard, else German. */
const resolve = (choice: LangChoice): Locale => (choice !== 'system' ? choice : readConfig().lang === 'en' ? 'en' : 'de');

export const i18n = $state({ choice: stored() });
let shown = $state<Locale>(resolve(i18n.choice));
document.documentElement.lang = shown;

export const locale = (): Locale => shown;

/** A pick in Settings: the page follows under Folio's veil (themeShift), unless the language on
 *  screen stays the same. */
export function setLanguage(next: LangChoice) {
  i18n.choice = next;
  try {
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {}
  const lang = resolve(next);
  if (lang === shown) return;
  themeShift(() => {
    shown = lang;
    document.documentElement.lang = lang;
  });
}

type Params = Record<string, string | number>;

/** `{name}` in a string takes `params.name`. */
export function fill(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/**
 * Strings by key. English is the reference: a key German leaves out shows in English. A key ending in
 * `.one`/`.other` is a plural pair: pass `n` and the base.
 */
type PluralBase<T> = { [K in keyof T]: K extends `${infer B}.other` ? B : never }[keyof T];

export function words<const T extends Record<string, string>>(dict: { en: T; de: Partial<Record<keyof T, string>> }) {
  return (key: (keyof T & string) | PluralBase<T>, params?: Params): string => {
    const lang = locale();
    let k = key as string;
    if (params && 'n' in params && !(k in dict.en)) {
      const form = new Intl.PluralRules(lang).select(Number(params.n)) === 'one' ? 'one' : 'other';
      k = `${k}.${form}`;
    }
    const template = (dict[lang] as Record<string, string | undefined>)[k] ?? (dict.en as Record<string, string>)[k] ?? k;
    return fill(template, params);
  };
}

export const t = words(STRINGS);
export type Key = Parameters<typeof t>[0];
