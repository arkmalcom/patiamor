import type { Context } from 'hono';
import { cachedText } from './cache';
import type { AppContext, Env } from './env';
import { CASE_VISIBLE } from './cases';
import { VISIBLE } from './pets';

// Search engines. The app is one page that draws itself, so what a crawler can be told lives here: which
// addresses may be indexed (robots.txt), which pages exist (the sitemap), and, in share.ts, each pet's
// title, description and canonical address. Both files are served by the Worker (run_worker_first in
// wrangler.jsonc) because they depend on where the app is running and on what is published right now.

type C = Context<AppContext>;

/** Only production, at its own address, is for search. Staging (sample data) and the Worker's workers.dev
 *  address would otherwise be indexed as copies of the real site. */
export function indexable(env: Pick<Env, 'ENVIRONMENT' | 'APP_ORIGIN'>, requestOrigin: string) {
  return env.ENVIRONMENT === 'production' && !!env.APP_ORIGIN && new URL(env.APP_ORIGIN).origin === requestOrigin;
}

/** The address pages are listed under: the configured one, or wherever the request came from. */
const siteOrigin = (c: C) => c.env.APP_ORIGIN || new URL(c.req.url).origin;

// /api/ is deliberately not blocked: the pages fetch their content from it, and a crawler that can't read
// it sees an empty page. Photos live there too, so blocking it would also keep them out of image search.
// Mi lista, the account, the portal and sign-in are private and have nothing to index; /buscar has a page
// per query and no content of its own.
const PRIVATE_PATHS = ['/refugio', '/cuenta', '/lista', '/entrar', '/buscar'];

export function robots(c: C) {
  const origin = new URL(c.req.url).origin;
  const body = indexable(c.env, origin)
    ? ['User-agent: *', ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`), '', `Sitemap: ${siteOrigin(c)}/sitemap.xml`, ''].join('\n')
    : 'User-agent: *\nDisallow: /\n';
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=UTF-8', 'Cache-Control': 'public, max-age=3600' } });
}

/** A sitemap file holds 50,000 addresses at most. */
const SITEMAP_LIMIT = 50_000;
const xml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** The front page, the legal texts (Spanish and English, each pointing to the other), every animal open to
 *  adoption requests (not "en proceso", adopted or withdrawn), and the help cases with their list. */
export function sitemap(c: C) {
  return cachedText(c, '/sitemap.xml', 'application/xml; charset=UTF-8', async () => {
    const origin = siteOrigin(c);
    const { results } = await c.env.DB.prepare(
      `SELECT d.id, d.updated_at FROM pets d LEFT JOIN shelters s ON s.id = d.shelter_id WHERE ${VISIBLE} ORDER BY d.updated_at DESC LIMIT ?`,
    )
      .bind(SITEMAP_LIMIT - 300)
      .all<{ id: string; updated_at: string }>();
    // At most 200 open (cases.ts), so they fit in the room left above.
    const { results: open } = await c.env.DB.prepare(
      `SELECT k.id, k.active_at FROM cases k JOIN shelters s ON s.id = k.shelter_id WHERE ${CASE_VISIBLE} ORDER BY k.active_at DESC LIMIT 250`,
    ).all<{ id: string; active_at: string }>();
    const url = (path: string, lastmod?: string, languages?: Record<string, string>) =>
      `<url><loc>${xml(origin + path)}</loc>${lastmod ? `<lastmod>${xml(lastmod)}</lastmod>` : ''}` +
      Object.entries(languages ?? {}).map(([lang, alt]) => `<xhtml:link rel="alternate" hreflang="${lang}" href="${xml(origin + alt)}"/>`).join('') +
      '</url>';
    const legal = (es: string, en: string) => [url(es, undefined, { 'es-DO': es, en }), url(en, undefined, { 'es-DO': es, en })];
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
      url('/'),
      ...legal('/privacidad', '/en/privacy'),
      ...legal('/terminos', '/en/terms'),
      ...results.map((p) => url(`/mascota/${encodeURIComponent(p.id)}`, p.updated_at)),
      url('/ayudar'),
      ...open.map((k) => url(`/caso/${encodeURIComponent(k.id)}`, k.active_at)),
      '</urlset>',
      '',
    ].join('\n');
  });
}
