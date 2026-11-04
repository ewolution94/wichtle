// Wichtle end to end, in a real browser against the production server: a fresh build, its CSP, and a
// data folder of its own that goes away afterwards. Every main workflow, as the host and as the people
// on their own devices: starting a group, claiming names, wishes and addresses, households, both draw
// shapes, quiet and live draws, the reveal, the gift steps, the reminder, a drop-out and a late joiner,
// unsealing and the log, the host's recovery, deleting, the practice run, German, dark, 390 px.
//
//   node tests/e2e/run.mjs [--no-build] [--headed] [--port N] [--grep words] [--shots dir]
//
// Every test runs in fresh browser contexts and fails, on top of its own asserts, when a page logs an
// error or asks anything of another origin. `--shots` saves a screenshot of each page the layout
// test visits. The practice colleagues run 60 times faster here (WICHTLE_PRACTICE_PACE).
// Locally only: CI runs the unit tests and the server's smoke test.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : fallback;
};
const port = Number(option('--port', 7714));
const grep = option('--grep', '');
const shots = option('--shots', '');
const base = `http://localhost:${port}`;

if (!flag('--no-build')) {
  const { build } = await import('vite');
  await build({ root, logLevel: 'warn' });
}
const data = await mkdtemp(path.join(os.tmpdir(), 'wichtle-e2e-'));
const child = spawn(process.execPath, ['server/server.mjs', '--port', String(port)], {
  cwd: root,
  env: { ...process.env, WICHTLE_DATA: data, WICHTLE_PRACTICE_PACE: '60', WICHTLE_CENSUS: '', DASHBOARD_URL: '' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${base}/healthz`)).ok) break;
  } catch {}
  if (i > 100) throw new Error('The server did not start');
  await new Promise((r) => setTimeout(r, 100));
}

const DESK = { viewport: { width: 1280, height: 800 } };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const CODE = 'mistletoe';

const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
/** Each API-made group comes from an address of its own, so the hourly limit never trips. */
let addresses = 0;

const api = {
  async make(extra = {}) {
    const body = { name: 'E2E party', party: inDays(14), lang: 'en', host: { name: 'Anna', joins: true }, names: ['Ben', 'Carla', 'David'], code: CODE, ...extra };
    const res = await fetch(`${base}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.0.0.${++addresses}` },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 201, await res.clone().text());
    return res.json();
  },
  async get(p, headers = {}) {
    const res = await fetch(`${base}/api${p}`, { headers });
    assert.equal(res.status, 200, `GET ${p}: ${res.status}`);
    return res.json();
  },
  async post(p, body = {}) {
    const res = await fetch(`${base}/api${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  },
  async claim(group, name) {
    const view = await api.get(`/g/${group}`);
    const p = view.people.find((x) => x.name === name);
    const { status, body } = await api.post(`/g/${group}/claim`, { id: p.id });
    assert.equal(status, 200);
    return body.me;
  },
  async host(host, token) {
    return api.get(`/h/${host}`, token ? { 'x-unseal': token } : {});
  },
  /** The host's view with every pair, opened with the code. */
  async inside(host) {
    const { body } = await api.post(`/h/${host}/unseal`, { code: CODE });
    return (await api.host(host, body.token)).unsealed;
  },
  async act(host, action, body = {}) {
    const res = await api.post(`/h/${host}/${action}`, body);
    assert.ok(res.status < 300, `${action}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  },
};

/** Waits until `check` returns something truthy (or throws its last error). */
async function until(check, what, ms = 6000) {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    if (Date.now() > end) throw last ?? new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 80));
  }
}

const keyOf = (url) => /\/[ghp]\/([\w-]{22})/.exec(url)?.[1];
// Only what's on screen: a toast's words are in a hidden live region too, and closed sheets keep theirs.
const shown = (page, text, timeout = 6000) => page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ timeout });
const field = (page, label) => page.getByLabel(label, { exact: true });
/** Folio's switch has its role from ElementInternals, which getByRole doesn't see (learnings/browser-testing.md). */
const flip = (page, label) => page.locator('ewo-switch', { hasText: label }).click();

/** Waits until every sheet has closed: while a modal one is open, the page behind it is inert. */
const settled = (page) => until(async () => (await page.locator('dialog[open]').count()) === 0, 'the sheets to close');

/** The door is open: the page's heading names the person (the closed door holds the words too). */
const revealed = (page, timeout = 6000) => page.getByRole('heading', { name: /^You give to / }).waitFor({ timeout });

/** Pairs as names: { giver: recipient }. */
const pairsOf = (inside) => Object.fromEntries(inside.pairs.map((p) => [p.from, p.to]));

/** Opens Host tools and runs `run` while the sheet is open. */
async function tools(page, run) {
  await page.getByRole('button', { name: 'Host tools' }).click();
  await run();
}

const tests = {
  async 'starting a group: the form, claims from the group link, live joins, a wrong claim reset, adding yourself'(t) {
    const host = await t.page(DESK);
    await host.goto(`${base}/new`);
    await field(host, 'Name of the group').fill('Office party');
    await field(host, 'Date').fill(inDays(20));
    await field(host, 'Where').fill('The kitchen');
    await field(host, 'Budget').fill('20');
    await field(host, 'Your name').fill('Anna');
    await field(host, 'Everyone else').fill('Ben, Carla\nDavid');
    await shown(host, '4 people so far');
    await field(host, 'Code').fill(CODE);
    await host.getByRole('button', { name: 'Start the group' }).click();
    await host.waitForURL(/\/h\//);
    const hostKey = keyOf(host.url());
    await shown(host, '1 of 4 have joined');
    const view = await api.host(hostKey);
    assert.equal(view.group.budget, 2000);
    assert.equal(view.group.place, 'The kitchen');
    const groupLink = await host.locator('.linkrow code').first().textContent();
    const group = keyOf(groupLink);
    assert.ok(group && group !== hostKey);

    // Ben claims on his phone; the host's village lights his window without a reload.
    const ben = await t.page(PHONE);
    await ben.goto(`${base}/g/${group}`);
    await ben.getByRole('button', { name: /^Ben/ }).click();
    await ben.getByRole('button', { name: "Yes, I'm Ben" }).click();
    await ben.waitForURL(/\/p\//);
    await shown(ben, 'Hi Ben');
    await shown(host, '2 of 4 have joined');

    // Someone else can't take Ben any more.
    const other = await t.page(PHONE);
    await other.goto(`${base}/g/${group}`);
    assert.equal(await other.getByRole('button', { name: /^Ben/ }).isDisabled(), true);

    // A wrong claim: the host frees Ben again, and Ben's link stops working.
    await host.getByRole('row', { name: /Ben/ }).getByRole('button', { name: 'Edit' }).click();
    await host.getByRole('button', { name: 'Reset their claim' }).click();
    await host.getByRole('button', { name: 'Reset the claim' }).click();
    await shown(host, 'Ben can be claimed again');
    await shown(ben, "This link doesn't work any more");
    await other.reload();
    await until(async () => !(await other.getByRole('button', { name: /^Ben/ }).isDisabled()), 'Ben free again');

    // Someone missing adds themselves.
    await other.getByRole('button', { name: "My name isn't there" }).click();
    await field(other, 'Your name').fill('Elif');
    await other.getByRole('button', { name: 'Join', exact: true }).click();
    await other.waitForURL(/\/p\//);
    await shown(other, 'Hi Elif');
    await shown(host, '2 of 5 have joined');
    const log = (await api.host(hostKey)).log.map((l) => l.t);
    assert.ok(log.includes('reset') && log.includes('join'), log.join());
  },

  async 'wishes, a link, rather-not and an address reach only the giver; the gift steps reach the host'(t) {
    const made = await api.make();
    const keys = { Anna: made.me };
    for (const name of ['Ben', 'Carla', 'David']) keys[name] = await api.claim(made.group, name);
    const carla = keys.Carla;

    const page = await t.page(DESK);
    await page.goto(`${base}/p/${carla}`);
    await shown(page, 'Hi Carla');
    await field(page, 'A wish').fill('A good book');
    await field(page, 'A wish').press('Enter');
    await field(page, 'A wish').fill('https://example.org/scarf');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await field(page, 'Rather not').fill('No mugs');
    await field(page, 'Rather not').press('Tab');
    await page.getByRole('radio', { name: 'By post' }).click();
    await field(page, 'My address').fill('Carla Example\nMain Street 1\n12345 Town');
    await field(page, 'My address').press('Tab');
    await until(async () => {
      const me = (await api.get(`/p/${carla}`)).me;
      return me.wishes.length === 2 && me.not === 'No mugs' && me.handover === 'post' && me.address.includes('Main Street');
    }, 'Carla saved');
    // The link is kept as she pasted it, shown by its host, never fetched.
    await shown(page, 'example.org');

    // The host sees that Carla has wishes and wants post, never what they are.
    const before = await api.host(made.host);
    assert.ok(!JSON.stringify(before).includes('A good book') && !JSON.stringify(before).includes('Main Street'));

    await api.act(made.host, 'draw');
    const pairs = pairsOf(await api.inside(made.host));
    const giverKey = keys[Object.keys(pairs).find((g) => pairs[g] === 'Carla')];

    const giver = await t.page(PHONE);
    await giver.goto(`${base}/p/${giverKey}`);
    await giver.getByRole('button', { name: /^Door \d+: open it/ }).click();
    await giver.getByRole('heading', { name: 'You give to Carla' }).waitFor();
    await shown(giver, 'A good book');
    await shown(giver, 'No mugs');
    await shown(giver, 'Main Street 1');

    // Carla changes a wish; her giver sees that it changed.
    await field(page, 'A wish').fill('Warm socks');
    await field(page, 'A wish').press('Enter');
    await until(async () => (await api.get(`/p/${carla}`)).me.wishes.length === 3, 'the third wish');
    // Opened before: the door opens again by itself on a reload.
    await giver.reload();
    await shown(giver, 'Carla changed their wishes since you last looked.');

    // Ready and posted from the giver; the parcel reaches Carla's page and the host's table.
    await flip(giver, 'My gift is ready');
    await flip(giver, 'Posted');
    await shown(page, 'Someone has posted your gift.');
    const host = await t.page(DESK);
    await host.goto(`${base}/h/${made.host}`);
    await shown(host.getByRole('row', { name: /Carla/ }), 'on its way');
    await flip(page, 'My parcel arrived');
    await shown(host.getByRole('row', { name: /Carla/ }), 'arrived');
    const view = await api.host(made.host);
    assert.equal(view.people.filter((p) => p.ready).length, 1);
  },

  async 'households: tied on the street, kept apart by the draw, and one of more than half blocks it'(t) {
    const made = await api.make({ names: ['Ben', 'Carla', 'David', 'Elif', 'Finn'] });
    const host = await t.page(DESK);
    await host.goto(`${base}/h/${made.host}`);
    await shown(host, '1 of 6 have joined');
    await host.getByRole('button', { name: 'Ben', exact: true }).click();
    await host.getByRole('button', { name: 'Carla', exact: true }).click();
    await host.getByRole('button', { name: 'Tie into a household' }).click();
    await shown(host, 'Households saved');
    await host.getByRole('button', { name: 'Ben & Carla', exact: true }).waitFor();

    // Four of six together: no draw can work, and the page says why.
    await host.getByRole('button', { name: 'Ben & Carla', exact: true }).click();
    await host.getByRole('button', { name: 'David', exact: true }).click();
    await host.getByRole('button', { name: 'Elif', exact: true }).click();
    await host.getByRole('button', { name: 'Tie into a household' }).click();
    await shown(host, 'are more than half of the group');
    assert.equal(await host.getByRole('button', { name: 'Draw', exact: true }).isDisabled(), true);
    await host.getByRole('button', { name: /Ben & Carla & David & Elif/ }).click();
    await host.getByRole('button', { name: 'Untie' }).click();
    await until(async () => (await api.host(made.host)).households.length === 0, 'untied');
    await host.getByRole('button', { name: 'Ben', exact: true }).click();
    await host.getByRole('button', { name: 'Carla', exact: true }).click();
    await host.getByRole('button', { name: 'Tie into a household' }).click();
    await host.getByRole('button', { name: 'Ben & Carla', exact: true }).waitFor();

    // Anyone, drawn quietly from the page.
    await host.getByRole('radio', { name: 'Anyone' }).click();
    await until(async () => (await api.host(made.host)).group.shape === 'any', 'the any shape');
    await host.getByRole('button', { name: 'Draw', exact: true }).click();
    await host.getByRole('button', { name: 'Draw now' }).click();
    await shown(host, 'Drawn. Everyone can open their door now.');
    await shown(host, 'The draw is sealed');
    for (let round = 0; round < 12; round++) {
      const pairs = pairsOf(await api.inside(made.host));
      assert.notEqual(pairs.Ben, 'Carla');
      assert.notEqual(pairs.Carla, 'Ben');
      assert.equal(new Set(Object.values(pairs)).size, 6);
      for (const [g, r] of Object.entries(pairs)) assert.notEqual(g, r);
      await api.act(made.host, 'redraw');
    }
  },

  async 'one circle: everyone in a single ring, nobody giving back to their giver'(t) {
    const made = await api.make({ names: ['Ben', 'Carla', 'David', 'Elif', 'Finn', 'Greta'], shape: 'chain' });
    const host = await t.page(DESK);
    await host.goto(`${base}/h/${made.host}`);
    await host.getByRole('button', { name: 'Draw', exact: true }).click();
    await host.getByRole('button', { name: 'Draw now' }).click();
    await shown(host, 'Drawn. Everyone can open their door now.');
    for (let round = 0; round < 12; round++) {
      const pairs = pairsOf(await api.inside(made.host));
      let at = 'Anna';
      const seen = new Set();
      do {
        seen.add(at);
        assert.notEqual(pairs[pairs[at]], at, `${at} and ${pairs[at]} give to each other`);
        at = pairs[at];
      } while (at !== 'Anna');
      assert.equal(seen.size, 7, 'one ring through all seven');
      await api.act(made.host, 'redraw');
    }
  },

  async 'a live draw: the host’s arch lights a candle each, then every open page opens its door at once'(t) {
    const made = await api.make({ moment: 'live' });
    const ben = await api.claim(made.group, 'Ben');
    const carla = await api.claim(made.group, 'Carla');
    const host = await t.page(DESK);
    await host.goto(`${base}/h/${made.host}`);
    const phones = [];
    for (const key of [ben, carla]) {
      const p = await t.page(PHONE);
      await p.goto(`${base}/p/${key}`);
      await shown(p, 'draws once everyone is in');
      phones.push(p);
    }
    await host.getByRole('button', { name: 'Draw', exact: true }).click();
    await host.getByRole('button', { name: 'Draw live now' }).click();
    const stage = host.getByRole('dialog', { name: 'The draw' });
    await shown(stage, 'Drawing for 4 people');
    // While the arch lights, every door stays shut.
    for (const p of phones) await shown(p, 'The candles light up one by one');
    assert.equal((await api.post(`/p/${ben}/reveal`)).status, 425);
    const { until: at } = (await api.host(made.host)).stage;
    // Then all at once: each page shows its person within a moment of the stage's end.
    const opened = await Promise.all(phones.map(async (p) => {
      await revealed(p, 9000);
      return Date.now();
    }));
    for (const when of opened) assert.ok(when >= at - 300, 'not before the stage ends');
    assert.ok(Math.max(...opened) - Math.min(...opened) < 1500, 'at the same moment');
    await shown(stage, 'Drawn!');
    await host.getByRole('button', { name: 'Back to the group' }).click();
    await shown(host, '2 of 4 have opened their door');
    assert.ok((await api.host(made.host)).log.some((l) => l.t === 'drawn' && l.live));
  },

  async 'after the draw: a drop-out fitted in, a late joiner fitted in, another drawn again'(t) {
    const made = await api.make({ names: ['Ben', 'Carla', 'David', 'Elif'] });
    await api.act(made.host, 'draw');
    const first = pairsOf(await api.inside(made.host));
    const host = await t.page(DESK);
    await host.goto(`${base}/h/${made.host}`);

    await host.getByRole('row', { name: /David/ }).getByRole('button', { name: 'Edit' }).click();
    await host.getByRole('button', { name: 'Remove from the group' }).click();
    await host.getByRole('button', { name: 'Remove and fit the draw' }).click();
    await shown(host, 'David removed');
    await settled(host);
    const second = pairsOf(await api.inside(made.host));
    assert.equal(Object.keys(second).length, 4);
    const davidsGiver = Object.keys(first).find((g) => first[g] === 'David');
    assert.equal(second[davidsGiver], first.David, 'David’s giver takes over David’s person');
    assert.equal(Object.keys(second).filter((g) => second[g] !== first[g]).length, 1, 'one draw changed');

    await field(host, 'Add names').fill('Zoe');
    await host.getByRole('button', { name: 'Fit them in' }).click();
    await shown(host, 'Fitted in:');
    const third = pairsOf(await api.inside(made.host));
    assert.equal(Object.keys(third).length, 5);
    assert.equal(Object.keys(third).filter((g) => g !== 'Zoe' && third[g] !== second[g]).length, 1);

    await field(host, 'Add names').fill('Yuri');
    await host.getByRole('button', { name: 'Add and draw again' }).click();
    await shown(host, 'Added, and drawn again for everyone');
    await shown(host, 'round 2');
    assert.equal(Object.keys(pairsOf(await api.inside(made.host))).length, 6);
    const log = (await api.host(made.host)).log.map((l) => l.t);
    assert.ok(log.includes('patched') && log.includes('redrawn') && log.includes('removed'));
  },

  async 'unsealing: a wrong code counts down, the right one shows every pair until sealed, the log keeps it, five wrong lock it'(t) {
    const made = await api.make();
    await api.act(made.host, 'draw');
    const host = await t.page(DESK);
    await host.goto(`${base}/h/${made.host}`);
    await shown(host, 'The draw is sealed');
    assert.equal(await host.getByRole('columnheader', { name: 'Gives to' }).count(), 0);
    await tools(host, async () => {
      await field(host, 'Unseal code').fill('wrong-one');
      await host.getByRole('button', { name: 'Unseal', exact: true }).click();
      await shown(host, "That's not the code. 4 more tries.");
      await field(host, 'Unseal code').fill(CODE);
      await host.getByRole('button', { name: 'Unseal', exact: true }).click();
    });
    await shown(host, 'Unsealed until');
    await host.getByRole('columnheader', { name: 'Gives to' }).waitFor();
    assert.ok((await api.host(made.host)).log.some((l) => l.t === 'unseal'));
    const pairs = pairsOf(await api.inside(made.host));
    await shown(host.getByRole('row', { name: /^Ben/ }), pairs.Ben);
    // Sealed again by hand; and a reload never keeps it open (the token lives in the page only).
    await host.getByRole('status').getByRole('button', { name: 'Seal again' }).click();
    await until(async () => (await host.getByRole('columnheader', { name: 'Gives to' }).count()) === 0, 'sealed');
    await shown(host, 'Sealed again');
    await tools(host, async () => {
      await field(host, 'Unseal code').fill(CODE);
      await host.getByRole('button', { name: 'Unseal', exact: true }).click();
    });
    await shown(host, 'Unsealed until');
    await host.reload();
    await shown(host, 'The draw is sealed');
    assert.equal(await host.getByRole('columnheader', { name: 'Gives to' }).count(), 0);

    // Five wrong codes in a row (the right one resets the count) lock it, even for the right code.
    for (let i = 0; i < 5; i++) await api.post(`/h/${made.host}/unseal`, { code: 'nope-nope' });
    await tools(host, async () => {
      await field(host, 'Unseal code').fill(CODE);
      await host.getByRole('button', { name: 'Unseal', exact: true }).click();
      await shown(host, 'Too many wrong codes');
      await shown(host, 'Five wrong codes: locked for 15 minutes');
    });
  },

  async 'the reminder names whoever still has something to do'(t) {
    const made = await api.make({ name: 'Team Xmas', names: ['Ben', 'Carla', 'David'] });
    await api.claim(made.group, 'Ben');
    const host = await t.page(DESK, { clipboard: true });
    await host.goto(`${base}/h/${made.host}`);
    await host.getByRole('button', { name: 'Copy a reminder' }).click();
    await shown(host, 'Reminder copied');
    const text = await host.evaluate(() => navigator.clipboard.readText());
    assert.match(text, /^Reminder for Team Xmas, still missing: /);
    assert.ok(text.includes('Carla') && text.includes('David') && !text.includes('Ben') && text.includes(`/g/${made.group}`), text);
  },

  async 'the host’s link: recovered with the code, made new, the code changed; the old links stop'(t) {
    const made = await api.make();
    const page = await t.page(DESK);
    await page.goto(`${base}/g/${made.group}`);
    await page.getByRole('button', { name: "I'm the host and lost my link" }).click();
    await field(page, 'Unseal code').fill(CODE);
    await page.getByRole('button', { name: 'Get a new host link' }).click();
    await page.waitForURL(/\/h\//);
    const second = keyOf(page.url());
    assert.notEqual(second, made.host);
    await shown(page, "Here's your new host page");
    assert.equal((await fetch(`${base}/api/h/${made.host}`)).status, 404);

    await tools(page, async () => {
      await page.getByRole('button', { name: 'Make a new host link' }).click();
      await page.getByRole('button', { name: 'Make a new link' }).click();
    });
    await until(() => keyOf(page.url()) !== second, 'a third host link');
    assert.equal((await fetch(`${base}/api/h/${second}`)).status, 404);
    const third = keyOf(page.url());

    await tools(page, async () => {
      await page.getByRole('button', { name: 'Change the code' }).click();
      await field(page, 'Current code').fill(CODE);
      await field(page, 'New code').fill('holly-and-ivy');
      await page.getByRole('button', { name: 'Change the code' }).click();
      await shown(page, 'Code changed');
    });
    assert.equal((await api.post(`/h/${third}/unseal`, { code: CODE })).status, 403);
    assert.equal((await api.post(`/h/${third}/unseal`, { code: 'holly-and-ivy' })).status, 200);
    const log = (await api.host(third)).log.map((l) => l.t);
    assert.ok(log.includes('recover') && log.includes('rekey') && log.includes('code'), log.join());
  },

  async 'deleting the group: gone for everyone at once'(t) {
    const made = await api.make();
    const ben = await api.claim(made.group, 'Ben');
    const person = await t.page(PHONE);
    await person.goto(`${base}/p/${ben}`);
    await shown(person, 'Hi Ben');
    const host = await t.page(DESK);
    await host.goto(`${base}/h/${made.host}`);
    await tools(host, async () => {
      await host.getByRole('button', { name: 'Delete now' }).click();
      await host.getByRole('button', { name: 'Delete everything' }).click();
    });
    await host.waitForURL(`${base}/`);
    await shown(host, 'The group is deleted');
    await shown(person, "This link doesn't work any more");
    for (const p of [`/g/${made.group}`, `/h/${made.host}`, `/p/${ben}`]) assert.equal((await fetch(`${base}/api${p}`)).status, 404, p);
    assert.equal((await fetch(`${base}/g/${made.group}`)).status, 404);
  },

  async 'the practice run: nine colleagues join and open by themselves, their pages open from the host’s, a live draw and the unseal'(t) {
    const host = await t.page(DESK);
    await host.goto(base);
    await host.getByRole('button', { name: 'Try a practice run' }).click();
    await field(host, 'Your name').fill('Eric');
    await host.getByRole('button', { name: 'Start the practice run' }).click();
    await host.waitForURL(/\/h\//);
    await shown(host, 'The colleagues are pretend. The unseal code is wichtel.');
    // At 60 times the pace, the late one joins after six seconds.
    await shown(host, '10 of 10 have joined', 15000);
    assert.equal(await host.getByText('pretend', { exact: true }).count(), 9);

    // A colleague's page, as they see it.
    const [look] = await Promise.all([host.waitForEvent('popup'), host.getByRole('row', { name: /Ben/ }).getByRole('link', { name: 'Look' }).click()]);
    t.watch(look);
    await shown(look, 'Hi Ben');
    await shown(look, 'Everyone here is pretend, apart from you.');

    await host.getByRole('button', { name: 'Draw', exact: true }).click();
    await host.getByRole('button', { name: 'Draw live now' }).click();
    await shown(host.getByRole('dialog', { name: 'The draw' }), 'Drawing for 10 people');
    await revealed(look, 9000);
    await host.getByRole('button', { name: 'Back to the group' }).click({ timeout: 9000 });
    // The quick colleagues open their doors within seconds; the two slow ones and Eric don't.
    await until(async () => (await api.host(keyOf(host.url()))).people.filter((p) => p.opened).length >= 7, 'the colleagues open', 12000);
    await tools(host, async () => {
      await field(host, 'Unseal code').fill('wichtel');
      await host.getByRole('button', { name: 'Unseal', exact: true }).click();
    });
    await shown(host, 'Unsealed until');
    await host.getByRole('columnheader', { name: 'Gives to' }).waitFor();
    await shown(host, 'Kastanienallee 12');
  },

  async 'German by default, every page; English when chosen'(t) {
    const made = await api.make({ lang: 'de' });
    const page = await t.page(DESK, { lang: null });
    await page.goto(base);
    await shown(page, 'Wichteln, ganz ohne Zettel');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'de');
    await page.goto(`${base}/g/${made.group}`);
    await shown(page, 'Wer bist du?');
    await page.goto(`${base}/h/${made.host}`);
    await shown(page, 'Orga-Werkzeug');
    await page.evaluate(() => localStorage.setItem('ewo:lang', 'en'));
    await page.reload();
    await shown(page, 'Host tools');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  },

  async 'every page at 390 px and at 1280, light and dark: no sideways scroll, the right ground'(t) {
    const made = await api.make({ handover: 'post', note: 'Wrap it in newspaper!', budget: 2500, place: 'The office, third floor', time: '18:00' });
    const ben = await api.claim(made.group, 'Ben');
    await api.claim(made.group, 'Carla');
    await api.post(`/p/${ben}/me`, { wishes: [{ t: 'A very long wish about a particularly enormous Christmas jumper with reindeer', l: '' }], not: 'Nothing scented', address: 'Ben Example\nA long street name 123\n12345 Town' });
    await api.act(made.host, 'draw');
    const pages = [['home', '/'], ['new', '/new'], ['group', `/g/${made.group}`], ['person', `/p/${ben}`], ['host', `/h/${made.host}`]];
    if (shots) await mkdir(shots, { recursive: true });
    for (const scheme of ['light', 'dark']) {
      for (const [size, options] of [['390', PHONE], ['1280', DESK]]) {
        const page = await t.page({ ...options, colorScheme: scheme });
        for (const [name, p] of pages) {
          await page.goto(base + p);
          await page.locator('main').first().waitFor();
          if (name === 'person') await page.getByRole('button', { name: /^Door \d+: open it/ }).click({ timeout: 1500 }).catch(() => {});
          await page.waitForTimeout(250);
          const { wide, inner, ground } = await page.evaluate(() => ({
            wide: document.documentElement.scrollWidth,
            inner: innerWidth,
            ground: getComputedStyle(document.body).backgroundColor,
          }));
          assert.ok(wide <= inner, `${name} at ${size} ${scheme}: ${wide} wide in ${inner}`);
          assert.equal(ground, scheme === 'light' ? 'rgb(247, 239, 227)' : 'rgb(28, 18, 11)', `${name} ${scheme}`);
          if (shots) await page.screenshot({ path: path.join(shots, `${name}-${size}-${scheme}.png`), fullPage: true });
        }
      }
    }
  },
};

// --- the runner ---------------------------------------------------------------------------------

let failed = 0;
const browser = await chromium.launch({ headless: !flag('--headed') }).catch((error) => {
  child.kill('SIGTERM');
  throw error;
});
for (const [name, test] of Object.entries(tests)) {
  if (grep && !name.includes(grep)) continue;
  const problems = [];
  const contexts = [];
  const watch = (page) => {
    page.on('console', (m) => m.type() === 'error' && !/the server responded with a status of 4\d\d/.test(m.text()) && problems.push(`console: ${m.text()}`));
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    page.on('request', (r) => !r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:') && problems.push(`asked another origin: ${r.url()}`));
    return page;
  };
  const t = {
    watch,
    /** A page in a fresh context: English unless `lang` says otherwise (null: the default, German). */
    async page(options, { lang = 'en', clipboard = false } = {}) {
      const context = await browser.newContext({ ...options, permissions: clipboard ? ['clipboard-read', 'clipboard-write'] : [] });
      if (lang) await context.addInitScript((l) => localStorage.setItem('ewo:lang', l), lang);
      contexts.push(context);
      return watch(await context.newPage());
    },
  };
  const started = Date.now();
  try {
    await test(t);
    if (problems.length) throw new Error(problems.join('\n'));
    console.log(`ok   ${name} (${Date.now() - started} ms)`);
  } catch (error) {
    failed++;
    console.log(`FAIL ${name}\n     ${String(error.stack ?? error).split('\n').slice(0, 6).join('\n     ')}`);
  } finally {
    for (const c of contexts) await c.close();
  }
}
await browser.close();
child.kill('SIGTERM');
await rm(data, { recursive: true, force: true });
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
