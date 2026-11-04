// A group as the server keeps it, what each kind of link may see of it, and the cleaning of
// everything a page sends. No dependencies.
//
// The group (one JSON document per row):
//   { name, party 'YYYY-MM-DD', time 'HH:MM' | '', place, budget cents | null, note,
//     handover 'party' | 'post' (the default), shape 'chain' | 'any', moment 'quiet' | 'live',
//     selfAdd, lang 'de' | 'en', practice, created,
//     people: [Person], households: [[id, …]], draw: null | { at, shape, how, round, pairs }, log }
// A person:
//   { id, name, host, dummy, joinedAt (claimed), handover, address, wishes [{ t, l }], not,
//     wishesAt (their wishes, handover or address last changed), openedAt and seenAt (their draw),
//     changedAt (their draw changed after they opened it), ready (their gift),
//     posted and arrived (the parcel *to* them: tracked per recipient, so the host's view never
//     tells whose person wants post) }

import { possible } from '../shared/draw.mjs';

export const LIMITS = { people: 100, name: 40, groupName: 60, place: 120, note: 600, wishes: 8, wish: 120, link: 500, address: 300, not: 200, log: 300 };
const DAY = 86_400_000;
/** Everything goes 30 days after the party; a practice group after a day. */
export const KEEP_DAYS = 30;

/** Today's date in Berlin, as `YYYY-MM-DD`. */
export const today = (now = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(now);

const dateMs = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/** When a group is deleted: 03:00 in Berlin (02:00 UTC in winter) on the 30th day after its party. */
export const deleteAt = (doc) => (doc.practice ? doc.created + DAY : dateMs(doc.party) + KEEP_DAYS * DAY + 2 * 3_600_000);

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const bad = (what) => new HttpError(400, what);
const text = (value, max, what, { multiline = false } = {}) => {
  if (value == null) return '';
  if (typeof value !== 'string') throw bad(what);
  let s = value.replace(/\r\n?/g, '\n');
  s = multiline
    ? s
        .split('\n')
        .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : s.replace(/\s+/g, ' ').trim();
  if ([...s].length > max) throw new HttpError(413, what);
  return s;
};

export function cleanName(value) {
  const name = text(value, LIMITS.name, 'name');
  if (!name) throw bad('name');
  return name;
}

const fold = (name) => name.toLocaleLowerCase('de').normalize('NFKC');
export const sameName = (a, b) => fold(a) === fold(b);

export function cleanDate(value, { now = Date.now(), from = null } = {}) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw bad('party');
  const ms = dateMs(value);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value) throw bad('party');
  // A new date lies between today and about a year ahead; an unchanged one may already have passed.
  if (value !== from && (value < today(now) || ms > dateMs(today(now)) + 400 * DAY)) throw new HttpError(400, 'party', { range: true });
  return value;
}

export function cleanLink(value) {
  if (!value) return '';
  if (typeof value !== 'string' || [...value].length > LIMITS.link) throw bad('link');
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw bad('link');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw bad('link');
  return url.href;
}

export function cleanWishes(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > LIMITS.wishes) throw bad('wishes');
  return value
    .map((w) => ({ t: text(w?.t, LIMITS.wish, 'wish'), l: cleanLink(w?.l) }))
    .filter((w) => w.t || w.l);
}

/** A group's settings from the page; only the fields present change. */
export function cleanSettings(body, current, { now = Date.now(), creating = false } = {}) {
  const out = {};
  if ('name' in body || creating) {
    out.name = text(body.name, LIMITS.groupName, 'group name');
    if (!out.name) throw bad('group name');
  }
  if ('party' in body || creating) out.party = cleanDate(body.party, { now, from: current?.party ?? null });
  if ('time' in body) {
    out.time = body.time ? String(body.time) : '';
    if (out.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(out.time)) throw bad('time');
  }
  if ('place' in body) out.place = text(body.place, LIMITS.place, 'place');
  if ('note' in body) out.note = text(body.note, LIMITS.note, 'note', { multiline: true });
  if ('budget' in body) {
    const b = body.budget;
    if (b === null || b === '' || b === undefined) out.budget = null;
    else if (Number.isInteger(b) && b >= 0 && b <= 1_000_000) out.budget = b;
    else throw bad('budget');
  }
  if ('handover' in body) {
    if (body.handover !== 'party' && body.handover !== 'post') throw bad('handover');
    out.handover = body.handover;
  }
  if ('shape' in body) {
    if (body.shape !== 'chain' && body.shape !== 'any') throw bad('shape');
    if (current?.draw && body.shape !== current.shape) throw new HttpError(409, 'drawn');
    out.shape = body.shape;
  }
  if ('moment' in body) {
    if (body.moment !== 'quiet' && body.moment !== 'live') throw bad('moment');
    out.moment = body.moment;
  }
  if ('selfAdd' in body) out.selfAdd = !!body.selfAdd;
  if ('lang' in body) out.lang = body.lang === 'en' ? 'en' : 'de';
  return out;
}

/** A person's own details from their page. */
export function cleanDetails(body) {
  const out = {};
  if ('handover' in body) {
    if (body.handover !== 'party' && body.handover !== 'post') throw bad('handover');
    out.handover = body.handover;
  }
  if ('address' in body) {
    out.address = text(body.address, LIMITS.address, 'address', { multiline: true });
    if (out.address.split('\n').length > 8) throw bad('address');
  }
  if ('wishes' in body) out.wishes = cleanWishes(body.wishes);
  if ('not' in body) out.not = text(body.not, LIMITS.not, 'not');
  return out;
}

export function person(id, name, extra = {}) {
  return {
    id,
    name,
    host: false,
    dummy: false,
    joinedAt: null,
    handover: null,
    address: '',
    wishes: [],
    not: '',
    wishesAt: null,
    openedAt: null,
    seenAt: null,
    changedAt: null,
    ready: null,
    posted: null,
    arrived: null,
    ...extra,
  };
}

export function log(doc, t, extra = {}, now = Date.now()) {
  doc.log.push({ at: now, t, ...extra });
  if (doc.log.length > LIMITS.log) doc.log.splice(0, doc.log.length - LIMITS.log);
}

const handoverOf = (doc, p) => p.handover ?? doc.handover;

/** The event details every link shows. */
function details(doc, row) {
  return {
    name: doc.name,
    host: doc.people.find((p) => p.host)?.name ?? '',
    party: doc.party,
    time: doc.time,
    place: doc.place,
    budget: doc.budget,
    note: doc.note,
    lang: doc.lang,
    practice: doc.practice,
    handover: doc.handover,
    shape: doc.shape,
    moment: doc.moment,
    deleteAt: row.deleteAt,
    drawn: !!doc.draw,
  };
}

const roll = (doc) => doc.people.map((p) => ({ id: p.id, name: p.name, joined: !!p.joinedAt }));

/** The group link: the event, the names and who has joined. */
export function groupView(doc, row, stage) {
  return { kind: 'g', group: { ...details(doc, row), selfAdd: doc.selfAdd && !doc.draw }, people: roll(doc), stage };
}

/** A personal link: their own details, the names, and their draw's state (never who). */
export function personView(doc, row, id, groupKey, stage) {
  const me = doc.people.find((p) => p.id === id);
  const recipient = doc.draw ? doc.people.find((p) => p.id === doc.draw.pairs[id]) : null;
  return {
    kind: 'p',
    group: details(doc, row),
    groupKey,
    me: {
      id: me.id,
      name: me.name,
      host: me.host,
      handover: handoverOf(doc, me),
      chosen: me.handover !== null,
      address: me.address,
      wishes: me.wishes,
      not: me.not,
      opened: !!me.openedAt,
      ready: !!me.ready,
      arrived: !!me.arrived,
      // Your gift is on its way: someone posted it, never who.
      incoming: !!me.posted,
      inDraw: !!doc.draw && id in doc.draw.pairs,
      changed: !!me.changedAt,
      wishesChanged: !!(recipient && me.seenAt && recipient.wishesAt && recipient.wishesAt > me.seenAt),
    },
    people: roll(doc),
    stage,
  };
}

/** The person someone drew, for their reveal. */
export function recipientView(doc, recipient, budget = doc.budget) {
  const post = handoverOf(doc, recipient) === 'post';
  return {
    id: recipient.id,
    name: recipient.name,
    handover: handoverOf(doc, recipient),
    address: post ? recipient.address : '',
    wishes: recipient.wishes,
    not: recipient.not,
    budget,
  };
}

/** The host's link: the setup, everyone's status (indexed by person, never by pair) and the log. */
export function hostView(doc, row, groupKey, { stage, unsealed, dummyKeys }) {
  const view = {
    kind: 'h',
    group: { ...details(doc, row), selfAdd: doc.selfAdd },
    groupKey,
    people: doc.people.map((p) => ({
      id: p.id,
      name: p.name,
      host: p.host,
      dummy: p.dummy,
      joined: !!p.joinedAt,
      handover: handoverOf(doc, p),
      wishes: p.wishes.length > 0,
      opened: !!p.openedAt,
      ready: !!p.ready,
      parcel: p.arrived ? 'arrived' : p.posted ? 'way' : null,
      key: dummyKeys?.get(p.id),
    })),
    households: doc.households,
    draw: doc.draw ? { at: doc.draw.at, shape: doc.draw.shape, how: doc.draw.how, round: doc.draw.round } : null,
    check: possible(
      doc.people.map((p) => p.id),
      doc.households,
    ),
    log: doc.log,
    stage,
    unsealed: null,
  };
  if (unsealed) {
    const name = (id) => doc.people.find((p) => p.id === id)?.name ?? '';
    view.unsealed = {
      until: unsealed.until,
      pairs: doc.draw ? Object.entries(doc.draw.pairs).map(([g, r]) => ({ giver: g, recipient: r, from: name(g), to: name(r) })) : [],
      people: doc.people.map((p) => ({ id: p.id, name: p.name, handover: handoverOf(doc, p), address: p.address, wishes: p.wishes, not: p.not })),
    };
  }
  return view;
}
