// The groups' API. Every route is under /api/; a link's letter (g, h, p) must match its key's kind.
//
//   POST /api/groups                  { name, party, …, host, names, code } or { practice, host, lang }
//                                                          → { group, host, me }
//   GET  /api/live/<key>              server-sent events: v (something changed: fetch again), gone
//   GET  /api/g/<key>                 the event, the names and who has joined
//   POST /api/g/<key>/claim           { id }            → { me }    (409 if someone has it)
//   POST /api/g/<key>/join            { name }          → { me }    (before the draw, if the host allows it)
//   POST /api/g/<key>/recover         { code }          → { host }  (a new host link; the old one stops)
//   GET  /api/h/<key>                 the host's view; with a valid `x-unseal` header, every pair and address
//   POST /api/h/<key>/<action>        settings, add, rename, remove, households, reset, draw, redraw,
//                                     unseal, seal, code, rekey, delete
//   GET  /api/p/<key>                 a person's own page: their details and their draw's state
//   POST /api/p/<key>/me              { handover, address, wishes, not }
//   POST /api/p/<key>/reveal                            → the person they drew
//   POST /api/p/<key>/steps           { ready, posted, arrived }
//
// Links are keys: 128 random bits each (learnings/randomness.md), none derived from another. Nothing
// secret is ever in a page's HTML or a GET a messenger could fetch for a preview: a claim, an
// opening and a reveal are POSTs after a tap. The host never sees the pairs or the addresses unless
// they unseal the group with its code (five tries per 15 minutes, half an hour open, a line in the
// log). The draw is made here, from node:crypto, before any staging.

import { randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { draw, patchIn, patchOut, possible, valid, changedGivers } from '../shared/draw.mjs';
import {
  HttpError,
  LIMITS,
  cleanDetails,
  cleanName,
  cleanSettings,
  deleteAt,
  groupView,
  hostView,
  log,
  person,
  personView,
  recipientView,
  sameName,
  today,
} from './model.mjs';
import { COUPLE, PRACTICE_CODE, dummies, step } from './practice.mjs';

const scrypt = promisify(scryptCallback);

const HEARTBEAT = 20_000;
const BODY_LIMIT = 64_000;
/** New groups per address per hour. */
const NEW_PER_HOUR = 20;
const KEY = /^[A-Za-z0-9_-]{22}$/;
/** Wrong codes allowed per group in TRY_WINDOW. */
const TRIES = 5;
const TRY_WINDOW = 15 * 60_000;
/** How long a right code keeps the full view open on that device. */
const UNSEAL_FOR = 30 * 60_000;
/** The live draw: a candle per person, then a breath before every page opens its door. */
export const STAGE_PER = 280;
export const STAGE_TAIL = 2200;
const PRACTICE_TICK = 3000;
const SWEEP = 3_600_000;

export const newKey = () => randomBytes(16).toString('base64url');
const newId = () => randomBytes(6).toString('base64url');

async function readJson(req, limit = BODY_LIMIT) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'too large');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, 'not JSON');
  }
}

function json(res, status, body) {
  const raw = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-length': raw.length });
  res.end(raw);
}

async function hashCode(code, salt) {
  return (await scrypt(code.normalize('NFKC'), salt, 32)).toString('hex');
}

const cleanCode = (code) => {
  if (typeof code !== 'string') throw new HttpError(400, 'code');
  const c = code.trim();
  if ([...c].length < 6 || c.length > 64) throw new HttpError(400, 'code');
  return c;
};

/** The party three weeks from today, for a practice run. */
function inThreeWeeks(now) {
  const [y, m, d] = today(now).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 21)).toISOString().slice(0, 10);
}

export function createApi({ store, now = Date.now, random = randomInt, timers = true, pace = 1 }) {
  /** Groups in use, by row id: { id, row, streams, busy }. Saved on every change. */
  const rooms = new Map();
  /** New groups per address in the last hour; the addresses stay here and nowhere else. */
  const made = new Map();
  /** Wrong codes per group: their times. */
  const tries = new Map();
  /** Unseal tokens: token → { grp, until }. */
  const tokens = new Map();

  function room(id) {
    let r = rooms.get(id);
    if (r) return r;
    const row = store.get(id);
    if (!row) return null;
    r = { id, row, streams: new Set(), busy: 0 };
    rooms.set(id, r);
    return r;
  }

  /** Drops a room from memory once no request and no stream has it. */
  function release(r) {
    if (!r.streams.size && !r.busy) rooms.delete(r.id);
  }

  function resolve(key) {
    if (!KEY.test(key)) return null;
    const k = store.key(key);
    if (!k) return null;
    const r = room(k.grp);
    if (!r) return null;
    // Past its time but not swept yet: already gone for everyone.
    if (r.row.deleteAt <= now()) {
      release(r);
      return null;
    }
    if (k.kind === 'p' && !r.row.doc.people.some((p) => p.id === k.person)) {
      release(r);
      return null;
    }
    return { room: r, kind: k.kind, person: k.person, key };
  }

  function send(stream, event, data) {
    stream.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function end(stream) {
    send(stream, 'gone', {});
    stream.res.end();
  }

  /** Saves a change and tells every open page to fetch again. */
  function commit(r) {
    const row = r.row;
    row.version += 1;
    row.deleteAt = deleteAt(row.doc);
    store.save(r.id, row.doc, row.version, row.deleteAt);
    for (const s of r.streams) send(s, 'v', { v: row.version });
  }

  /** Saves without telling anyone: nothing they'd see changed. */
  function saveQuietly(r) {
    store.save(r.id, r.row.doc, r.row.version, r.row.deleteAt);
  }

  const stageOf = (doc) => (doc.draw?.until > now() ? { until: doc.draw.until, n: Object.keys(doc.draw.pairs).length } : null);
  const groupKeyOf = (id) => store.keysOf(id).find((k) => k.kind === 'g')?.key;

  function rateOk(req) {
    // Behind the tunnel every request comes from cloudflared: Cloudflare's header names the visitor.
    const address = String(req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress ?? '');
    const hour = now() - 3_600_000;
    const times = (made.get(address) ?? []).filter((t) => t > hour);
    if (times.length >= NEW_PER_HOUR) return false;
    times.push(now());
    made.set(address, times);
    if (made.size > 5000) for (const [a, list] of made) if (!list.some((t) => t > hour)) made.delete(a);
    return true;
  }

  async function checkCode(r, code) {
    const t = now();
    const recent = (tries.get(r.id) ?? []).filter((x) => x > t - TRY_WINDOW);
    if (recent.length >= TRIES) throw new HttpError(429, 'tries', { retry: recent[0] + TRY_WINDOW });
    let ok = false;
    if (typeof code === 'string' && code.trim().length <= 64) {
      const hash = Buffer.from(await hashCode(code.trim(), r.row.salt), 'hex');
      ok = timingSafeEqual(hash, Buffer.from(r.row.hash, 'hex'));
    }
    if (!ok) {
      recent.push(t);
      tries.set(r.id, recent);
      if (recent.length >= TRIES) {
        log(r.row.doc, 'locked', {}, t);
        commit(r);
      }
      throw new HttpError(403, 'code', { left: TRIES - recent.length });
    }
    tries.delete(r.id);
  }

  // ---- making a group ----

  async function create(req, res) {
    const body = await readJson(req);
    if (!rateOk(req)) throw new HttpError(429, 'too many new groups');
    const t = now();
    const lang = body.lang === 'en' ? 'en' : 'de';
    const practice = !!body.practice;
    const hostName = cleanName(body.host?.name);
    const hostJoins = practice || body.host?.joins !== false;
    const settings = practice
      ? {
          name: lang === 'de' ? 'Probelauf' : 'Practice run',
          party: inThreeWeeks(t),
          time: '18:00',
          place: lang === 'de' ? 'Im Büro, dritter Stock' : 'At the office, third floor',
          budget: 2500,
          note: lang === 'de' ? 'Ein Probelauf mit ausgedachten Kolleg:innen.' : 'A practice run with made-up colleagues.',
          handover: 'party',
          shape: 'chain',
          moment: 'live',
          selfAdd: true,
        }
      : cleanSettings(body, null, { now: t, creating: true });
    const code = practice ? PRACTICE_CODE : cleanCode(body.code);

    const doc = {
      name: '',
      party: '',
      time: '',
      place: '',
      budget: null,
      note: '',
      handover: 'party',
      shape: 'chain',
      moment: 'quiet',
      selfAdd: true,
      ...settings,
      lang,
      practice,
      created: t,
      people: [],
      households: [],
      draw: null,
      log: [],
    };
    const keys = [];
    const add = (name, extra) => {
      if (doc.people.some((p) => sameName(p.name, name))) return null;
      const p = person(newId(), name, extra);
      doc.people.push(p);
      return p;
    };
    let me = null;
    if (hostJoins) {
      const host = add(hostName, { host: true, joinedAt: t });
      me = newKey();
      keys.push({ key: me, kind: 'p', person: host.id });
    }
    if (practice) {
      const list = dummies(hostName, lang, random);
      const added = list.map((d) => add(d.name, { dummy: true, plan: d.plan }));
      for (const p of added) keys.push({ key: newKey(), kind: 'p', person: p.id });
      doc.households.push(COUPLE.map((i) => added[i].id));
    } else {
      const names = Array.isArray(body.names) ? body.names : [];
      if (names.length > LIMITS.people) throw new HttpError(413, 'people');
      for (const name of names) add(cleanName(name));
      if (doc.people.length > LIMITS.people) throw new HttpError(413, 'people');
    }
    log(doc, 'created', { n: hostName }, t);

    const salt = randomBytes(16).toString('hex');
    const hash = await hashCode(code, salt);
    const group = newKey();
    const host = newKey();
    keys.push({ key: group, kind: 'g' }, { key: host, kind: 'h' });
    store.create(doc, { salt, hash, practice, deleteAt: deleteAt(doc) }, keys);
    json(res, 201, { group, host, me });
  }

  // ---- the live stream ----

  function live(req, res, found) {
    const { room: r } = found;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 4000\n\n');
    const stream = { res, kind: found.kind, person: found.person, key: found.key };
    r.streams.add(stream);
    send(stream, 'v', { v: r.row.version });
    const beat = setInterval(() => res.write('event: ping\ndata: 1\n\n'), HEARTBEAT);
    beat.unref?.();
    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      clearInterval(beat);
      r.streams.delete(stream);
      release(r);
    };
    req.on('close', close);
    res.on('error', close);
  }

  // ---- the group link ----

  async function groupAction(req, res, found, action) {
    const r = found.room;
    const doc = r.row.doc;
    const body = await readJson(req);
    const t = now();
    if (action === 'claim') {
      const p = doc.people.find((x) => x.id === body.id);
      if (!p) throw new HttpError(404, 'no such name');
      if (p.joinedAt) throw new HttpError(409, 'taken');
      store.dropPersonKeys(r.id, p.id);
      const me = newKey();
      store.addKey(me, r.id, 'p', p.id);
      p.joinedAt = t;
      // A practice colleague claimed by a real person stops acting on their own.
      if (p.dummy) p.plan = null;
      log(doc, 'claim', { n: p.name }, t);
      commit(r);
      return json(res, 200, { me });
    }
    if (action === 'join') {
      if (doc.draw || !doc.selfAdd) throw new HttpError(409, 'closed');
      const name = cleanName(body.name);
      if (doc.people.some((p) => sameName(p.name, name))) throw new HttpError(409, 'exists');
      if (doc.people.length >= LIMITS.people) throw new HttpError(413, 'people');
      const p = person(newId(), name, { joinedAt: t });
      doc.people.push(p);
      const me = newKey();
      store.addKey(me, r.id, 'p', p.id);
      log(doc, 'join', { n: name }, t);
      commit(r);
      return json(res, 200, { me });
    }
    if (action === 'recover') {
      await checkCode(r, body.code);
      const host = newKey();
      store.rekeyHost(r.id, host);
      for (const s of [...r.streams]) {
        if (s.kind !== 'h') continue;
        end(s);
        r.streams.delete(s);
      }
      log(doc, 'recover', {}, t);
      commit(r);
      return json(res, 200, { host });
    }
    throw new HttpError(404, 'not here');
  }

  // ---- the host's link ----

  /** Resets a giver whose person changed: they open their door again, their gift isn't ready. */
  function applyDraw(doc, pairs, t, { all = false } = {}) {
    const before = doc.draw?.pairs ?? {};
    const givers = all ? Object.keys(pairs) : changedGivers(before, pairs);
    const recipientsBefore = new Map(Object.entries(before).map(([g, r]) => [r, g]));
    for (const p of doc.people) {
      if (givers.includes(p.id)) {
        if (p.openedAt) p.changedAt = t;
        p.openedAt = null;
        p.ready = null;
      }
      // Whoever now gives to them hasn't posted anything yet.
      const giverNow = Object.keys(pairs).find((g) => pairs[g] === p.id);
      if (giverNow !== recipientsBefore.get(p.id)) {
        p.posted = null;
        p.arrived = null;
      }
    }
    doc.draw.pairs = pairs;
    return givers.length;
  }

  function redraw(doc, t) {
    const ids = doc.people.map((p) => p.id);
    const { pairs, how } = draw(ids, doc.households, doc.draw.shape, random);
    applyDraw(doc, pairs, t, { all: true });
    doc.draw.how = how;
    doc.draw.at = t;
    doc.draw.until = 0;
    doc.draw.round += 1;
  }

  function cleanHouseholds(value, doc) {
    if (!Array.isArray(value)) throw new HttpError(400, 'households');
    const ids = new Set(doc.people.map((p) => p.id));
    const seen = new Set();
    const out = [];
    for (const h of value) {
      if (!Array.isArray(h)) throw new HttpError(400, 'households');
      const members = [...new Set(h)].filter((id) => ids.has(id));
      if (members.some((id) => seen.has(id))) throw new HttpError(400, 'households');
      members.forEach((id) => seen.add(id));
      if (members.length >= 2) out.push(members);
    }
    return out;
  }

  async function hostAction(req, res, found, action) {
    const r = found.room;
    const doc = r.row.doc;
    const body = await readJson(req);
    const t = now();
    const find = (id) => {
      const p = doc.people.find((x) => x.id === id);
      if (!p) throw new HttpError(404, 'no such person');
      return p;
    };

    switch (action) {
      case 'settings': {
        Object.assign(doc, cleanSettings(body, { ...doc, shape: doc.draw ? doc.draw.shape : doc.shape }, { now: t }));
        commit(r);
        return json(res, 200, { ok: true });
      }
      case 'add': {
        const names = (Array.isArray(body.names) ? body.names : []).map(cleanName);
        if (!names.length) throw new HttpError(400, 'names');
        for (const [i, name] of names.entries()) {
          if (doc.people.some((p) => sameName(p.name, name)) || names.slice(0, i).some((n) => sameName(n, name))) throw new HttpError(409, 'exists', { name });
        }
        if (doc.people.length + names.length > LIMITS.people) throw new HttpError(413, 'people');
        const added = names.map((name) => person(newId(), name));
        let changes = 0;
        if (doc.draw) {
          if (body.mode !== 'patch' && body.mode !== 'redraw') throw new HttpError(409, 'mode');
          if (body.mode === 'patch') {
            let pairs = doc.draw.pairs;
            const ids = doc.people.map((p) => p.id);
            for (const p of added) {
              pairs = patchIn(pairs, p.id, [...ids], doc.households, doc.draw.shape, random);
              if (!pairs) throw new HttpError(409, 'redraw');
              ids.push(p.id);
            }
            doc.people.push(...added);
            changes = applyDraw(doc, pairs, t);
          } else {
            doc.people.push(...added);
            redraw(doc, t);
          }
        } else doc.people.push(...added);
        for (const p of added) log(doc, 'added', { n: p.name }, t);
        if (doc.draw) log(doc, body.mode === 'redraw' ? 'redrawn' : 'patched', { c: changes }, t);
        commit(r);
        return json(res, 200, { changes, redrawn: body.mode === 'redraw' && !!doc.draw });
      }
      case 'rename': {
        const p = find(body.id);
        const name = cleanName(body.name);
        if (doc.people.some((x) => x.id !== p.id && sameName(x.name, name))) throw new HttpError(409, 'exists', { name });
        log(doc, 'renamed', { n: p.name, to: name }, t);
        p.name = name;
        commit(r);
        return json(res, 200, { ok: true });
      }
      case 'remove': {
        const p = find(body.id);
        const ids = doc.people.map((x) => x.id).filter((id) => id !== p.id);
        const households = doc.households.map((h) => h.filter((id) => id !== p.id)).filter((h) => h.length >= 2);
        let changes = 0;
        if (doc.draw) {
          if (body.mode !== 'patch' && body.mode !== 'redraw') throw new HttpError(409, 'mode');
          if (!possible(ids, households).ok) throw new HttpError(409, 'few');
          if (body.mode === 'patch') {
            const pairs = patchOut(doc.draw.pairs, p.id, [...ids, p.id], households, doc.draw.shape, random);
            if (!pairs) throw new HttpError(409, 'redraw');
            doc.people = doc.people.filter((x) => x.id !== p.id);
            doc.households = households;
            changes = applyDraw(doc, pairs, t);
          } else {
            doc.people = doc.people.filter((x) => x.id !== p.id);
            doc.households = households;
            redraw(doc, t);
          }
        } else {
          doc.people = doc.people.filter((x) => x.id !== p.id);
          doc.households = households;
        }
        store.dropPersonKeys(r.id, p.id);
        for (const s of [...r.streams]) {
          if (s.kind === 'p' && s.person === p.id) {
            end(s);
            r.streams.delete(s);
          }
        }
        log(doc, 'removed', { n: p.name }, t);
        if (doc.draw) log(doc, body.mode === 'redraw' ? 'redrawn' : 'patched', { c: changes }, t);
        commit(r);
        return json(res, 200, { changes, redrawn: body.mode === 'redraw' && !!doc.draw });
      }
      case 'households': {
        const households = cleanHouseholds(body.households, doc);
        const ids = doc.people.map((p) => p.id);
        if (doc.draw && !valid(doc.draw.pairs, ids, households, doc.draw.shape)) {
          if (!body.redraw) throw new HttpError(409, 'redraw');
          if (!possible(ids, households).ok) throw new HttpError(409, 'impossible');
          doc.households = households;
          redraw(doc, t);
          log(doc, 'households', {}, t);
          log(doc, 'redrawn', {}, t);
        } else {
          doc.households = households;
          log(doc, 'households', {}, t);
        }
        commit(r);
        return json(res, 200, { ok: true });
      }
      case 'reset': {
        const p = find(body.id);
        store.dropPersonKeys(r.id, p.id);
        Object.assign(p, { joinedAt: null, handover: null, address: '', wishes: [], not: '', wishesAt: null, openedAt: null, seenAt: null, changedAt: null, ready: null, arrived: null });
        for (const s of [...r.streams]) {
          if (s.kind === 'p' && s.person === p.id) {
            end(s);
            r.streams.delete(s);
          }
        }
        log(doc, 'reset', { n: p.name }, t);
        commit(r);
        return json(res, 200, { ok: true });
      }
      case 'draw': {
        if (doc.draw) throw new HttpError(409, 'drawn');
        const ids = doc.people.map((p) => p.id);
        const check = possible(ids, doc.households);
        if (!check.ok) throw new HttpError(409, 'impossible', check);
        const { pairs, how } = draw(ids, doc.households, doc.shape, random);
        const live = doc.moment === 'live';
        doc.draw = { at: t, shape: doc.shape, how, round: 1, pairs, until: live ? t + ids.length * STAGE_PER + STAGE_TAIL : 0 };
        log(doc, 'drawn', { shape: doc.shape, live }, t);
        commit(r);
        return json(res, 200, { stage: stageOf(doc) });
      }
      case 'redraw': {
        if (!doc.draw) throw new HttpError(409, 'not drawn');
        redraw(doc, t);
        log(doc, 'redrawn', {}, t);
        commit(r);
        return json(res, 200, { ok: true });
      }
      case 'unseal': {
        await checkCode(r, body.code);
        const token = newKey();
        const until = t + UNSEAL_FOR;
        tokens.set(token, { grp: r.id, until });
        for (const [k, v] of tokens) if (v.until <= t) tokens.delete(k);
        log(doc, 'unseal', {}, t);
        commit(r);
        return json(res, 200, { token, until });
      }
      case 'seal': {
        if (typeof body.token === 'string') tokens.delete(body.token);
        return json(res, 200, { ok: true });
      }
      case 'code': {
        await checkCode(r, body.old);
        const next = cleanCode(body.next);
        const salt = randomBytes(16).toString('hex');
        r.row.salt = salt;
        r.row.hash = await hashCode(next, salt);
        store.setCode(r.id, salt, r.row.hash);
        // Whoever had the old code open loses it.
        for (const [k, v] of tokens) if (v.grp === r.id) tokens.delete(k);
        log(doc, 'code', {}, t);
        commit(r);
        return json(res, 200, { ok: true });
      }
      case 'rekey': {
        const host = newKey();
        store.rekeyHost(r.id, host);
        for (const s of [...r.streams]) {
          if (s.kind !== 'h') continue;
          end(s);
          r.streams.delete(s);
        }
        log(doc, 'rekey', {}, t);
        commit(r);
        return json(res, 200, { host });
      }
      case 'delete': {
        for (const s of r.streams) end(s);
        r.streams.clear();
        store.remove(r.id);
        for (const [k, v] of tokens) if (v.grp === r.id) tokens.delete(k);
        tries.delete(r.id);
        rooms.delete(r.id);
        res.writeHead(204).end();
        return;
      }
      default:
        throw new HttpError(404, 'not here');
    }
  }

  function hostLoad(req, res, found) {
    const r = found.room;
    const token = req.headers['x-unseal'];
    const open = typeof token === 'string' ? tokens.get(token) : null;
    const unsealed = open && open.grp === r.id && open.until > now() ? open : null;
    const keys = store.keysOf(r.id);
    const dummyKeys = r.row.practice ? new Map(keys.filter((k) => k.kind === 'p' && r.row.doc.people.find((p) => p.id === k.person)?.dummy).map((k) => [k.person, k.key])) : null;
    const view = hostView(r.row.doc, r.row, keys.find((k) => k.kind === 'g')?.key, { stage: stageOf(r.row.doc), unsealed, dummyKeys });
    json(res, 200, { ...view, now: now(), v: r.row.version });
  }

  // ---- a personal link ----

  async function personAction(req, res, found, action) {
    const r = found.room;
    const doc = r.row.doc;
    const body = await readJson(req);
    const t = now();
    const me = doc.people.find((p) => p.id === found.person);
    if (action === 'me') {
      const details = cleanDetails(body);
      const before = JSON.stringify([me.handover, me.address, me.wishes, me.not]);
      Object.assign(me, details);
      if (JSON.stringify([me.handover, me.address, me.wishes, me.not]) !== before) me.wishesAt = t;
      commit(r);
      return json(res, 200, { ok: true });
    }
    if (action === 'reveal') {
      if (!doc.draw || !(me.id in doc.draw.pairs)) throw new HttpError(409, 'not drawn');
      if (stageOf(doc)) throw new HttpError(425, 'stage', { until: doc.draw.until });
      const recipient = doc.people.find((p) => p.id === doc.draw.pairs[me.id]);
      const wishesChanged = !!(me.seenAt && recipient.wishesAt && recipient.wishesAt > me.seenAt);
      const visible = !me.openedAt || me.changedAt;
      me.openedAt ??= t;
      me.seenAt = t;
      me.changedAt = null;
      if (visible) commit(r);
      else saveQuietly(r);
      return json(res, 200, { recipient: recipientView(doc, recipient), wishesChanged, ready: !!me.ready, posted: !!recipient.posted });
    }
    if (action === 'steps') {
      if (!doc.draw || !(me.id in doc.draw.pairs)) throw new HttpError(409, 'not drawn');
      const recipient = doc.people.find((p) => p.id === doc.draw.pairs[me.id]);
      if ('ready' in body) {
        if (!me.openedAt) throw new HttpError(409, 'not opened');
        me.ready = body.ready ? (me.ready ?? t) : null;
      }
      if ('posted' in body) {
        if (!me.openedAt) throw new HttpError(409, 'not opened');
        if ((recipient.handover ?? doc.handover) !== 'post') throw new HttpError(409, 'not by post');
        recipient.posted = body.posted ? (recipient.posted ?? t) : null;
        if (!body.posted) recipient.arrived = null;
      }
      if ('arrived' in body) me.arrived = body.arrived ? (me.arrived ?? t) : null;
      commit(r);
      return json(res, 200, { ok: true });
    }
    throw new HttpError(404, 'not here');
  }

  // ---- timers: the practice colleagues, and the sweep ----

  function practiceTick() {
    const t = now();
    for (const id of store.practiceGroups()) {
      const r = room(id);
      if (!r) continue;
      if (r.row.deleteAt > t && step(r.row.doc, t, r.row.doc.draw?.until ?? 0, pace)) commit(r);
      release(r);
    }
  }

  /** Deletes every group whose time is up, then gives the space back. */
  function sweep() {
    const due = store.due(now());
    for (const id of due) {
      const r = rooms.get(id);
      if (r) {
        for (const s of r.streams) end(s);
        rooms.delete(id);
      }
      store.remove(id);
      tries.delete(id);
    }
    if (due.length) store.vacuum();
    return due.length;
  }

  const intervals = [];
  if (timers) {
    sweep();
    intervals.push(setInterval(sweep, SWEEP), setInterval(practiceTick, Math.max(100, PRACTICE_TICK / pace)));
    for (const i of intervals) i.unref?.();
  }

  return {
    /** Answers an /api/ request; false if the path isn't one. */
    async handle(req, res, url) {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] !== 'api') return false;
      res.setHeader('x-robots-tag', 'noindex');
      let found = null;
      try {
        const method = req.method;
        if (parts.length === 2 && parts[1] === 'groups') {
          if (method !== 'POST') throw new HttpError(405, 'not here');
          await create(req, res);
          return true;
        }
        if (parts.length === 3 && parts[1] === 'live' && method === 'GET') {
          found = resolve(parts[2]);
          if (!found) throw new HttpError(404, 'gone');
          found.room.busy++;
          live(req, res, found);
          return true;
        }
        const [, letter, key, action = ''] = parts;
        if (!['g', 'h', 'p'].includes(letter) || parts.length > 4) throw new HttpError(404, 'not found');
        found = resolve(key ?? '');
        if (!found || found.kind !== letter) {
          if (found) release(found.room);
          found = null;
          throw new HttpError(404, 'gone');
        }
        found.room.busy++;
        const r = found.room;
        if (!action && method === 'GET') {
          const doc = r.row.doc;
          const stage = stageOf(doc);
          if (letter === 'h') return hostLoad(req, res, found), true;
          const view = letter === 'g' ? groupView(doc, r.row, stage) : personView(doc, r.row, found.person, groupKeyOf(r.id), stage);
          json(res, 200, { ...view, now: now(), v: r.row.version });
          return true;
        }
        if (!action || method !== 'POST') throw new HttpError(405, 'not here');
        if (letter === 'g') await groupAction(req, res, found, action);
        else if (letter === 'h') await hostAction(req, res, found, action);
        else await personAction(req, res, found, action);
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        if (!res.headersSent) json(res, error.status, { error: error.message, ...error.extra });
      } finally {
        if (found) {
          found.room.busy--;
          release(found.room);
        }
      }
      return true;
    },
    /** A link's group name for its page (title and link preview), or null. */
    page(letter, key) {
      const found = resolve(key);
      if (!found) return null;
      const ok = found.kind === letter;
      const result = ok ? { name: found.room.row.doc.name, practice: found.room.row.practice } : null;
      release(found.room);
      return result;
    },
    sweep,
    practiceTick,
    /** Ends every stream and timer, for a clean shutdown. */
    close() {
      for (const i of intervals) clearInterval(i);
      for (const r of rooms.values()) for (const s of r.streams) s.res.end();
    },
  };
}
