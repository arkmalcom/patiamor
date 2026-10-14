import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetCatalogVersion } from '../src/cache';
import { api, signIn } from './helpers';

// Special requests to adopt more than three (a farm, a large family home): an admin reads them with the
// person's other requests in mind, and the adopter hears the outcome.

const about = 'Vivimos en una finca de dos hectáreas con patio cercado; mi familia cuida animales desde hace años.';
const body = (over: Record<string, unknown> = {}) => ({ animals: 6, species: 'perros', wanted: '', about, phone: '', consent: true, ...over });
const ask = (cookie: string, over: Record<string, unknown> = {}) => api('/api/requests/bulk', { method: 'POST', cookie, body: body(over) });
const queue = (cookie: string, status = 'pending') => api(`/api/admin/bulk?status=${status}`, { cookie });
const decide = (cookie: string, id: string, action: string, note?: string) => api(`/api/admin/bulk/${id}/decision`, { method: 'POST', cookie, body: { action, note } });
const emails = async (kind: string) => (await env.DB.prepare('SELECT count(*) AS n FROM email_log WHERE kind = ?').bind(kind).first<{ n: number }>())!.n;

async function pet(ownerId: string, name = 'Luna') {
  const sid = `sh-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status, verified_at) VALUES (?, ?, 'Refugio Grande', 'gazcue-distrito-nacional', 'verified', '2026-01-01T00:00:00Z')").bind(sid, sid).run();
  const id = `${sid}-${name}`;
  await env.DB.prepare("INSERT INTO pets (id, listed_by, shelter_id, place_id, name, sex, size, energy, status, birth_date) VALUES (?, ?, ?, 'gazcue-distrito-nacional', ?, 'hembra', 'mediano', 'media', 'available', '2022-01-01')")
    .bind(id, ownerId, sid, name)
    .run();
  return id;
}

beforeEach(() => forgetCatalogVersion());

describe('sending a special request', () => {
  it('needs a signed-in person, consent, and the basics', async () => {
    expect((await api('/api/requests/bulk', { method: 'POST', body: body() })).status).toBe(401);
    const u = await signIn();
    expect((await ask(u.cookie, { consent: false })).json.error).toBe('consent_required');
    expect((await ask(u.cookie, { animals: 3 })).json.error).toBe('invalid_animals');
    expect((await ask(u.cookie, { animals: 31 })).json.error).toBe('invalid_animals');
    expect((await ask(u.cookie, { animals: 'muchos' })).json.error).toBe('invalid_animals');
    expect((await ask(u.cookie, { species: 'caballos' })).json.error).toBe('invalid_request');
    expect((await ask(u.cookie, { about: 'Tengo espacio.' })).json.error).toBe('about_too_short');
    expect((await ask(u.cookie, { phone: '555-1234' })).json.error).toBe('invalid_phone');
  });

  it('waits for an admin: one at a time, and Mi lista shows where it stands', async () => {
    const u = await signIn();
    const sent = await ask(u.cookie, { phone: '809-555-1234', wanted: 'La camada de Patitas' });
    expect(sent.status).toBe(201);
    expect(sent.json.bulk).toMatchObject({ status: 'pending', animals: 6, species: 'perros' });
    expect((await ask(u.cookie)).json.error).toBe('already_pending');
    const mine = await api('/api/requests', { cookie: u.cookie });
    expect(mine.json.bulk).toMatchObject({ id: sent.json.bulk.id, status: 'pending' });
    expect((await api('/api/requests', { cookie: (await signIn()).cookie })).json.bulk).toBeNull();
  });

  it('is limited to three a month, and not for people whose requests are paused', async () => {
    const u = await signIn();
    for (let i = 0; i < 3; i++) {
      await env.DB.prepare("INSERT INTO bulk_requests (id, user_id, animals, species, about, consent_at, status, decided_at) VALUES (?, ?, 5, 'gatos', ?, '2026-01-01T00:00:00Z', 'declined', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day'))")
        .bind(crypto.randomUUID(), u.id, about)
        .run();
    }
    expect((await ask(u.cookie)).json.error).toBe('too_many_bulk');

    const paused = await signIn();
    const owner = await signIn();
    for (let i = 0; i < 3; i++) {
      const p = await pet(owner.id, `Perro${i}`);
      const r = await api('/api/requests', { method: 'POST', cookie: paused.cookie, body: { petId: p, answers: { space: 'si', time: 'si', cost: 'si' }, name: 'Ana Pérez', pref: 'correo', phone: '', consent: true } });
      await api(`/api/requests/${r.json.request.id}/withdraw`, { method: 'POST', cookie: paused.cookie, body: { reason: 'otro' } });
    }
    expect((await ask(paused.cookie)).json.error).toBe('restricted');
  });
});

describe('the admin’s review', () => {
  it('is for admins only', async () => {
    const u = await signIn();
    expect((await queue(u.cookie)).status).toBe(404);
    expect((await decide(u.cookie, 'x', 'approve')).status).toBe(404);
  });

  it('shows the request with the person’s requests in progress, and tells the admins', async () => {
    const adopter = await signIn({ name: 'Familia Rural' });
    const owner = await signIn();
    const admin = await signIn({ admin: true });
    const luna = await pet(owner.id, 'Luna');
    await api('/api/requests', { method: 'POST', cookie: adopter.cookie, body: { petId: luna, answers: { space: 'si', time: 'si', cost: 'si' }, name: 'Familia Rural', pref: 'correo', phone: '', consent: true } });
    const sent = await ask(adopter.cookie, { animals: 8, species: 'ambos', wanted: 'Una camada' });
    expect(await emails('bulk_admin')).toBeGreaterThanOrEqual(1);
    const row = (await queue(admin.cookie)).json.requests.find((r: { id: string }) => r.id === sent.json.bulk.id);
    expect(row).toMatchObject({ animals: 8, species: 'ambos', wanted: 'Una camada', who: { name: 'Familia Rural' }, withdrawn90: 0, adopted: 0 });
    expect(row.inProgress).toEqual([{ pet: 'Luna', shelter: 'Refugio Grande', status: 'sent' }]);
  });

  it('approves, or declines with a reason; the adopter sees it, is told, and may ask again', async () => {
    const admin = await signIn({ admin: true });
    const u = await signIn();
    const first = (await ask(u.cookie)).json.bulk.id;
    expect((await decide(admin.cookie, first, 'decline')).json.error).toBe('reason_required');
    expect((await decide(admin.cookie, first, 'maybe')).json.error).toBe('invalid_action');
    expect((await decide(admin.cookie, first, 'decline', 'Primero adopta a quienes ya pediste.')).json.bulk.status).toBe('declined');
    expect((await decide(admin.cookie, first, 'approve')).json.error).toBe('invalid_transition');
    expect((await api('/api/requests', { cookie: u.cookie })).json.bulk).toMatchObject({ status: 'declined', note: 'Primero adopta a quienes ya pediste.' });
    expect(await emails('bulk_decision')).toBe(1);

    const second = (await ask(u.cookie)).json.bulk.id;
    expect((await decide(admin.cookie, second, 'approve', 'Te escribimos esta semana.')).json.bulk.status).toBe('approved');
    expect((await api('/api/requests', { cookie: u.cookie })).json.bulk).toMatchObject({ status: 'approved', note: 'Te escribimos esta semana.' });
    expect((await queue(admin.cookie, 'approved')).json.requests).toHaveLength(1);
    const log = await env.DB.prepare("SELECT action FROM admin_actions WHERE subject_type = 'bulk_request' ORDER BY rowid").all<{ action: string }>();
    expect(log.results.map((r) => r.action)).toEqual(['bulk.decline', 'bulk.approve']);
  });
});
