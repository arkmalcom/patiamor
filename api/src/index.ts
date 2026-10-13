import { Hono } from 'hono';
import { appOrigin, auth, publicUser } from './auth/routes';
import { currentUser } from './auth/session';
import type { AppContext } from './env';

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
