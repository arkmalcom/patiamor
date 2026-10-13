import { Hono } from 'hono';
import { appOrigin, auth, publicUser } from './auth/routes';
import { currentUser } from './auth/session';
import { pets, readPoint } from './pets';
import type { AppContext } from './env';
import { inDR, nearestPlace, PLACES_ATTRIBUTION, placeById, searchPlaces } from './places';
import { shortlist } from './shortlist';

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

app.use('/api/*', async (c, next) => {
  c.set('user', await currentUser(c));
  await next();
});

app.get('/api/health', async (c) => {
  const row = await c.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
  return c.json({ ok: row?.ok === 1 });
});

app.route('/api/auth', auth);
app.route('/api/pets', pets);
app.route('/api/shortlist', shortlist);

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
    `SELECT s.id, s.name, m.role FROM shelter_members m JOIN shelters s ON s.id = m.shelter_id WHERE m.user_id = ? ORDER BY s.name`,
  )
    .bind(user.id)
    .all<{ id: string; name: string; role: 'owner' | 'maintainer' }>();
  return c.json({ user: { ...publicUser(user), shelters } });
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

// Requests outside /api/* are served from static assets (web/dist) before the Worker runs.
export default app;
