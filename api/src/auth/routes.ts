import { Google, decodeIdToken, generateCodeVerifier, generateState } from 'arctic';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppContext } from '../env';
import { isoIn, nowIso, randomToken, sha256, sixDigitCode, timingSafeEqual } from './crypto';
import { EmailQuotaError, hasEmailBudget, sendSignInEmail } from './email';
import { endSession, startSession } from './session';
import { checkHuman } from './turnstile';
import { isEmail, normalizeEmail, userForEmail, userForGoogle } from './users';

const CODE_TTL = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_EMAIL_HOUR = 5;
const MAX_CODES_PER_IP_HOUR = 20;
const RESEND_COOLDOWN_MS = 45 * 1000;

type C = Context<AppContext>;

export const appOrigin = (c: C) => c.env.APP_ORIGIN || new URL(c.req.url).origin;

/** Only in-app paths are allowed after sign-in (one leading slash, never "//"), so the redirect can't be
 *  pointed at another site. Hash routes from before PAT-32 ("#/lista") still work. */
export const safeNext = (next: string | undefined) => {
  const path = (next ?? '').replace(/^#/, '');
  return /^\/(?!\/)[\w\-/%]*(\?[\w\-=&%.]*)?$/.test(path) ? path : '/';
};
const backToApp = (c: C, next: string) => c.redirect(`${appOrigin(c)}${next}`, 302);

export const auth = new Hono<AppContext>();

// ---------- Email: one message carries a 6-digit code and a one-tap link ----------

/** What the sign-in screen needs before it renders: the Turnstile site key, or null when the check is off. */
auth.get('/config', (c) => c.json({ turnstile: c.env.TURNSTILE_SITE_KEY || null }));

auth.post('/email/start', async (c) => {
  type Body = { email?: string; next?: string; turnstile?: string };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  const email = normalizeEmail(body.email ?? '');
  if (!isEmail(email)) return c.json({ error: 'invalid_email' }, 400);
  // Before any database work, so a flood without tokens costs nothing.
  const human = await checkHuman(c.env, body.turnstile, c.req.header('cf-connecting-ip'));
  if (human === 'failed') return c.json({ error: 'human_check' }, 400);
  if (human === 'unavailable') return c.json({ error: 'human_check_unavailable' }, 503);

  const db = c.env.DB;
  const hourAgo = isoIn(-60 * 60 * 1000);
  const ipHash = await sha256(c.req.header('cf-connecting-ip') ?? 'local');
  const recent = await db
    .prepare('SELECT count(*) AS n, max(created_at) AS last FROM email_codes WHERE email = ? AND created_at > ?')
    .bind(email, hourAgo)
    .first<{ n: number; last: string | null }>();
  const byIp = await db
    .prepare('SELECT count(*) AS n FROM email_codes WHERE ip_hash = ? AND created_at > ?')
    .bind(ipHash, hourAgo)
    .first<{ n: number }>();
  if (recent?.last && Date.parse(recent.last) > Date.now() - RESEND_COOLDOWN_MS) return c.json({ error: 'too_soon' }, 429);
  if ((recent?.n ?? 0) >= MAX_CODES_PER_EMAIL_HOUR || (byIp?.n ?? 0) >= MAX_CODES_PER_IP_HOUR) {
    return c.json({ error: 'too_many' }, 429);
  }
  // Resend's free tier is 100 emails a day for the whole account; stop just short and say so kindly.
  if (!(await hasEmailBudget(db, 'signin'))) {
    console.error('daily email cap reached: sign-in code refused');
    return c.json({ error: 'email_quota' }, 503);
  }

  const id = crypto.randomUUID();
  const code = sixDigitCode();
  const linkToken = randomToken();
  await db
    .prepare('INSERT INTO email_codes (id, email, code_hash, link_token_hash, ip_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, email, await sha256(`${id}:${code}`), await sha256(linkToken), ipHash, isoIn(CODE_TTL))
    .run();

  const next = safeNext(body.next);
  // The link opens the app, which posts the token back. Mail scanners (Outlook Safe Links and the like)
  // fetch links before the person taps them; a GET that signed in would burn the token on their visit.
  const link = `${appOrigin(c)}/entrar?t=${linkToken}&next=${encodeURIComponent(next)}`;
  try {
    await sendSignInEmail(c.env, email, code, link);
  } catch (err) {
    // Nothing was sent, so the code mustn't count toward the cooldown or the hourly limits.
    await db.prepare('DELETE FROM email_codes WHERE id = ?').bind(id).run();
    if (err instanceof EmailQuotaError) {
      console.error('sign-in email quota exceeded at Resend', err.message);
      return c.json({ error: 'email_quota' }, 503);
    }
    console.error('sign-in email failed', err);
    return c.json({ error: 'email_failed' }, 502);
  }
  // Same answer whether or not an account exists, so the endpoint can't be used to probe emails.
  return c.json({ ok: true });
});

auth.post('/email/verify', async (c) => {
  const body = await c.req.json<{ email?: string; code?: string }>().catch(() => ({}) as { email?: string; code?: string });
  const email = normalizeEmail(body.email ?? '');
  const code = (body.code ?? '').replace(/\D/g, '');
  if (!isEmail(email) || code.length !== 6) return c.json({ error: 'invalid_code' }, 400);

  const db = c.env.DB;
  const row = await db
    .prepare(
      `SELECT id, code_hash, attempts FROM email_codes
        WHERE email = ? AND consumed_at IS NULL AND expires_at > ?
        ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(email, nowIso())
    .first<{ id: string; code_hash: string; attempts: number }>();
  if (!row || row.attempts >= MAX_ATTEMPTS) return c.json({ error: 'expired' }, 400);

  if (!timingSafeEqual(await sha256(`${row.id}:${code}`), row.code_hash)) {
    await db.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();
    return c.json({ error: 'wrong_code', attemptsLeft: MAX_ATTEMPTS - row.attempts - 1 }, 400);
  }
  await db.prepare('UPDATE email_codes SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL').bind(nowIso(), email).run();
  const user = await userForEmail(db, email);
  await startSession(c, user.id);
  return c.json({ user: publicUser(user) });
});

auth.post('/email/link', async (c) => {
  const body = await c.req.json<{ token?: string }>().catch(() => ({}) as { token?: string });
  const token = body.token ?? '';
  if (!token) return c.json({ error: 'link' }, 400);
  const db = c.env.DB;
  const row = await db
    .prepare('SELECT id, email FROM email_codes WHERE link_token_hash = ? AND consumed_at IS NULL AND expires_at > ? AND attempts < ?')
    .bind(await sha256(token), nowIso(), MAX_ATTEMPTS)
    .first<{ id: string; email: string }>();
  if (!row) return c.json({ error: 'link' }, 400);
  await db.prepare('UPDATE email_codes SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL').bind(nowIso(), row.email).run();
  const user = await userForEmail(db, row.email);
  await startSession(c, user.id);
  return c.json({ user: publicUser(user) });
});

// ---------- Google (OAuth 2.0 authorization code + PKCE) ----------

const OAUTH_COOKIE = { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 600 } as const;

function google(c: C) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = c.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return null;
  return new Google(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, `${new URL(c.req.url).origin}/api/auth/google/callback`);
}

auth.get('/google/start', (c) => {
  const client = google(c);
  if (!client) return backToApp(c, '/cuenta?error=google_unavailable');
  const state = generateState();
  const verifier = generateCodeVerifier();
  setCookie(c, '__Host-g_state', state, OAUTH_COOKIE);
  setCookie(c, '__Host-g_verifier', verifier, OAUTH_COOKIE);
  setCookie(c, '__Host-g_next', safeNext(c.req.query('next')), OAUTH_COOKIE);
  const url = client.createAuthorizationURL(state, verifier, ['openid', 'email', 'profile']);
  url.searchParams.set('prompt', 'select_account');
  return c.redirect(url.toString(), 302);
});

auth.get('/google/callback', async (c) => {
  const client = google(c);
  const state = getCookie(c, '__Host-g_state');
  const verifier = getCookie(c, '__Host-g_verifier');
  const next = safeNext(getCookie(c, '__Host-g_next'));
  for (const name of ['__Host-g_state', '__Host-g_verifier', '__Host-g_next']) deleteCookie(c, name, { path: '/', secure: true });

  const code = c.req.query('code');
  if (!client || !code || !state || !verifier || c.req.query('state') !== state) return backToApp(c, '/cuenta?error=google');

  let claims: { sub?: string; email?: string; email_verified?: boolean; name?: string };
  try {
    const tokens = await client.validateAuthorizationCode(code, verifier);
    claims = decodeIdToken(tokens.idToken()) as typeof claims;
  } catch (err) {
    console.error('google token exchange failed', err);
    return backToApp(c, '/cuenta?error=google');
  }
  // The ID token came straight from Google's token endpoint over TLS, so its claims can be trusted as-is.
  if (!claims.sub || !claims.email || claims.email_verified !== true) return backToApp(c, '/cuenta?error=google_email');

  const user = await userForGoogle(c.env.DB, claims.sub, normalizeEmail(claims.email), claims.name ?? null);
  await startSession(c, user.id);
  return backToApp(c, `${next}${next.includes('?') ? '&' : '?'}signedin=1`);
});

// ---------- Session ----------

auth.post('/logout', async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

export function publicUser(u: { id: string; email: string; name: string | null; is_admin: number }) {
  return { id: u.id, email: u.email, name: u.name, isAdmin: u.is_admin === 1 };
}
