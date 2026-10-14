import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from '../src/auth/crypto';
import { checkHuman } from '../src/auth/turnstile';
import { api, signIn } from './helpers';

// Sign-in: the Turnstile bot check in front of the email budget, and sessions that last.

const NINETY_DAYS = 90 * 24 * 60 * 60;

/** Answers Turnstile's siteverify like Cloudflare would; everything else is a test failure. */
function stubSiteverify(success: boolean) {
  const calls: FormData[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith('https://challenges.cloudflare.com/turnstile/v0/siteverify')) throw new Error(`unexpected fetch ${url}`);
    calls.push(init?.body as FormData);
    return Response.json({ success, 'error-codes': success ? [] : ['invalid-input-response'] });
  });
  return calls;
}

const codesFor = async (email: string) => (await env.DB.prepare('SELECT count(*) AS n FROM email_codes WHERE email = ?').bind(email).first<{ n: number }>())!.n;
const start = (email: string, turnstile?: string) => api('/api/auth/email/start', { method: 'POST', body: { email, turnstile } });

afterEach(() => vi.restoreAllMocks());

describe('Turnstile on email sign-in', () => {
  it('tells the sign-in screen which site key to use', async () => {
    expect((await api('/api/auth/config')).json).toEqual({ turnstile: '1x00000000000000000000AA' });
  });

  it('sends no code without a token, and spends nothing on the database', async () => {
    const calls = stubSiteverify(true);
    const email = `sin-token-${crypto.randomUUID().slice(0, 6)}@example.test`;
    expect((await start(email)).json.error).toBe('human_check');
    expect(calls).toHaveLength(0);
    expect(await codesFor(email)).toBe(0);
  });

  it('sends no code when Cloudflare rejects the token', async () => {
    stubSiteverify(false);
    const email = `bot-${crypto.randomUUID().slice(0, 6)}@example.test`;
    expect((await start(email, 'XXXX.DUMMY.TOKEN.XXXX')).json.error).toBe('human_check');
    expect(await codesFor(email)).toBe(0);
  });

  it('sends the code when the token passes, checking it with the secret', async () => {
    const calls = stubSiteverify(true);
    const email = `persona-${crypto.randomUUID().slice(0, 6)}@example.test`;
    expect((await start(email, 'XXXX.DUMMY.TOKEN.XXXX')).json).toEqual({ ok: true });
    expect(calls[0].get('secret')).toBe('1x0000000000000000000000000000000AA');
    expect(calls[0].get('response')).toBe('XXXX.DUMMY.TOKEN.XXXX');
    expect(await codesFor(email)).toBe(1);
  });

  it('is off without a site key, and refuses (not skips) when only the secret is missing', async () => {
    expect(await checkHuman({}, undefined)).toBe('off');
    expect(await checkHuman({ TURNSTILE_SITE_KEY: 'k' }, 'token')).toBe('unavailable');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'));
    expect(await checkHuman({ TURNSTILE_SITE_KEY: 'k', TURNSTILE_SECRET: 's' }, 'token')).toBe('unavailable');
  });
});

describe('sessions', () => {
  it('last 90 days from sign-in', async () => {
    const email = `codigo-${crypto.randomUUID().slice(0, 6)}@example.test`;
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO email_codes (id, email, code_hash, link_token_hash, ip_hash, expires_at) VALUES (?, ?, ?, 'x', 'x', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+15 minutes'))")
      .bind(id, email, await sha256(`${id}:123456`))
      .run();
    const res = await api('/api/auth/email/verify', { method: 'POST', body: { email, code: '123456' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain(`Max-Age=${NINETY_DAYS}`);
  });

  it('roll forward on a visit, renewing the cookie as well as the database row', async () => {
    const u = await signIn();
    await env.DB.prepare("UPDATE sessions SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-2 days') WHERE user_id = ?").bind(u.id).run();
    const res = await api('/api/me', { cookie: u.cookie });
    expect(res.json.user.id).toBe(u.id);
    expect(res.headers.get('set-cookie')).toContain(`Max-Age=${NINETY_DAYS}`);
    const row = await env.DB.prepare('SELECT expires_at FROM sessions WHERE user_id = ?').bind(u.id).first<{ expires_at: string }>();
    expect(Date.parse(row!.expires_at) - Date.now()).toBeGreaterThan((NINETY_DAYS - 60) * 1000);
    // Seen today already: no write, no new cookie.
    expect((await api('/api/me', { cookie: u.cookie })).headers.get('set-cookie')).toBeNull();
  });
});
