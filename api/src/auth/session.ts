import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppContext, AppUser } from '../env';
import { isoIn, nowIso, randomToken, sha256 } from './crypto';

export const SESSION_COOKIE = '__Host-patiamor_session';
const SESSION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

type C = Context<AppContext>;

export async function startSession(c: C, userId: string) {
  const token = randomToken();
  await c.env.DB.prepare('INSERT INTO sessions (id_hash, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, isoIn(SESSION_DAYS * DAY), c.req.header('user-agent')?.slice(0, 200) ?? null)
    .run();
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

/** Resolves the signed-in user, extending the session at most once a day (rolling 30 days). */
export async function currentUser(c: C): Promise<AppUser | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const idHash = await sha256(token);
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.is_admin, s.expires_at, s.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = ?`,
  )
    .bind(idHash)
    .first<AppUser & { expires_at: string; last_seen_at: string }>();
  if (!row || row.expires_at < nowIso()) {
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
    return null;
  }
  if (Date.parse(row.last_seen_at) < Date.now() - DAY) {
    await c.env.DB.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?')
      .bind(nowIso(), isoIn(SESSION_DAYS * DAY), idHash)
      .run();
  }
  return { id: row.id, email: row.email, name: row.name, is_admin: row.is_admin };
}

export async function endSession(c: C) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(await sha256(token)).run();
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
}
