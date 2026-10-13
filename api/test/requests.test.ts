import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetCatalogVersion } from '../src/cache';
import { api, signIn } from './helpers';

// Adoption requests (PAT-31): Mi lista's three slots are requests, withdrawals are serious.

let shelterOwner = '';
const pets: string[] = [];

beforeEach(async () => {
  forgetCatalogVersion();
  // A verified shelter with five available animals (tests run in isolated storage, so set up each time).
  const owner = await signIn();
  shelterOwner = owner.id;
  const sid = `sh-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status, verified_at) VALUES (?, ?, 'Refugio Prueba', 'gazcue-distrito-nacional', 'verified', '2026-01-01T00:00:00Z')").bind(sid, sid).run();
  pets.length = 0;
  for (let i = 0; i < 5; i++) {
    const id = `${sid}-pet${i}`;
    await env.DB.prepare(
      "INSERT INTO pets (id, listed_by, shelter_id, place_id, name, sex, size, energy, status, birth_date) VALUES (?, ?, ?, 'gazcue-distrito-nacional', ?, 'hembra', 'pequeno', 'tranquila', 'available', '2022-05-01')",
    )
      .bind(id, shelterOwner, sid, `Mascota ${i}`)
      .run();
    pets.push(id);
  }
});

const form = (petId: string) => ({ petId, answers: { space: 'si', time: 'si', cost: 'si' }, name: 'Ana Pérez', pref: 'whatsapp', phone: '809-555-1234', consent: true });
const send = (cookie: string, petId: string) => api('/api/requests', { method: 'POST', body: form(petId), cookie });
const withdraw = (cookie: string, id: string, reason?: string) => api(`/api/requests/${id}/withdraw`, { method: 'POST', body: reason ? { reason } : {}, cookie });

describe('adoption requests', () => {
  it('needs consent and a Dominican number for WhatsApp', async () => {
    const u = await signIn();
    expect((await api('/api/requests', { method: 'POST', body: { ...form(pets[0]), consent: false }, cookie: u.cookie })).json.error).toBe('consent_required');
    expect((await api('/api/requests', { method: 'POST', body: { ...form(pets[0]), phone: '555-1234' }, cookie: u.cookie })).json.error).toBe('invalid_phone');
    // Email-only adopters may leave the number out.
    expect((await api('/api/requests', { method: 'POST', body: { ...form(pets[0]), pref: 'correo', phone: '' }, cookie: u.cookie })).status).toBe(201);
  });

  it('allows three open requests, and a fourth once one is withdrawn', async () => {
    const u = await signIn();
    for (const p of pets.slice(0, 3)) expect((await send(u.cookie, p)).status).toBe(201);
    expect((await send(u.cookie, pets[3])).json.error).toBe('requests_full');
    const first = (await api('/api/requests', { cookie: u.cookie })).json.items[0].request.id;
    expect((await withdraw(u.cookie, first, 'situacion')).status).toBe(200);
    expect((await send(u.cookie, pets[3])).status).toBe(201);
  });

  it('needs a reason to withdraw, and the lister keeps a record of it', async () => {
    const u = await signIn();
    const id = (await send(u.cookie, pets[0])).json.request.id;
    expect((await withdraw(u.cookie, id)).json.error).toBe('reason_required');
    await withdraw(u.cookie, id, 'vivienda');
    const row = await env.DB.prepare('SELECT status, closed_reason FROM adoption_requests WHERE id = ?').bind(id).first();
    expect(row).toEqual({ status: 'withdrawn', closed_reason: 'vivienda' });
  });

  it('pauses new requests after three withdrawals, until an admin clears the account', async () => {
    const u = await signIn();
    for (const p of pets.slice(0, 3)) {
      const id = (await send(u.cookie, p)).json.request.id;
      await withdraw(u.cookie, id, 'otro');
    }
    expect((await api('/api/me', { cookie: u.cookie })).json.user.requestsRestricted).toBe(true);
    expect((await send(u.cookie, pets[3])).json.error).toBe('restricted');
    await env.DB.prepare("UPDATE users SET requests_cleared_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+1 second') WHERE id = ?").bind(u.id).run();
    expect((await api('/api/me', { cookie: u.cookie })).json.user.requestsRestricted).toBe(false);
  });

  it('refuses requests for a pet en proceso, but its profile still shows', async () => {
    const u = await signIn();
    await env.DB.prepare("UPDATE pets SET status = 'reserved' WHERE id = ?").bind(pets[0]).run();
    forgetCatalogVersion();
    expect((await send(u.cookie, pets[0])).json.error).toBe('reserved');
    expect((await api(`/api/pets/${pets[0]}`)).json.pet.requests).toBe('reserved');
  });
});
