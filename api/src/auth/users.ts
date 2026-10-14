import type { AppUser } from '../env';

const SELECT_USER = 'SELECT id, email, name, is_admin, shelter_owner_at FROM users';

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const isEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;

/** Proving control of an email (code/link) signs into the account with that email, creating it if needed. */
export async function userForEmail(db: D1Database, email: string, name: string | null = null): Promise<AppUser> {
  const existing = await db.prepare(`${SELECT_USER} WHERE email = ?`).bind(email).first<AppUser>();
  if (existing) return existing;
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(id, email, name).run();
  return { id, email, name, is_admin: 0, shelter_owner_at: null };
}

/**
 * Google sign-in: a known Google account signs in directly; otherwise a verified Google email
 * links to the existing account with that email (or creates one).
 */
export async function userForGoogle(db: D1Database, sub: string, email: string, name: string | null): Promise<AppUser> {
  const linked = await db
    .prepare(`${SELECT_USER} WHERE id = (SELECT user_id FROM auth_identities WHERE provider = 'google' AND provider_user_id = ?)`)
    .bind(sub)
    .first<AppUser>();
  if (linked) return linked;
  const user = await userForEmail(db, email, name);
  await db
    .prepare("INSERT INTO auth_identities (provider, provider_user_id, user_id, email) VALUES ('google', ?, ?, ?)")
    .bind(sub, user.id, email)
    .run();
  if (!user.name && name) {
    await db.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, user.id).run();
    user.name = name;
  }
  return user;
}
