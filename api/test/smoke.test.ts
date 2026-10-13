import { describe, expect, it } from 'vitest';
import { api, signIn } from './helpers';

describe('API basics', () => {
  it('answers health with the database reachable', async () => {
    const r = await api('/api/health');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true });
  });

  it('knows who is signed in, and keeps account data out of caches', async () => {
    const u = await signIn({ name: 'Ana' });
    const r = await api('/api/me', { cookie: u.cookie });
    expect(r.json.user.email).toBe(u.email);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect((await api('/api/me')).json.user).toBeNull();
  });

  it('refuses state changes from another origin', async () => {
    const u = await signIn();
    const r = await api('/api/me', { method: 'PATCH', body: { name: 'Otra' }, cookie: u.cookie, origin: 'https://evil.test' });
    expect(r.status).toBe(403);
  });
});
