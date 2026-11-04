// What's open across the app, and the small helpers every page uses for an action: its wait at the
// control that started it (Folio's track), and an error said in words.

import { track } from '../../vendor/ewo/elements/waiting.js';
import { toast } from '../../vendor/ewo/elements/toaster.js';
import { ApiError } from './api.ts';
import { t, type Key } from './i18n.svelte.ts';

export const ui = $state({ settings: false });

/** The words for a failed request. */
export function problem(error: unknown): string {
  if (error instanceof ApiError) {
    const code = String(error.body.error ?? '');
    const known: Record<string, Key> = {
      taken: 'err.taken',
      exists: 'err.exists',
      closed: 'err.closed',
      code: 'err.code',
      tries: 'err.tries',
      gone: 'err.gone',
      people: 'err.people',
      'too many new groups': 'err.rate',
      impossible: 'err.impossible',
      party: 'err.party',
      link: 'err.link',
      stage: 'err.stage',
      few: 'err.few',
      redraw: 'err.redraw',
    };
    if (code === 'code' && typeof error.body.left === 'number') return t('err.codeLeft', { n: error.body.left });
    if (known[code]) return t(known[code]);
    if (error.status === 413) return t('err.long');
    if (error.status >= 500) return t('err.server');
    return t('err.generic');
  }
  return t('err.offline');
}

/** Runs a request with its wait shown at `control`; a failure is a toast. Resolves undefined on failure. */
export async function act<T>(control: Element | null | undefined, run: () => Promise<T>, label?: string): Promise<T | undefined> {
  try {
    return await track(control, () => run(), { label });
  } catch (error) {
    toast(problem(error), { tone: 'bad' });
    return undefined;
  }
}

export function say(message: string, tone: 'neutral' | 'ok' | 'accent' = 'neutral') {
  toast(message, { tone });
}

/** Copies text; on a device that refuses, says so. */
export async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    say(done, 'ok');
  } catch {
    say(t('copy.failed'));
  }
}
