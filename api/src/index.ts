import * as Sentry from '@sentry/cloudflare';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { appOrigin, auth, publicUser } from './auth/routes';
import { currentUser } from './auth/session';
import { pets, readPoint } from './pets';
import type { AppContext, Env } from './env';
import { inDR, nearestPlace, PLACES_ATTRIBUTION, placeById, searchPlaces } from './places';
import { admin } from './admin';
import { runDigest } from './digest';
import { inbox } from './inbox';
import { listings } from './listings';
import { photoRoutes, servePhoto } from './photos';
import { portal } from './portal';
import { alerts, requests, requestsRestricted } from './requests';

export type { Env } from './env';

const app = new Hono<AppContext>();

// State-changing requests must carry JSON from the app's own origin. Browsers can't send cross-site
// JSON without CORS approval (which we never grant), and SameSite=Lax cookies are a second layer.
app.use('/api/*', async (c, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next();
  const origin = c.req.header('origin');
  const allowed = [appOrigin(c), new URL(c.req.url).origin];
  if (!origin || !allowed.includes(origin)) return c.json({ error: 'forbidden_origin' }, 403);
  if (!c.req.header('content-type')?.startsWith('application/json')) return c.json({ error: 'json_required' }, 415);
  await next();
});

// Private by default: anything that doesn't choose its own caching (account, Mi lista, sign-in) is
// never stored by browsers or Cloudflare.
app.use('/api/*', async (c, next) => {
  await next();
  if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store');
});

// Public reads are the same for everyone, so they skip the session lookup (a D1 read per request).
const PUBLIC_READ = /^\/api\/(pets|photos|places|whereami|health)(\/|$)/;
app.use('/api/*', async (c, next) => {
  c.set('user', c.req.method === 'GET' && PUBLIC_READ.test(c.req.path) ? null : await currentUser(c));
  await next();
});

app.get('/api/health', async (c) => {
  const row = await c.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
  return c.json({ ok: row?.ok === 1 });
});

app.route('/api/auth', auth);
app.route('/api/pets', pets);
app.route('/api/requests', requests);
app.route('/api/alerts', alerts);
app.route('/api/portal', portal);
app.route('/api/portal', listings);
app.route('/api/portal', photoRoutes);
app.route('/api/portal', inbox);
app.get('/api/photos/:key', servePhoto);
app.route('/api/admin', admin);

// ---------- Places (in-memory; no D1 reads) ----------

const DEFAULT_PLACE = 'gazcue-distrito-nacional';

app.get('/api/places', (c) => {
  c.header('Cache-Control', 'public, max-age=86400');
  return c.json({ places: searchPlaces(c.req.query('q') ?? ''), attribution: PLACES_ATTRIBUTION });
});

app.get('/api/places/nearest', (c) => {
  const point = readPoint(c.req.query('lat'), c.req.query('lng'));
  if (!point) return c.json({ error: 'invalid_point' }, 400);
  if (!inDR(point.lat, point.lng)) return c.json({ error: 'outside_dr' }, 404);
  return c.json({ place: nearestPlace(point.lat, point.lng) });
});

app.get('/api/places/:id', (c) => {
  const place = placeById(c.req.param('id'));
  return place ? c.json({ place }) : c.json({ error: 'not_found' }, 404);
});

// A starting point before the user picks a place: Cloudflare's IP-based city location when it's in
// the DR, otherwise Gazcue. Coarse by nature, and never stored.
app.get('/api/whereami', (c) => {
  const cf = c.req.raw.cf as { latitude?: string; longitude?: string } | undefined;
  const lat = Number(cf?.latitude);
  const lng = Number(cf?.longitude);
  const place = Number.isFinite(lat) && Number.isFinite(lng) && inDR(lat, lng) ? nearestPlace(lat, lng) : null;
  const chosen = place ?? placeById(DEFAULT_PLACE)!;
  return c.json({ place: chosen, source: place ? 'ip' : 'default' });
});

app.get('/api/me', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ user: null });
  const { results: shelters } = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.status, m.role FROM shelter_members m JOIN shelters s ON s.id = m.shelter_id WHERE m.user_id = ? ORDER BY s.name`,
  )
    .bind(user.id)
    .all<{ id: string; name: string; status: string; role: 'owner' | 'maintainer' }>();
  const contact = await c.env.DB.prepare('SELECT phone, contact_pref FROM users WHERE id = ?').bind(user.id).first<{ phone: string | null; contact_pref: string | null }>();
  const restricted = await requestsRestricted(c.env.DB, user.id);
  return c.json({ user: { ...publicUser(user), phone: contact?.phone ?? null, contactPref: contact?.contact_pref ?? null, requestsRestricted: restricted, shelters } });
});

app.patch('/api/me', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthenticated' }, 401);
  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
  const name = (body.name ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) return c.json({ error: 'invalid_name' }, 400);
  await c.env.DB.prepare("UPDATE users SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?")
    .bind(name, user.id)
    .run();
  return c.json({ user: publicUser({ ...user, name }) });
});

// Unexpected errors: reported to Sentry, answered with a plain 500 that leaks nothing.
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  Sentry.captureException(err);
  console.error(err);
  return c.json({ error: 'server_error' }, 500);
});

const PRIVATE_HEADERS = ['cookie', 'authorization', 'cf-connecting-ip', 'x-forwarded-for', 'x-real-ip', 'true-client-ip'];

/** Nothing personal leaves for Sentry: no cookies, bodies, query strings (OAuth codes) or IPs. */
function scrub(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  const req = event.request;
  if (req) {
    delete req.cookies;
    delete req.data;
    delete req.query_string;
    if (req.url) req.url = req.url.split('?')[0];
    if (req.headers) for (const h of Object.keys(req.headers)) if (PRIVATE_HEADERS.includes(h.toLowerCase())) delete req.headers[h];
  }
  delete event.user;
  return event;
}

// Requests outside /api/* are served from static assets (web/dist) before the Worker runs.
export default Sentry.withSentry<Env>(
  (env) => ({
    dsn: env.SENTRY_DSN, // unset (local dev): the SDK stays off
    environment: env.ENVIRONMENT,
    sendDefaultPii: false,
    tracesSampleRate: 0, // errors only, to stay within the free plan's quota
    beforeSend: scrub,
  }),
  {
    fetch: app.fetch,
    // The morning job: shelters' daily summaries and "Avísame" alerts (cron in wrangler.jsonc).
    scheduled: (_event, env, ctx) => ctx.waitUntil(runDigest(env).then((r) => console.log('morning job', r))),
  },
);
