import type { Env } from '../env';

// Turnstile: Cloudflare's free bot check, on the endpoint that spends the email budget. A script that
// requests codes for many addresses could use up the day's emails and lock everyone else out.
// Off while TURNSTILE_SITE_KEY is unset. Once it is set, a missing secret refuses sign-ins instead of
// quietly skipping the check.

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type HumanCheck = 'off' | 'passed' | 'failed' | 'unavailable';

export async function checkHuman(env: Pick<Env, 'TURNSTILE_SITE_KEY' | 'TURNSTILE_SECRET'>, token: unknown, ip?: string): Promise<HumanCheck> {
  if (!env.TURNSTILE_SITE_KEY) return 'off';
  if (!env.TURNSTILE_SECRET) {
    console.error('TURNSTILE_SITE_KEY is set but TURNSTILE_SECRET is not: email sign-in is refused');
    return 'unavailable';
  }
  // Tokens are at most 2048 characters.
  if (typeof token !== 'string' || !token || token.length > 2048) return 'failed';
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const res = await fetch(SITEVERIFY, { method: 'POST', body: form });
    const out = await res.json<{ success?: boolean; 'error-codes'?: string[] }>();
    if (out.success === true) return 'passed';
    console.warn('turnstile rejected a token', out['error-codes']);
    return 'failed';
  } catch (err) {
    console.error('turnstile siteverify failed', err);
    return 'unavailable';
  }
}
