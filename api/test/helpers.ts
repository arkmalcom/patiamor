import { env, exports } from 'cloudflare:workers';
import { randomToken, sha256 } from '../src/auth/crypto';

// Helpers for API tests: real requests through the Worker, with users signed in by a real session row.

export const ORIGIN = 'http://example.test';

let n = 0;
/** A user with a live session; returns the cookie to send. */
export async function signIn(opts: { admin?: boolean; name?: string } = {}) {
  const id = `user-${++n}-${Date.now()}`;
  const email = `${id}@example.test`;
  await env.DB.prepare('INSERT INTO users (id, email, name, is_admin) VALUES (?, ?, ?, ?)').bind(id, email, opts.name ?? 'Prueba', opts.admin ? 1 : 0).run();
  const token = randomToken();
  await env.DB.prepare("INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+1 day'))")
    .bind(await sha256(token), id)
    .run();
  return { id, email, cookie: `__Host-patiamor_session=${token}` };
}

/** Calls the API like the app does: JSON, same origin, optional session. */
export async function api(path: string, opts: { method?: string; body?: unknown; cookie?: string; origin?: string } = {}) {
  const headers: Record<string, string> = { Origin: opts.origin ?? ORIGIN };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.cookie) headers.Cookie = opts.cookie;
  const res = await exports.default.fetch(new Request(`${ORIGIN}${path}`, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }));
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, headers: res.headers };
}
