import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openStore } from '../server/store.mjs';
import { createApi, STAGE_PER, STAGE_TAIL } from '../server/api.mjs';
import { valid } from '../shared/draw.mjs';
import { PRACTICE_CODE } from '../server/practice.mjs';

let server, base, api, store, clock;
const DAY = 86_400_000;

/** A date `days` from the clock's today, as the form sends it. */
const inDays = (days) => new Date(clock + days * DAY).toISOString().slice(0, 10);

before(async () => {
  clock = Date.UTC(2026, 10, 20, 10);
  store = openStore(':memory:');
  api = createApi({ store, now: () => clock, timers: false });
  server = http.createServer(async (req, res) => {
    if (!(await api.handle(req, res, new URL(req.url, 'http://x')))) res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  api.close();
  server.closeAllConnections();
  server.close();
});

const post = (path, body, headers = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) });
const get = async (path, headers = {}) => (await fetch(base + path, { headers })).json();

let ip = 0;
/** A group with a host (Anna) and these names; each test comes from its own address. */
async function make(extra = {}) {
  const res = await post(
    '/api/groups',
    {
      name: 'Weihnachtsfeier',
      party: inDays(28),
      time: '18:30',
      place: 'Büro',
      budget: 2500,
      host: { name: 'Anna' },
      names: ['Ben', 'Carla', 'David', 'Elif'],
      code: 'tannenbaum',
      lang: 'de',
      ...extra,
    },
    { 'cf-connecting-ip': `10.0.0.${++ip}` },
  );
  assert.equal(res.status, 201, await res.clone().text());
  return res.json();
}

/** Claims a name from the group link: the person's own key. */
async function claim(group, name) {
  const view = await get(`/api/g/${group}`);
  const id = view.people.find((p) => p.name === name).id;
  const res = await post(`/api/g/${group}/claim`, { id });
  assert.equal(res.status, 200);
  return (await res.json()).me;
}

async function everyone(group, names = ['Ben', 'Carla', 'David', 'Elif']) {
  const keys = {};
  for (const n of names) keys[n] = await claim(group, n);
  return keys;
}

test('a new group: three keys, the host joined, the others listed', async () => {
  const { group, host, me } = await make();
  for (const k of [group, host, me]) assert.match(k, /^[A-Za-z0-9_-]{22}$/);
  const g = await get(`/api/g/${group}`);
  assert.equal(g.kind, 'g');
  assert.equal(g.group.name, 'Weihnachtsfeier');
  assert.deepEqual(
    g.people.map((p) => [p.name, p.joined]),
    [['Anna', true], ['Ben', false], ['Carla', false], ['David', false], ['Elif', false]],
  );
  // The group's deletion: 30 days after the party, about 03:00 in Berlin.
  assert.equal(new Date(g.group.deleteAt).toISOString(), `${inDays(58)}T02:00:00.000Z`);
  const h = await get(`/api/h/${host}`);
  assert.equal(h.kind, 'h');
  assert.equal(h.groupKey, group);
  assert.deepEqual(h.check, { ok: true });
  assert.equal(h.unsealed, null);
  assert.equal(h.log[0].t, 'created');
  const p = await get(`/api/p/${me}`);
  assert.equal(p.me.name, 'Anna');
  assert.equal(p.me.host, true);
  // A key on the wrong path opens nothing.
  assert.equal((await fetch(`${base}/api/g/${host}`)).status, 404);
  assert.equal((await fetch(`${base}/api/h/${group}`)).status, 404);
  assert.equal((await fetch(`${base}/api/p/AAAAAAAAAAAAAAAAAAAAAA`)).status, 404);
});

test('starting a group checks its details', async () => {
  const bad = async (extra, status = 400) => {
    const res = await post('/api/groups', { name: 'X', party: inDays(10), host: { name: 'Anna' }, code: 'secret1', ...extra }, { 'cf-connecting-ip': '10.1.0.1' });
    assert.equal(res.status, status, JSON.stringify(extra));
  };
  await bad({ party: inDays(-1) });
  await bad({ party: inDays(500) });
  await bad({ party: '2026-02-30' });
  await bad({ code: 'short' });
  await bad({ name: '' });
  await bad({ host: { name: '' } });
  await bad({ budget: -5 });
  await bad({ time: '25:00' });
  await bad({ names: Array.from({ length: 101 }, (_, i) => `P${i}`) }, 413);
});

test('twenty new groups per address an hour', async () => {
  const body = { name: 'X', party: inDays(10), host: { name: 'Anna' }, code: 'secret1' };
  const from = { 'cf-connecting-ip': '10.2.0.1' };
  for (let i = 0; i < 20; i++) assert.equal((await post('/api/groups', body, from)).status, 201);
  assert.equal((await post('/api/groups', body, from)).status, 429);
  assert.equal((await post('/api/groups', body, { 'cf-connecting-ip': '10.2.0.2' })).status, 201);
});

test('claiming a name is one tap: a second claim is refused, a reset frees it', async () => {
  const { group, host } = await make();
  const ben = await claim(group, 'Ben');
  const id = (await get(`/api/p/${ben}`)).me.id;
  assert.equal((await post(`/api/g/${group}/claim`, { id })).status, 409);
  assert.equal((await post(`/api/h/${host}/reset`, { id })).status, 200);
  assert.equal((await fetch(`${base}/api/p/${ben}`)).status, 404);
  const again = await claim(group, 'Ben');
  assert.notEqual(again, ben);
  const h = await get(`/api/h/${host}`);
  assert.ok(h.log.some((l) => l.t === 'reset' && l.n === 'Ben'));
});

test('adding yourself works until the draw, and only if the host allows it', async () => {
  const { group, host } = await make();
  const res = await post(`/api/g/${group}/join`, { name: 'Finn' });
  assert.equal(res.status, 200);
  assert.equal((await post(`/api/g/${group}/join`, { name: 'finn' })).status, 409);
  await post(`/api/h/${host}/settings`, { selfAdd: false });
  assert.equal((await post(`/api/g/${group}/join`, { name: 'Greta' })).status, 409);
  await post(`/api/h/${host}/settings`, { selfAdd: true });
  await everyone(group);
  assert.equal((await post(`/api/h/${host}/draw`)).status, 200);
  assert.equal((await post(`/api/g/${group}/join`, { name: 'Greta' })).status, 409);
});

test('wishes, an address and the handover are the person’s own', async () => {
  const { group } = await make({ handover: 'party' });
  const carla = await claim(group, 'Carla');
  const res = await post(`/api/p/${carla}/me`, {
    handover: 'post',
    address: 'Carla Berg\n  Lindenstraße 4 \n\n\n\n12345 Musterstadt',
    wishes: [{ t: 'Tee', l: 'https://example.org/tee' }, { t: '  ' }, { t: 'Socken', l: '' }],
    not: 'Keine Tassen',
  });
  assert.equal(res.status, 200);
  const p = await get(`/api/p/${carla}`);
  assert.equal(p.me.handover, 'post');
  assert.equal(p.me.address, 'Carla Berg\nLindenstraße 4\n\n12345 Musterstadt');
  assert.deepEqual(p.me.wishes, [{ t: 'Tee', l: 'https://example.org/tee' }, { t: 'Socken', l: '' }]);
  assert.equal((await post(`/api/p/${carla}/me`, { wishes: [{ t: 'x', l: 'javascript:alert(1)' }] })).status, 400);
  assert.equal((await post(`/api/p/${carla}/me`, { wishes: Array(9).fill({ t: 'x' }) })).status, 400);
  // Nobody else sees any of it: the group link shows names and who has joined.
  const g = await get(`/api/g/${group}`);
  assert.ok(!JSON.stringify(g).includes('Lindenstraße'));
  assert.ok(!JSON.stringify(g).includes('Tee'));
});

test('a quiet draw: nobody sees a pair until they reveal theirs, the host never does', async () => {
  const { group, host, me } = await make();
  const keys = { Anna: me, ...(await everyone(group)) };
  await post(`/api/p/${keys.Carla}/me`, { handover: 'post', address: 'Carla Berg\nLindenstraße 4', wishes: [{ t: 'Tee' }] });
  const drawn = await post(`/api/h/${host}/draw`);
  assert.equal(drawn.status, 200);
  assert.deepEqual(await drawn.json(), { stage: null });
  assert.equal((await post(`/api/h/${host}/draw`)).status, 409);

  const h = await get(`/api/h/${host}`);
  assert.equal(h.draw.shape, 'chain');
  assert.ok(!JSON.stringify(h).includes('Lindenstraße'));
  assert.equal(h.unsealed, null);
  assert.ok(!('pairs' in h.draw));

  const seen = {};
  for (const [name, key] of Object.entries(keys)) {
    const view = await get(`/api/p/${key}`);
    assert.equal(view.me.inDraw, true);
    assert.equal(view.me.opened, false);
    assert.ok(!('recipient' in view));
    const res = await post(`/api/p/${key}/reveal`);
    assert.equal(res.status, 200);
    const { recipient } = await res.json();
    assert.notEqual(recipient.name, name);
    seen[name] = recipient.name;
    // Only whoever drew Carla sees her address.
    if (recipient.name === 'Carla') assert.equal(recipient.address, 'Carla Berg\nLindenstraße 4');
    else assert.equal(recipient.address, '');
  }
  // A closed chain: following the draws visits all five.
  let at = 'Anna';
  const visited = new Set();
  for (let i = 0; i < 5; i++) visited.add((at = seen[at]));
  assert.equal(visited.size, 5);
  assert.equal(at, 'Anna');
  const after = await get(`/api/h/${host}`);
  assert.ok(after.people.every((p) => p.opened));
});

test('a live draw: the doors stay shut while the arch lights, then open', async () => {
  const { group, host, me } = await make({ moment: 'live' });
  await everyone(group);
  const { stage } = await (await post(`/api/h/${host}/draw`)).json();
  assert.equal(stage.n, 5);
  assert.equal(stage.until, clock + 5 * STAGE_PER + STAGE_TAIL);
  assert.deepEqual((await get(`/api/p/${me}`)).stage, stage);
  const early = await post(`/api/p/${me}/reveal`);
  assert.equal(early.status, 425);
  clock += 5 * STAGE_PER + STAGE_TAIL + 1;
  assert.equal((await get(`/api/p/${me}`)).stage, null);
  assert.equal((await post(`/api/p/${me}/reveal`)).status, 200);
});

test('the any shape and households: nobody draws their own household', async () => {
  for (let round = 0; round < 8; round++) {
    const { group, host, me } = await make({ shape: 'any' });
    const keys = { Anna: me, ...(await everyone(group)) };
    const h = await get(`/api/h/${host}`);
    const id = (n) => h.people.find((p) => p.name === n).id;
    assert.equal((await post(`/api/h/${host}/households`, { households: [[id('Anna'), id('Ben')], [id('Carla'), id('David')]] })).status, 200);
    assert.equal((await post(`/api/h/${host}/households`, { households: [[id('Anna'), id('Ben'), id('Carla')]] })).status, 200);
    const blocked = await get(`/api/h/${host}`);
    assert.equal(blocked.check.ok, false);
    assert.equal((await post(`/api/h/${host}/draw`)).status, 409);
    await post(`/api/h/${host}/households`, { households: [[id('Anna'), id('Ben')], [id('Carla'), id('David')]] });
    assert.equal((await post(`/api/h/${host}/draw`)).status, 200);
    const got = {};
    for (const [n, k] of Object.entries(keys)) got[n] = (await (await post(`/api/p/${k}/reveal`)).json()).recipient.name;
    assert.notEqual(got.Anna, 'Ben');
    assert.notEqual(got.Ben, 'Anna');
    assert.notEqual(got.Carla, 'David');
    assert.notEqual(got.David, 'Carla');
  }
});

test('the gift steps: ready after opening, a parcel posted and arrived per recipient', async () => {
  const { group, host, me } = await make({ handover: 'post' });
  const keys = { Anna: me, ...(await everyone(group)) };
  for (const k of Object.values(keys)) await post(`/api/p/${k}/me`, { address: 'Somewhere 1' });
  await post(`/api/h/${host}/draw`);
  assert.equal((await post(`/api/p/${me}/steps`, { ready: true })).status, 409);
  const { recipient } = await (await post(`/api/p/${me}/reveal`)).json();
  assert.equal((await post(`/api/p/${me}/steps`, { ready: true })).status, 200);
  assert.equal((await post(`/api/p/${me}/steps`, { posted: true })).status, 200);
  const theirs = keys[recipient.name];
  assert.equal((await get(`/api/p/${theirs}`)).me.incoming, true);
  await post(`/api/p/${theirs}/steps`, { arrived: true });
  const h = await get(`/api/h/${host}`);
  const anna = h.people.find((p) => p.name === 'Anna');
  assert.equal(anna.ready, true);
  // The parcel shows on the recipient's row, never the giver's.
  assert.equal(h.people.find((p) => p.name === recipient.name).parcel, 'arrived');
  assert.equal(anna.parcel, null);
});

test('unseal: five wrong codes lock it for 15 minutes; a right one opens pairs and addresses for half an hour', async () => {
  const { group, host } = await make();
  await everyone(group);
  await post(`/api/h/${host}/draw`);
  for (let i = 1; i <= 5; i++) {
    const res = await post(`/api/h/${host}/unseal`, { code: 'falsch' });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).left, 5 - i);
  }
  assert.equal((await post(`/api/h/${host}/unseal`, { code: 'tannenbaum' })).status, 429);
  // The lock counts for the group link's recovery too.
  assert.equal((await post(`/api/g/${group}/recover`, { code: 'tannenbaum' })).status, 429);
  clock += 15 * 60_000 + 1;
  const res = await post(`/api/h/${host}/unseal`, { code: ' tannenbaum ' });
  assert.equal(res.status, 200);
  const { token, until } = await res.json();
  assert.equal(until, clock + 30 * 60_000);
  const open = await get(`/api/h/${host}`, { 'x-unseal': token });
  assert.equal(open.unsealed.pairs.length, 5);
  assert.equal(open.unsealed.people.length, 5);
  assert.equal(open.log.filter((l) => l.t === 'unseal').length, 1);
  assert.ok(open.log.some((l) => l.t === 'locked'));
  // Another group's host can't use the token.
  const other = await make();
  assert.equal((await get(`/api/h/${other.host}`, { 'x-unseal': token })).unsealed, null);
  clock += 30 * 60_000;
  assert.equal((await get(`/api/h/${host}`, { 'x-unseal': token })).unsealed, null);
});

test('recovering the host link with the code: the old link stops working', async () => {
  const { group, host } = await make();
  assert.equal((await post(`/api/g/${group}/recover`, { code: 'nope-nope' })).status, 403);
  const res = await post(`/api/g/${group}/recover`, { code: 'tannenbaum' });
  assert.equal(res.status, 200);
  const { host: fresh } = await res.json();
  assert.notEqual(fresh, host);
  assert.equal((await fetch(`${base}/api/h/${host}`)).status, 404);
  assert.ok((await get(`/api/h/${fresh}`)).log.some((l) => l.t === 'recover'));
  // Handing over: another new link.
  const { host: third } = await (await post(`/api/h/${fresh}/rekey`)).json();
  assert.equal((await fetch(`${base}/api/h/${fresh}`)).status, 404);
  assert.equal((await fetch(`${base}/api/h/${third}`)).status, 200);
});

test('changing the code needs the old one', async () => {
  const { host } = await make();
  assert.equal((await post(`/api/h/${host}/code`, { old: 'wrong-one', next: 'lebkuchen' })).status, 403);
  assert.equal((await post(`/api/h/${host}/code`, { old: 'tannenbaum', next: 'kurz' })).status, 400);
  assert.equal((await post(`/api/h/${host}/code`, { old: 'tannenbaum', next: 'lebkuchen' })).status, 200);
  assert.equal((await post(`/api/h/${host}/unseal`, { code: 'tannenbaum' })).status, 403);
  assert.equal((await post(`/api/h/${host}/unseal`, { code: 'lebkuchen' })).status, 200);
});

test('a drop-out after the draw, patched: one draw changes, the rest keep theirs', async () => {
  const { group, host, me } = await make({ names: ['Ben', 'Carla', 'David', 'Elif', 'Finn', 'Greta'] });
  const keys = { Anna: me, ...(await everyone(group, ['Ben', 'Carla', 'David', 'Elif', 'Finn', 'Greta'])) };
  await post(`/api/h/${host}/draw`);
  const before = {};
  for (const [n, k] of Object.entries(keys)) before[n] = (await (await post(`/api/p/${k}/reveal`)).json()).recipient.name;
  const h = await get(`/api/h/${host}`);
  const david = h.people.find((p) => p.name === 'David').id;
  assert.equal((await post(`/api/h/${host}/remove`, { id: david })).status, 409);
  const res = await post(`/api/h/${host}/remove`, { id: david, mode: 'patch' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).changes, 1);
  assert.equal((await fetch(`${base}/api/p/${keys.David}`)).status, 404);
  for (const [n, k] of Object.entries(keys)) {
    if (n === 'David') continue;
    const view = await get(`/api/p/${k}`);
    const giverOfDavid = before[n] === 'David';
    assert.equal(view.me.changed, giverOfDavid, n);
    assert.equal(view.me.opened, !giverOfDavid, n);
    const now = (await (await post(`/api/p/${k}/reveal`)).json()).recipient.name;
    assert.equal(now, giverOfDavid ? before.David : before[n], n);
  }
  const after = await get(`/api/h/${host}`);
  assert.ok(after.log.some((l) => l.t === 'patched' && l.c === 1));
});

test('a late joiner after the draw, patched, or everyone redrawn', async () => {
  const { group, host, me } = await make();
  const keys = { Anna: me, ...(await everyone(group)) };
  await post(`/api/h/${host}/draw`);
  for (const k of Object.values(keys)) await post(`/api/p/${k}/reveal`);
  assert.equal((await post(`/api/h/${host}/add`, { names: ['Finn'] })).status, 409);
  const res = await post(`/api/h/${host}/add`, { names: ['Finn'], mode: 'patch' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).changes, 1);
  const finn = await claim(group, 'Finn');
  const { recipient } = await (await post(`/api/p/${finn}/reveal`)).json();
  assert.ok(['Anna', 'Ben', 'Carla', 'David', 'Elif'].includes(recipient.name));
  let changed = 0;
  for (const k of Object.values(keys)) if ((await get(`/api/p/${k}`)).me.changed) changed++;
  assert.equal(changed, 1);
  // A redraw: every page that had opened says its draw changed.
  assert.equal((await post(`/api/h/${host}/redraw`)).status, 200);
  for (const k of [...Object.values(keys), finn]) {
    const view = await get(`/api/p/${k}`);
    assert.equal(view.me.changed, true);
    assert.equal(view.me.opened, false);
  }
  assert.equal((await get(`/api/h/${host}`)).draw.round, 2);
});

test('households changed after the draw: kept if the draw still holds, else a redraw', async () => {
  for (let i = 0; i < 6; i++) {
    const { group, host, me } = await make();
    const keys = { Anna: me, ...(await everyone(group)) };
    await post(`/api/h/${host}/draw`);
    const anna = (await (await post(`/api/p/${me}/reveal`)).json()).recipient.name;
    const h = await get(`/api/h/${host}`);
    const id = (n) => h.people.find((p) => p.name === n).id;
    // Anna moves in with whoever she drew: her draw breaks the rule now.
    const res = await post(`/api/h/${host}/households`, { households: [[id('Anna'), id(anna)]] });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, 'redraw');
    assert.equal((await post(`/api/h/${host}/households`, { households: [[id('Anna'), id(anna)]], redraw: true })).status, 200);
    const again = (await (await post(`/api/p/${me}/reveal`)).json()).recipient.name;
    assert.notEqual(again, anna);
    void keys;
  }
});

test('the sweep deletes a group 30 days after its party, and every key with it', async () => {
  const { group, host, me } = await make({ party: inDays(1) });
  const g = await get(`/api/g/${group}`);
  clock = g.group.deleteAt - 1;
  assert.equal((await fetch(`${base}/api/g/${group}`)).status, 200);
  clock = g.group.deleteAt;
  // Past its time it's gone at once, swept or not.
  assert.equal((await fetch(`${base}/api/g/${group}`)).status, 404);
  const before = store.count();
  assert.ok(api.sweep() >= 1);
  assert.ok(store.count() < before);
  for (const k of [group, host, me]) assert.equal(store.key(k), null);
  clock = Date.UTC(2026, 10, 20, 10);
});

test('the host deletes a group: every link stops at once', async () => {
  const { group, host, me } = await make();
  const res = await post(`/api/h/${host}/delete`);
  assert.equal(res.status, 204);
  for (const path of [`/api/g/${group}`, `/api/h/${host}`, `/api/p/${me}`]) assert.equal((await fetch(base + path)).status, 404);
});

test('a practice run: made-up colleagues join, wish, open and tick on their own', async () => {
  const start = clock;
  const res = await post('/api/groups', { practice: true, host: { name: 'Mia' }, lang: 'en' }, { 'cf-connecting-ip': '10.3.0.1' });
  assert.equal(res.status, 201);
  const { host, me } = await res.json();
  let h = await get(`/api/h/${host}`);
  assert.equal(h.group.practice, true);
  assert.equal(h.people.length, 10);
  assert.ok(!h.people.some((p) => p.name === 'Mia' && p.dummy));
  assert.equal(h.households.length, 1);
  assert.ok(h.people.filter((p) => p.dummy).every((p) => p.key));
  assert.equal(h.group.deleteAt, start + DAY);
  // Two and a half minutes on: everyone but the late one has joined and written wishes.
  clock = start + 160_000;
  api.practiceTick();
  h = await get(`/api/h/${host}`);
  assert.equal(h.people.filter((p) => p.joined).length, 9);
  clock = start + 400_000;
  api.practiceTick();
  h = await get(`/api/h/${host}`);
  assert.equal(h.people.filter((p) => p.joined).length, 10);
  // Their wishes follow within 40 seconds of joining.
  clock += 41_000;
  api.practiceTick();
  h = await get(`/api/h/${host}`);
  assert.ok(h.people.filter((p) => p.dummy).every((p) => p.wishes));
  // The live draw, then a few minutes: most have opened and got their gift ready, two are slow.
  await post(`/api/h/${host}/draw`);
  clock += 10 * STAGE_PER + STAGE_TAIL + 300_000;
  api.practiceTick();
  clock += 200_000;
  api.practiceTick();
  h = await get(`/api/h/${host}`);
  const dummies = h.people.filter((p) => p.dummy);
  assert.equal(dummies.filter((p) => !p.opened).length, 2);
  assert.ok(dummies.filter((p) => p.ready).length >= 5);
  // A dummy's own page opens from the host's page.
  const ben = dummies.find((p) => p.name === 'Ben');
  assert.equal((await get(`/api/p/${ben.key}`)).me.name, 'Ben');
  // The practice code unseals it.
  const { token } = await (await post(`/api/h/${host}/unseal`, { code: PRACTICE_CODE })).json();
  const open = await get(`/api/h/${host}`, { 'x-unseal': token });
  const pairs = Object.fromEntries(open.unsealed.pairs.map((p) => [p.giver, p.recipient]));
  assert.ok(valid(pairs, h.people.map((p) => p.id), h.households, 'chain'));
  assert.ok(me);
  // Deleted after a day.
  clock = start + DAY;
  assert.equal((await fetch(`${base}/api/h/${host}`)).status, 404);
  clock = start;
});

test('the live stream says when something changed, and when a link stops working', async () => {
  const { group, host } = await make();
  const ben = await claim(group, 'Ben');
  const controller = new AbortController();
  const res = await fetch(`${base}/api/live/${ben}`, { signal: controller.signal });
  const reader = res.body.getReader();
  const events = [];
  let buffer = '';
  const until = async (n) => {
    while (events.length < n) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += new TextDecoder().decode(value);
      let at;
      while ((at = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1];
        if (event && event !== 'ping') events.push(event);
      }
    }
  };
  await until(1);
  await claim(group, 'Carla');
  await until(2);
  const id = (await get(`/api/p/${ben}`)).me.id;
  await post(`/api/h/${host}/reset`, { id });
  await until(3);
  assert.deepEqual(events, ['v', 'v', 'gone']);
  controller.abort();
});
