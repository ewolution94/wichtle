import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
// @ts-expect-error: plain .mjs modules shared with the production server
import { createCensus } from './server/census.mjs';
// @ts-expect-error: as above
import { openStore } from './server/store.mjs';
// @ts-expect-error: as above
import { createApi } from './server/api.mjs';

// The dev server answers the API with the production code, on its own file in data/ (counts nothing
// for Census locally). The practice colleagues and the sweep run here too.
function server(): Plugin {
  const census = createCensus({ site: 'wichtle' });
  let api: { handle(req: unknown, res: unknown, url: URL): Promise<boolean> } | null = null;
  const middleware = async (req: any, res: any, next: (error?: unknown) => void) => {
    try {
      if (await census(req, res)) return;
      api ??= createApi({ store: openStore('data/dev.sqlite') });
      if (await api!.handle(req, res, new URL(req.url ?? '/', 'http://localhost'))) return;
      next();
    } catch (error) {
      next(error);
    }
  };
  return {
    name: 'wichtle-server',
    configureServer: (s) => void s.middlewares.use(middleware),
    configurePreviewServer: (s) => void s.middlewares.use(middleware),
  };
}

export default defineConfig({
  plugins: [svelte(), server()],
  // 7700 is the NAS port; locally the app runs beside it.
  server: { port: 7710, strictPort: true },
  preview: { port: 7711, strictPort: true },
  build: {
    target: 'es2022',
    cssTarget: ['chrome123', 'safari17.5', 'firefox120'],
    // The CSP allows fonts from 'self' only, not data: (learnings/toolchain.md).
    assetsInlineLimit: 0,
  },
});
