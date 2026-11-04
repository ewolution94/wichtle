import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createCensus } from '../server/census.mjs';

test("a group's keys never reach Census", async () => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ site: req.headers['x-site'], body: JSON.parse(body) });
      res.writeHead(204).end();
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const census = createCensus({ target: `http://127.0.0.1:${upstream.address().port}`, site: 'wichtle' });
  const app = http.createServer(async (req, res) => void ((await census(req, res)) || res.writeHead(404).end()));
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.address().port}`;
  for (const p of ['/g/k7Qm2xR9vTb4Zp1sYw8eLa', '/h/Hc4pW8aLs2DnQe7rTy5uMb/', '/p/Zt3vW8aLs2DnQe7rTy5uMb?x=1', '/new', '/']) {
    assert.equal((await fetch(base + '/_e', { method: 'POST', body: JSON.stringify({ t: 'pv', p }) })).status, 204);
  }
  assert.deepEqual(seen.map((s) => s.body.p), ['/g', '/h', '/p', '/new', '/']);
  assert.ok(seen.every((s) => s.site === 'wichtle'));
  app.close();
  upstream.close();
});
