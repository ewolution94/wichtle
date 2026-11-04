// Each address's page: the built index.html with the group's name in its title and link preview.
// No dependencies.

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const WORDS = {
  de: { g: 'Wichteln mit Wichtle: tipp deinen Namen an.', h: 'Die Orga-Seite einer Wichtel-Gruppe.', p: 'Dein Wichteln auf Wichtle.', practice: 'Ein Probelauf auf Wichtle.' },
  en: { g: 'Secret Santa on Wichtle: tap your name.', h: 'The group, for its host.', p: 'Your Secret Santa on Wichtle.', practice: 'A practice run on Wichtle.' },
};

/**
 * The page for an address. A group's links get its name as the title and the link preview's title,
 * and nothing else from it: a messenger that fetches the link would carry whatever the preview
 * shows, so no drawn name, wish or address is ever in the HTML. Group pages aren't for search engines.
 */
export function render(html, pathname, lang, { api, origin }) {
  const match = /^\/([ghp])\/([A-Za-z0-9_-]+)\/?$/.exec(pathname);
  if (pathname === '/') return { status: 200, html };
  let status = 404;
  let title = 'Wichtle';
  let description = null;
  if (match) {
    const page = api.page(match[1], match[2]);
    if (page) {
      status = 200;
      title = `${page.name} · Wichtle`;
      description = WORDS[lang][page.practice ? 'practice' : match[1]];
    }
  } else if (pathname === '/new') status = 200;
  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>`)
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${escape(title)}`)
    .replace(/(<meta property="og:url" content=")[^"]*/, `$1${origin}${escape(pathname)}`)
    .replace(/<link rel="canonical"[^>]*>\n?\s*/, '')
    .replace('</head>', '  <meta name="robots" content="noindex" />\n  </head>');
  if (description) {
    html = html
      .replace(/(<meta name="description" content=")[^"]*/, `$1${escape(description)}`)
      .replace(/(<meta property="og:description" content=")[^"]*/, `$1${escape(description)}`);
  }
  return { status, html };
}
