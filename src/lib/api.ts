// The server's API (server/api.mjs) as the pages use it, and the live stream that tells a page to
// fetch again. The types mirror what the server sends (server/model.mjs).

export type Handover = 'party' | 'post';
export type Wish = { t: string; l: string };

export interface Details {
  name: string;
  host: string;
  party: string;
  time: string;
  place: string;
  budget: number | null;
  note: string;
  lang: 'de' | 'en';
  practice: boolean;
  handover: Handover;
  shape: 'chain' | 'any';
  moment: 'quiet' | 'live';
  deleteAt: number;
  drawn: boolean;
  selfAdd?: boolean;
}

export interface Stage {
  until: number;
  n: number;
}

export interface Roll {
  id: string;
  name: string;
  joined: boolean;
}

interface Common {
  now: number;
  v: number;
  stage: Stage | null;
}

export interface GroupView extends Common {
  kind: 'g';
  group: Details;
  people: Roll[];
}

export interface PersonView extends Common {
  kind: 'p';
  group: Details;
  groupKey: string;
  me: {
    id: string;
    name: string;
    host: boolean;
    handover: Handover;
    chosen: boolean;
    address: string;
    wishes: Wish[];
    not: string;
    opened: boolean;
    ready: boolean;
    arrived: boolean;
    incoming: boolean;
    inDraw: boolean;
    changed: boolean;
    wishesChanged: boolean;
  };
  people: Roll[];
}

export interface Recipient {
  id: string;
  name: string;
  handover: Handover;
  address: string;
  wishes: Wish[];
  not: string;
  budget: number | null;
}

export interface HostPerson {
  id: string;
  name: string;
  host: boolean;
  dummy: boolean;
  joined: boolean;
  handover: Handover;
  wishes: boolean;
  opened: boolean;
  ready: boolean;
  parcel: 'way' | 'arrived' | null;
  key?: string;
}

export interface LogLine {
  at: number;
  t: string;
  n?: string;
  to?: string;
  c?: number;
  shape?: string;
  live?: boolean;
}

export interface HostView extends Common {
  kind: 'h';
  group: Details & { selfAdd: boolean };
  groupKey: string;
  people: HostPerson[];
  households: string[][];
  draw: { at: number; shape: 'chain' | 'any'; how: string; round: number } | null;
  check: { ok: true } | { ok: false; reason: 'few' | 'household'; household?: number };
  log: LogLine[];
  unsealed: null | {
    until: number;
    pairs: { giver: string; recipient: string; from: string; to: string }[];
    people: { id: string; name: string; handover: Handover; address: string; wishes: Wish[]; not: string }[];
  };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
  ) {
    super(String(body.error ?? status));
  }
}

async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (res.status === 204) return undefined as T;
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export const get = <T>(path: string, headers?: Record<string, string>) => request<T>('GET', `/api${path}`, undefined, headers);
export const post = <T = { ok: true }>(path: string, body: unknown = {}) => request<T>('POST', `/api${path}`, body);

export type LiveState = 'connecting' | 'reconnecting' | 'online';

/**
 * The group's stream for a key: `onChange` whenever something changed (and once it's open), `onGone`
 * when the key stops working. EventSource reconnects on its own; the state is for <ewo-connection>.
 */
export function live(key: string, { onChange, onGone, onState }: { onChange: () => void; onGone: () => void; onState: (s: LiveState) => void }) {
  let source: EventSource | null = null;
  let closed = false;
  let opened = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const open = () => {
    if (closed) return;
    source = new EventSource(`/api/live/${key}`);
    onState(opened ? 'reconnecting' : 'connecting');
    source.addEventListener('v', () => {
      opened = true;
      onState('online');
      onChange();
    });
    source.addEventListener('gone', () => {
      close();
      onGone();
    });
    source.onerror = () => {
      if (closed) return;
      onState(opened ? 'reconnecting' : 'connecting');
      // A closed stream (the server restarted, or the key is gone) isn't retried by the browser.
      if (source?.readyState === EventSource.CLOSED) {
        source = null;
        retry = setTimeout(open, 3000);
      }
    };
  };
  const close = () => {
    closed = true;
    clearTimeout(retry);
    source?.close();
  };
  // Back from the background: the phone may have dropped the stream without saying so.
  const wake = () => {
    if (document.visibilityState === 'visible' && !closed) onChange();
  };
  document.addEventListener('visibilitychange', wake);
  open();
  return () => {
    close();
    document.removeEventListener('visibilitychange', wake);
  };
}
