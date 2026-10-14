import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetCatalogVersion } from '../src/cache';
import { api, signIn } from './helpers';

// Adopters whose new requests are paused (three withdrawals in 90 days): the admin sees them with what they
// withdrew and why, and lifts the pause with a button.

const form = (petId: string) => ({ petId, answers: { space: 'si', time: 'si', cost: 'si' }, name: 'Ana Pérez', pref: 'correo', phone: '', consent: true });
const emails = async (kind: string) => (await env.DB.prepare('SELECT count(*) AS n FROM email_log WHERE kind = ?').bind(kind).first<{ n: number }>())!.n;

async function animals(n: number) {
  const owner = await signIn();
  const sid = `sh-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status, verified_at) VALUES (?, ?, 'Refugio Pausa', 'gazcue-distrito-nacional', 'verified', '2026-01-01T00:00:00Z')").bind(sid, sid).run();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = `${sid}-p${i}`;
    await env.DB.prepare("INSERT INTO pets (id, listed_by, shelter_id, place_id, name, sex, size, energy, status, birth_date) VALUES (?, ?, ?, 'gazcue-distrito-nacional', ?, 'macho', 'mediano', 'media', 'available', '2022-01-01')")
      .bind(id, owner.id, sid, `Perro${i}`)
      .run();
    ids.push(id);
  }
  return ids;
}

/** An adopter who asked for and withdrew `n` requests. */
async function withdrawer(n: number) {
  const adopter = await signIn({ name: 'Ana Retiro' });
  const pets = await animals(n);
  const reasons = ['situacion', 'vivienda', 'otra_mascota', 'otro'];
  for (let i = 0; i < n; i++) {
    const sent = await api('/api/requests', { method: 'POST', cookie: adopter.cookie, body: form(pets[i]) });
    await api(`/api/requests/${sent.json.request.id}/withdraw`, { method: 'POST', cookie: adopter.cookie, body: { reason: reasons[i % reasons.length] } });
  }
  return { adopter, pets };
}

const paused = (cookie: string) => api('/api/admin/paused', { cookie });
const clear = (cookie: string, userId: string, note?: string) => api(`/api/admin/paused/${userId}/clear`, { method: 'POST', cookie, body: { note } });

beforeEach(() => forgetCatalogVersion());

describe('adopters whose requests are paused', () => {
  it('is for admins only', async () => {
    const u = await signIn();
    expect((await paused(u.cookie)).status).toBe(404);
    expect((await clear(u.cookie, u.id)).status).toBe(404);
  });

  it('lists those paused, with what they withdrew and why, and not those who withdrew less', async () => {
    const admin = await signIn({ admin: true });
    const three = await withdrawer(3);
    const two = await withdrawer(2);
    const list = (await paused(admin.cookie)).json.paused as { id: string; who: { email: string }; withdrawals: { pet: string; shelter: string; reason: string }[]; open: number; adopted: number }[];
    const mine = list.find((p) => p.id === three.adopter.id)!;
    expect(mine.who.email).toBe(three.adopter.email);
    expect(mine.withdrawals).toHaveLength(3);
    expect(mine.withdrawals.map((w) => w.reason).sort()).toEqual(['otra_mascota', 'situacion', 'vivienda']);
    expect(mine.withdrawals[0]).toMatchObject({ shelter: 'Refugio Pausa' });
    expect(mine).toMatchObject({ open: 0, adopted: 0 });
    expect(list.some((p) => p.id === two.adopter.id)).toBe(false);
  });

  it('lifting the pause lets them ask again, is logged, emails them, and counts in the summary', async () => {
    const admin = await signIn({ admin: true });
    const { adopter } = await withdrawer(3);
    const [another] = await animals(1);
    expect((await api('/api/requests', { method: 'POST', cookie: adopter.cookie, body: form(another) })).json.error).toBe('restricted');
    expect((await api('/api/me', { cookie: adopter.cookie })).json.user.requestsRestricted).toBe(true);
    const before = (await api('/api/admin/summary', { cookie: admin.cookie })).json.paused;

    expect((await clear(admin.cookie, adopter.id, 'Hablamos y está al tanto.')).status).toBe(200);
    expect((await api('/api/me', { cookie: adopter.cookie })).json.user.requestsRestricted).toBe(false);
    expect((await api('/api/requests', { method: 'POST', cookie: adopter.cookie, body: form(another) })).status).toBe(201);
    expect(((await paused(admin.cookie)).json.paused as { id: string }[]).some((p) => p.id === adopter.id)).toBe(false);
    expect((await api('/api/admin/summary', { cookie: admin.cookie })).json.paused).toBe(before - 1);
    expect(await emails('pause_cleared')).toBeGreaterThanOrEqual(1);
    const log = await env.DB.prepare("SELECT action, subject_id, note FROM admin_actions WHERE action = 'pause.clear' ORDER BY rowid DESC LIMIT 1").first<{ action: string; subject_id: string; note: string }>();
    expect(log).toEqual({ action: 'pause.clear', subject_id: adopter.id, note: 'Hablamos y está al tanto.' });
  });

  it('only clears someone who is paused', async () => {
    const admin = await signIn({ admin: true });
    const { adopter } = await withdrawer(2);
    expect((await clear(admin.cookie, adopter.id)).json.error).toBe('not_paused');
    expect((await clear(admin.cookie, 'nadie')).status).toBe(404);
  });
});
