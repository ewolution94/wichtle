/**
 * Addresses: `/` is the home, `/new` starts a group, `/g/<key>` is the group link (the names, claiming),
 * `/h/<key>` the host's page and `/p/<key>` a person's own. One document serves them all (the server
 * writes the group's name into its title); moving between them is the History API.
 */

export const route = $state({ path: location.pathname });

addEventListener('popstate', () => {
  route.path = location.pathname;
});

/** Opens an address in the page. */
export function go(path: string, { replace = false } = {}) {
  if (path === location.pathname) return;
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  route.path = path;
  scrollTo({ top: 0 });
}

/** For `<a href>` in the app: a plain click stays in the page; a modified one opens a tab. */
export function nav(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const a = (event.currentTarget as HTMLElement).closest('a');
  if (!a || a.target === '_blank' || a.origin !== location.origin) return;
  event.preventDefault();
  go(a.pathname);
}

export type Page = { kind: 'home' } | { kind: 'new' } | { kind: 'g' | 'h' | 'p'; key: string } | { kind: 'missing' };

export function pageOf(path: string): Page {
  if (path === '/' || path === '') return { kind: 'home' };
  if (path === '/new' || path === '/new/') return { kind: 'new' };
  const m = /^\/([ghp])\/([A-Za-z0-9_-]{22})\/?$/.exec(path);
  return m ? { kind: m[1] as 'g' | 'h' | 'p', key: m[2] } : { kind: 'missing' };
}

/** A link to one of the group's pages, to copy. */
export const linkTo = (kind: 'g' | 'h' | 'p', key: string) => `${location.origin}/${kind}/${key}`;

/** For `<ewo-button href>`: its link is in a shadow root, so it gets the path to open. */
export const link = (path: string) => (event: MouseEvent) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  go(path);
};
