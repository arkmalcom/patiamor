import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetCatalogVersion } from '../src/cache';
import { api, signIn } from './helpers';

// Abuse limits: a flood must stop long before it spends the free plan's daily D1 writes (which would take
// the whole site down until midnight UTC), and an unverified account can't fill the database.

const application = (over: Record<string, unknown> = {}) => ({
  name: 'Huellitas del Sur',
  placeId: 'gazcue-distrito-nacional',
  contactName: 'María Rodríguez',
  contactPhone: '809-555-0101',
  publicPhone: '809-555-0100',
  address: 'Calle Las Flores 12, Gazcue',
  history: 'Llevamos cinco años rescatando, con unos 40 animales al año y hogares temporales.',
  reference: { name: 'Clínica Vet Centro', contact: '809-555-0202', kind: 'veterinaria' },
  rules: true,
  ...over,
});
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const pet = { species: 'perro', name: 'Canela', sex: 'hembra', birthDate: daysAgo(400), birthDateEstimated: true, size: 'mediano', energy: 'media' };

beforeEach(async () => {
  forgetCatalogVersion();
  // Other tests leave pending shelters behind; the queue limit test needs a known count.
  await env.DB.prepare("UPDATE shelters SET status = 'rejected' WHERE status = 'pending'").run();
});

describe('write rate limit', () => {
  it('stops one account after a burst of writes, without affecting others', async () => {
    const flooder = await signIn();
    const codes: number[] = [];
    for (let i = 0; i < 35; i++) codes.push((await api('/api/me', { method: 'PATCH', cookie: flooder.cookie, body: { name: `Nombre ${i}` } })).status);
    expect(codes.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(codes.at(-1)).toBe(429);
    const other = await signIn();
    expect((await api('/api/me', { method: 'PATCH', cookie: other.cookie, body: { name: 'Otra Persona' } })).status).toBe(200);
  });

  it('never limits reading', async () => {
    const reader = await signIn();
    for (let i = 0; i < 40; i++) await api('/api/me', { cookie: reader.cookie });
    expect((await api('/api/me', { cookie: reader.cookie })).status).toBe(200);
  });
});

describe('shelter registration', () => {
  it('two a day per account', async () => {
    const u = await signIn({ owner: true });
    expect((await api('/api/portal/shelters', { method: 'POST', cookie: u.cookie, body: application() })).status).toBe(201);
    expect((await api('/api/portal/shelters', { method: 'POST', cookie: u.cookie, body: application() })).status).toBe(201);
    expect((await api('/api/portal/shelters', { method: 'POST', cookie: u.cookie, body: application() })).json.error).toBe('too_many_today');
  });

  it('waits when the review queue is full', async () => {
    for (let i = 0; i < 30; i++) {
      const id = `queue-${i}-${crypto.randomUUID().slice(0, 6)}`;
      await env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status) VALUES (?, ?, 'En cola', 'gazcue-distrito-nacional', 'pending')").bind(id, id).run();
    }
    const u = await signIn({ owner: true });
    expect((await api('/api/portal/shelters', { method: 'POST', cookie: u.cookie, body: application() })).json.error).toBe('queue_full');
  });
});

describe('animals per shelter', () => {
  it('an unverified shelter keeps at most 30 drafts', async () => {
    const owner = await signIn();
    const sid = `sh-${crypto.randomUUID().slice(0, 8)}`;
    await env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status) VALUES (?, ?, 'Nuevo', 'gazcue-distrito-nacional', 'pending')").bind(sid, sid).run();
    await env.DB.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'owner')").bind(sid, owner.id).run();
    // Fill up directly (the API would hit the write rate limit first, which is its own guard).
    await env.DB.batch(
      Array.from({ length: 30 }, (_, i) =>
        env.DB.prepare("INSERT INTO pets (id, listed_by, shelter_id, place_id, name, sex, size, energy) VALUES (?, ?, ?, 'gazcue-distrito-nacional', 'Borrador', 'macho', 'mediano', 'media')").bind(`${sid}-${i}`, owner.id, sid),
      ),
    );
    expect((await api(`/api/portal/shelters/${sid}/pets`, { method: 'POST', cookie: owner.cookie, body: pet })).json.error).toBe('too_many_pets');
  });
});

describe('Avísame', () => {
  it('twenty at a time per person', async () => {
    const u = await signIn();
    const sid = `sh-${crypto.randomUUID().slice(0, 8)}`;
    await env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status) VALUES (?, ?, 'Refugio', 'gazcue-distrito-nacional', 'verified')").bind(sid, sid).run();
    const ids = Array.from({ length: 21 }, (_, i) => `${sid}-a${i}`);
    await env.DB.batch(
      ids.map((id) =>
        env.DB.prepare("INSERT INTO pets (id, listed_by, shelter_id, place_id, name, sex, size, energy, status, birth_date) VALUES (?, ?, ?, 'gazcue-distrito-nacional', 'Luna', 'hembra', 'mediano', 'media', 'reserved', '2022-01-01')").bind(id, u.id, sid),
      ),
    );
    await env.DB.batch(ids.slice(0, 20).map((id) => env.DB.prepare('INSERT INTO availability_alerts (user_id, pet_id) VALUES (?, ?)').bind(u.id, id)));
    expect((await api(`/api/alerts/${ids[20]}`, { method: 'PUT', cookie: u.cookie, body: {} })).json.error).toBe('too_many_alerts');
  });
});
