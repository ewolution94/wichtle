import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openStore } from '../server/store.mjs';
import { createApi } from '../server/api.mjs';
import { render } from '../server/pages.mjs';

const TEMPLATE = `<!doctype html><html><head>
<title>Wichtle</title>
<meta name="description" content="Wichteln for your group." />
<link rel="canonical" href="https://wichtle.ewolution.cloud/" />
<meta property="og:title" content="Wichtle" />
<meta property="og:description" content="Wichteln for your group." />
<meta property="og:url" content="https://wichtle.ewolution.cloud/" />
</head><body><div id="app"></div></body></html>`;

test("no page's HTML carries a drawn name, a wish or an address", async () => {
  const api = createApi({ store: openStore(':memory:'), timers: false });
  const server = http.createServer(async (req, res) => void ((await api.handle(req, res, new URL(req.url, 'http://x'))) || res.writeHead(404).end()));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => (await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })).json();
  const party = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  const { group, host, me } = await post('/api/groups', { name: 'Feier <im> Büro', party, host: { name: 'Anna' }, names: ['Bertram', 'Cordula'], code: 'tannenbaum' });
  const view = await (await fetch(`${base}/api/g/${group}`)).json();
  const keys = [me];
  for (const p of view.people.slice(1)) keys.push((await post(`/api/g/${group}/claim`, { id: p.id })).me);
  for (const [i, k] of keys.entries()) await post(`/api/p/${k}/me`, { handover: 'post', address: `Geheimweg ${i}`, wishes: [{ t: `Wunsch${i}` }] });
  await post(`/api/h/${host}/draw`);

  for (const [letter, key] of [['g', group], ['h', host], ...keys.map((k) => ['p', k])]) {
    for (const lang of ['de', 'en']) {
      const { status, html } = render(TEMPLATE, `/${letter}/${key}`, lang, { api, origin: 'https://wichtle.ewolution.cloud' });
      assert.equal(status, 200);
      assert.match(html, /<title>Feier &lt;im&gt; Büro · Wichtle<\/title>/);
      assert.match(html, /<meta name="robots" content="noindex" \/>/);
      assert.ok(!html.includes('rel="canonical"'));
      for (const secret of ['Bertram', 'Cordula', 'Geheimweg', 'Wunsch', 'Anna']) assert.ok(!html.includes(secret), `${letter} ${secret}`);
    }
  }
  // A key on the wrong path, or none at all: the app with a 404 and the plain title.
  for (const path of [`/p/${group}`, '/g/AAAAAAAAAAAAAAAAAAAAAA', '/nowhere']) {
    const { status, html } = render(TEMPLATE, path, 'de', { api, origin: '' });
    assert.equal(status, 404);
    assert.match(html, /<title>Wichtle<\/title>/);
  }
  assert.equal(render(TEMPLATE, '/', 'de', { api, origin: '' }).html, TEMPLATE);
  api.close();
  server.closeAllConnections();
  server.close();
});
