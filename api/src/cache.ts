import type { Context } from 'hono';
import type { AppContext } from './env';

// Edge cache for public catalogue responses: the national pet list and each pet's profile. One copy
// serves everyone, so D1 is only read when the catalogue changes or a copy ages out.
//
// Copies are keyed by the catalogue version (migration 0006: triggers bump it on any change to pets,
// photos or shelters). Bumping it makes every copy miss at once in every data centre; Cloudflare's
// cache.delete() would only clear the data centre it ran in.
//
// The Cache API only works on a custom domain (patiamor.com). On workers.dev (staging) put/match are
// no-ops, so staging always reads D1 and never shows a HIT.

const EDGE_TTL = 600; // seconds a copy may serve before it's rebuilt, even with no change (e.g. pets turning 8 weeks)
const BROWSER_TTL = 60; // browsers come back to the edge after a minute, so changes reach them quickly
const VERSION_TTL = 30_000; // ms an isolate trusts the version it read, so most requests skip D1 entirely

let known: { v: number; at: number } | null = null;

/** Drops this isolate's remembered version, so the next read sees a change made just now. */
export function forgetCatalogVersion() {
  known = null;
}

async function catalogVersion(db: D1Database): Promise<number> {
  if (known && Date.now() - known.at < VERSION_TTL) return known.v;
  const row = await db.prepare('SELECT v FROM catalog_version WHERE id = 1').first<{ v: number }>();
  known = { v: row?.v ?? 0, at: Date.now() };
  return known.v;
}

const forBrowser = (res: Response, state: 'HIT' | 'MISS') => {
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', `public, max-age=${BROWSER_TTL}`);
  out.headers.set('X-Cache', state);
  return out;
};

/**
 * Serves `path` from the edge cache, building it with `build` on a miss. The key ignores the query
 * string, so made-up parameters can't force fresh database reads. Not-found answers are cached too,
 * so guessing ids can't either.
 */
export async function cachedJson(c: Context<AppContext>, path: string, build: () => Promise<{ body: unknown; status?: 200 | 404 | 410 }>) {
  const v = await catalogVersion(c.env.DB);
  const key = new Request(`${new URL(c.req.url).origin}/__catalog/v${v}${path}`);
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(key);
  if (hit) return forBrowser(hit, 'HIT');
  const { body, status = 200 } = await build();
  const res = new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': `public, max-age=${EDGE_TTL}` },
  });
  c.executionCtx.waitUntil(cache.put(key, res.clone()));
  return forBrowser(res, 'MISS');
}
