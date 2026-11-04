// Dates, times and money as the pages show them. Prices are the family's `25€`, `7,50€` in both
// languages (learnings/ui-preferences.md → Formats).

import { locale } from './i18n.svelte.ts';

const tag = () => (locale() === 'de' ? 'de-DE' : 'en-GB');

/** `YYYY-MM-DD` as a date at noon UTC, so no time zone moves it to the day before. */
const at = (date: string) => new Date(`${date}T12:00:00Z`);

/** "Fr., 18. Dez." / "Fri 18 Dec". */
export const day = (date: string) =>
  new Intl.DateTimeFormat(tag(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(at(date)).replace(/,(?= \d)/, locale() === 'en' ? '' : ',');

/** "Freitag, 18. Dezember 2026" / "Friday 18 December 2026". */
export const longDay = (date: string) =>
  new Intl.DateTimeFormat(tag(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(at(date)).replace(',', locale() === 'en' ? '' : ',');

/** A moment as a day in Berlin: "So., 17. Jan. 2027". */
export const dayOf = (ms: number) =>
  new Intl.DateTimeFormat(tag(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Berlin' }).format(ms).replace(/,(?= \d)/, locale() === 'en' ? '' : ',');

/** "4. Nov., 15:40" / "4 Nov, 15:40". */
export const stamp = (ms: number) =>
  new Intl.DateTimeFormat(tag(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(ms);

/** "15:40". */
export const clock = (ms: number) => new Intl.DateTimeFormat(tag(), { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(ms);

const whole = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 2500 → "25€", 750 → "7,50€". */
export const price = (c: number) => `${c % 100 === 0 ? whole.format(c / 100) : cents.format(c / 100)}€`;

/** What someone typed as a budget, in cents; null for nothing, NaN when it isn't a price. */
export function parseBudget(text: string): number | null {
  const raw = text.replace(/[\s€]|eur(o)?/gi, '');
  if (!raw) return null;
  if (!/^\d{1,5}([.,]\d{1,2})?$/.test(raw)) return NaN;
  return Math.round(Number(raw.replace(',', '.')) * 100);
}

/** "Anna, Ben und Carla" / "Anna, Ben and Carla". */
export const list = (names: string[]) => new Intl.ListFormat(tag(), { style: 'long', type: 'conjunction' }).format(names);

/** Today in Berlin, `YYYY-MM-DD`. */
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(Date.now());
