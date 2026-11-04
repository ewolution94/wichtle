// Production server: the built page from ../dist, the groups' API and live streams (api.mjs) on a
// SQLite file (store.mjs), each group's pages with its name in the title and link preview, and the
// Census forwarder. No dependencies.
//
//   PORT=8080 HOST=0.0.0.0 WICHTLE_DATA=./data node server/server.mjs
//
// The environment variables are in the README; DASHBOARD_URL (Dashboard's apps' port, e.g.
// http://dashboard:8081) gives the language and theme a device that hasn't picked starts from
// (public/ewo.config.json).

import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createCensus } from './census.mjs';
import { openStore } from './store.mjs';
import { createApi } from './api.mjs';
import { render } from './pages.mjs';
import { createConfig } from '../vendor/ewo/elements/config-server.js';

const portFlag = process.argv.indexOf('--port');
const PORT = Number(portFlag > -1 ? process.argv[portFlag + 1] : (process.env.PORT ?? 8080));
const HOST = process.env.HOST ?? '0.0.0.0';
const DIST = path.resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const DATA = path.resolve(process.env.WICHTLE_DATA ?? fileURLToPath(new URL('../data', import.meta.url)));
const ORIGIN = process.env.WICHTLE_ORIGIN ?? 'https://wichtle.ewolution.cloud';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt']);

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  // https only from the first secure visit on (browsers ignore it over plain http).
  'strict-transport-security': 'max-age=31536000',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    // Svelte writes style="" attributes (the village's houses, the candles); the shared elements use
    // constructable stylesheets.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; '),
};

const store = openStore(path.join(DATA, 'wichtle.sqlite'));
// WICHTLE_PRACTICE_PACE runs the practice colleagues faster, for the end-to-end tests only.
const api = createApi({ store, pace: Math.max(1, Number(process.env.WICHTLE_PRACTICE_PACE) || 1) });
const census = createCensus({ target: process.env.WICHTLE_CENSUS ?? '', site: 'wichtle' });
const compressed = new Map();
let template = null;

// Dashboard's values for this app (the language and theme a device that hasn't picked starts from),
// checked against the manifest. Until Dashboard answers, and whenever it's down, the built-in ones:
// German, and the device's theme. Never part of /healthz.
const config = createConfig({
  manifest: JSON.parse(await readFile(path.join(DIST, 'ewo.config.json'), 'utf8')),
  url: process.env.DASHBOARD_URL ?? '',
  dataFile: path.join(DATA, 'ewo-config.json'),
});
config.start();

async function resolveFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const file = path.join(DIST, path.normalize(decoded));
  if (file !== DIST && !file.startsWith(DIST + path.sep)) return null;
  try {
    const info = await stat(file);
    if (info.isFile()) return { file, size: info.size, mtime: info.mtime };
  } catch {}
  return null;
}

function send(req, res, status, headers, raw, ext) {
  const accept = req.headers['accept-encoding'] ?? '';
  const encoding = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
  if (encoding && COMPRESSIBLE.has(ext)) {
    const body = encoding === 'br' ? zlib.brotliCompressSync(raw) : zlib.gzipSync(raw);
    res.writeHead(status, { ...headers, 'content-encoding': encoding, 'content-length': body.length, vary: 'accept-encoding' });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }
  res.writeHead(status, { ...headers, 'content-length': raw.length });
  res.end(req.method === 'HEAD' ? undefined : raw);
}

async function servePage(req, res, pathname) {
  template ??= await readFile(path.join(DIST, 'index.html'), 'utf8');
  // German unless the browser asks for English first.
  const lang = /^\s*en\b/i.test(req.headers['accept-language'] ?? '') ? 'en' : 'de';
  // The page carries Dashboard's values (#ewo-config, a data block the CSP allows).
  const page = render(config.inject(template), pathname, lang, { api, origin: ORIGIN });
  const headers = { 'content-type': MIME['.html'], 'cache-control': 'no-cache', vary: 'accept-language' };
  if (pathname !== '/') headers['x-robots-tag'] = 'noindex';
  send(req, res, page.status, headers, Buffer.from(page.html), '.html');
}

async function serveStatic(req, res, pathname) {
  if (pathname === '/robots.txt') {
    // The home only: a group's links are its keys.
    const robots = 'User-agent: *\nAllow: /$\nDisallow: /g/\nDisallow: /h/\nDisallow: /p/\nDisallow: /new\nDisallow: /api/\n';
    return send(req, res, 200, { 'content-type': MIME['.txt'], 'cache-control': 'no-cache' }, Buffer.from(robots), '.txt');
  }
  if (pathname === '/' || pathname === '/index.html') return servePage(req, res, '/');

  const entry = await resolveFile(pathname);
  // A path without an extension is a page: a group's link, or a typo, which gets the app with a
  // 404. A missing file with an extension stays a plain 404, so an old /assets/ name after a deploy
  // never gets the HTML.
  if (!entry) {
    if (!path.extname(pathname)) return servePage(req, res, pathname);
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }

  const ext = path.extname(entry.file);
  const headers = {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    'last-modified': entry.mtime.toUTCString(),
  };

  const accept = req.headers['accept-encoding'] ?? '';
  const encoding = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
  if (encoding && COMPRESSIBLE.has(ext) && entry.size < 8 * 1024 * 1024) {
    const key = `${entry.file}:${entry.mtime.getTime()}:${encoding}`;
    let body = compressed.get(key);
    if (!body) {
      const raw = await readFile(entry.file);
      body = encoding === 'br' ? zlib.brotliCompressSync(raw) : zlib.gzipSync(raw);
      compressed.set(key, body);
    }
    res.writeHead(200, { ...headers, 'content-encoding': encoding, 'content-length': body.length, vary: 'accept-encoding' });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }

  res.writeHead(200, { ...headers, 'content-length': entry.size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(entry.file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/healthz') return res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);

  try {
    if (await census(req, res)) return;
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (await api.handle(req, res, url)) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500).end('Internal error');
    else res.destroy();
  }
});

// Docker stops containers with SIGTERM, which Node ignores as PID 1 unless handled; without
// this, every Watchtower update waits out the 10 s grace period and then kills us. The live
// streams are ended first, so the pages reconnect to the new container at once.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    api.close();
    config.stop();
    server.close(() => {
      store.close();
      process.exit(0);
    });
    server.closeAllConnections();
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

server.listen(PORT, HOST, () => {
  console.log(`Wichtle listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
