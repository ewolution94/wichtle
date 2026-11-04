import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
// What Wichtle hands Dashboard (public/ewo.config.json), checked with Folio's own rules; the page's
// #ewo-config as the server inlines it; and the order public/boot.js decides in before first paint:
// this device's own choice, then Dashboard's default, then the built-in one (German, the device's
// theme). src/lib/theme.svelte.ts and src/lib/i18n.svelte.ts mirror boot.js.
import { checkManifest, resolve } from '../vendor/ewo/elements/config-core.js';
import { createConfig } from '../vendor/ewo/elements/config-server.js';

const manifest = JSON.parse(readFileSync(new URL('../public/ewo.config.json', import.meta.url), 'utf8'));
const LIGHT = '#f7efe3';
const DARK = '#1c120b';

test('the manifest is one Dashboard takes: the family’s language and theme', () => {
  const { ok, problems, manifest: checked } = checkManifest(manifest);
  assert.deepEqual(problems, []);
  assert.ok(ok);
  assert.equal(checked.app, 'wichtle');
  assert.deepEqual(Object.keys(checked.settings), ['lang', 'theme']);
});

test('with nothing set in Dashboard, both follow the device; Dashboard’s values reach the page', () => {
  assert.deepEqual(resolve(manifest, {}), { values: { lang: 'system', theme: 'system' }, sources: { lang: 'built-in', theme: 'built-in' } });
  assert.deepEqual(resolve(manifest, { family: { theme: 'dark', lang: 'en' } }).values, { lang: 'en', theme: 'dark' });
  assert.deepEqual(resolve(manifest, { family: { theme: 'dark' }, app: { theme: 'light' } }).values, { lang: 'system', theme: 'light' });
});

test('without DASHBOARD_URL the page still carries the built-in values, first in <head>', () => {
  const config = createConfig({ manifest, url: '' });
  assert.equal(config.state(), 'off');
  const html = config.inject('<!doctype html><html><head><title>Wichtle</title></head><body></body></html>');
  const block = html.match(/<head>\s*(<script type="application\/json" id="ewo-config">([^<]*)<\/script>)/);
  assert.ok(block, html);
  assert.deepEqual(JSON.parse(block[2]), { lang: 'system', theme: 'system' });
});

/** public/boot.js against a stub page: the theme and language it applies before first paint. */
function boot({ theme, lang, config }) {
  const root = { dataset: {}, lang: '', classList: { add() {}, remove() {} }, style: { setProperty() {} } };
  const metas = [{ content: LIGHT }, { content: DARK }];
  const saved = { 'wichtle:theme': theme, 'ewo:lang': lang };
  vm.runInNewContext(readFileSync(new URL('../public/boot.js', import.meta.url), 'utf8'), {
    document: {
      documentElement: root,
      getElementById: (id) => (id === 'ewo-config' && config ? { textContent: JSON.stringify(config) } : null),
      querySelectorAll: () => metas,
      addEventListener() {},
    },
    localStorage: { getItem: (key) => saved[key] ?? null },
    matchMedia: () => ({ matches: false }),
    navigator: {},
    location: { search: '' },
    screen: {},
    addEventListener() {},
    setTimeout() {},
  });
  return { theme: root.dataset.theme, colors: metas.map((m) => m.content), lang: root.lang };
}

test('before first paint: the saved theme, else Dashboard’s, else the system’s', () => {
  assert.deepEqual(boot({}), { theme: undefined, colors: [LIGHT, DARK], lang: 'de' });
  assert.equal(boot({ config: { theme: 'system' } }).theme, undefined);
  assert.deepEqual(boot({ config: { theme: 'dark' } }), { theme: 'dark', colors: [DARK, DARK], lang: 'de' });
  assert.deepEqual(boot({ theme: 'light', config: { theme: 'dark' } }), { theme: 'light', colors: [LIGHT, LIGHT], lang: 'de' });
  assert.equal(boot({ theme: 'purple', config: { theme: 'light' } }).theme, 'light');
});

test('the language: this device’s, else Dashboard’s English, else German', () => {
  assert.equal(boot({}).lang, 'de');
  assert.equal(boot({ config: { lang: 'en' } }).lang, 'en');
  assert.equal(boot({ config: { lang: 'system' } }).lang, 'de');
  // QA's `ewo:lang` = `en` is this device's own choice, so it keeps winning.
  assert.equal(boot({ lang: 'en', config: { lang: 'de' } }).lang, 'en');
  assert.equal(boot({ lang: 'de', config: { lang: 'en' } }).lang, 'de');
});
