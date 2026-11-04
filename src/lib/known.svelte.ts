// The groups this device knows, for the home page: as host (the host link), as a participant (their
// own link), or both. Only on this device (localStorage); nothing about it reaches the server.

export interface Known {
  group: string;
  name: string;
  party: string;
  host?: string;
  me?: string;
  meName?: string;
  practice?: boolean;
  seen: number;
}

import { untrack } from 'svelte';

const KEY = 'wichtle:groups';

function load(): Known[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((k) => typeof k?.group === 'string') : [];
  } catch {
    return [];
  }
}

export const known = $state<{ list: Known[] }>({ list: load() });

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(known.list));
  } catch {}
}

/** Adds what's new about a group (a key, its name), keeping the rest. Pages call it from effects:
 *  it reads the list without subscribing to it. */
export function remember(entry: Partial<Known> & { group: string }) {
  untrack(() => keep(entry));
}

function keep(entry: Partial<Known> & { group: string }) {
  const at = known.list.findIndex((k) => k.group === entry.group);
  const clean = Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined));
  const next: Known = { name: '', party: '', ...(at >= 0 ? known.list[at] : {}), ...clean, seen: Date.now() } as Known;
  if (at >= 0) known.list[at] = next;
  else known.list.unshift(next);
  save();
}

/** Drops one key from a group's entry (it stopped working), or the whole entry. */
export function forget(group: string, which?: 'host' | 'me') {
  untrack(() => drop(group, which));
}

function drop(group: string, which?: 'host' | 'me') {
  const at = known.list.findIndex((k) => k.group === group);
  if (at < 0) return;
  if (which) {
    const entry = { ...known.list[at] };
    delete entry[which];
    if (which === 'me') delete entry.meName;
    if (entry.host || entry.me) known.list[at] = entry;
    else known.list.splice(at, 1);
  } else known.list.splice(at, 1);
  save();
}

export const byGroup = (group: string) => known.list.find((k) => k.group === group);
export const byKey = (key: string) => known.list.find((k) => k.host === key || k.me === key);
