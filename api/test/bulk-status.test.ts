import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetCatalogVersion } from '../src/cache';
import { api, signIn } from './helpers';

// Changing several of a shelter's animals at once (PAT-33): en proceso / disponible, se fueron a casa,
// retirar and health, with the same rules as one at a time.

const form = (petId: string) => ({ petId, answers: { space: 'si', time: 'si', cost: 'si' }, name: 'Ana Pérez', pref: 'whatsapp', phone: '809-555-1234', consent: true });

async function setup(names = ['Uno', 'Dos', 'Tres'], status = 'available') {
  const owner = await signIn();
  const sid = `sh-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status, verified_at) VALUES (?, ?, 'Refugio Lote', 'gazcue-distrito-nacional', 'verified', '2026-01-01T00:00:00Z')").bind(sid, sid).run();
  await env.DB.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'owner')").bind(sid, owner.id).run();
  const pets: string[] = [];
  for (const name of names) {
    const id = `${sid}-${name}`;
    await env.DB.prepare(
      "INSERT INTO pets (id, listed_by, shelter_id, place_id, name, sex, size, energy, status, birth_date, story, published_at) VALUES (?, ?, ?, 'gazcue-distrito-nacional', ?, 'macho', 'mediano', 'media', ?, '2022-01-01', 'Un perro tranquilo y cariñoso con todos.', '2026-01-01T00:00:00Z')",
    )
      .bind(id, owner.id, sid, name, status)
      .run();
    pets.push(id);
  }
  return { owner, sid, pets };
}

const bulk = (sid: string, cookie: string, body: Record<string, unknown>) => api(`/api/portal/shelters/${sid}/pets/bulk`, { method: 'POST', cookie, body });
const statuses = async (ids: string[]) => {
  const { results } = await env.DB.prepare('SELECT id, status FROM pets WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all<{ id: string; status: string }>();
  return Object.fromEntries(results.map((r) => [r.id, r.status]));
};

beforeEach(() => forgetCatalogVersion());

describe('changing several animals at once', () => {
  it('is for the shelter’s members, and only touches its own animals', async () => {
    const { sid, pets } = await setup();
    const other = await setup(['Ajeno']);
    const stranger = await signIn();
    expect((await bulk(sid, stranger.cookie, { ids: pets, action: 'reserved' })).status).toBe(404);

    const mine = await bulk(other.sid, other.owner.cookie, { ids: [...other.pets, pets[0]], action: 'reserved' });
    expect(mine.json.changed).toEqual(other.pets);
    expect(mine.json.skipped).toEqual([{ id: pets[0], why: 'not_found' }]);
    expect((await statuses([pets[0]]))[pets[0]]).toBe('available');
  });

  it('checks what it’s asked', async () => {
    const { owner, sid, pets } = await setup();
    expect((await bulk(sid, owner.cookie, { ids: pets, action: 'vender' })).json.error).toBe('invalid_action');
    expect((await bulk(sid, owner.cookie, { ids: [], action: 'reserved' })).json.error).toBe('invalid_ids');
    expect((await bulk(sid, owner.cookie, { ids: Array.from({ length: 101 }, (_, i) => `x${i}`), action: 'reserved' })).json.error).toBe('invalid_ids');
    expect((await bulk(sid, owner.cookie, { ids: pets, action: 'withdrawn' })).json.error).toBe('reason_required');
    expect((await bulk(sid, owner.cookie, { ids: pets, action: 'health', health: { vaccinated: false } })).json.error).toBe('invalid_health');
  });

  it('puts them en proceso and back, skipping those already so', async () => {
    const { owner, sid, pets } = await setup();
    await bulk(sid, owner.cookie, { ids: [pets[0]], action: 'reserved' });
    const res = await bulk(sid, owner.cookie, { ids: pets, action: 'reserved' });
    expect(res.json.changed.sort()).toEqual([pets[1], pets[2]].sort());
    expect(res.json.skipped).toEqual([{ id: pets[0], why: 'already' }]);
    expect(new Set(Object.values(await statuses(pets)))).toEqual(new Set(['reserved']));
    await bulk(sid, owner.cookie, { ids: pets, action: 'available' });
    expect(new Set(Object.values(await statuses(pets)))).toEqual(new Set(['available']));
  });

  it('marks them adopted, except one with requests: that one is done one at a time to pick the family', async () => {
    const { owner, sid, pets } = await setup();
    const adopter = await signIn();
    await api('/api/requests', { method: 'POST', cookie: adopter.cookie, body: form(pets[1]) });
    const res = await bulk(sid, owner.cookie, { ids: pets, action: 'adopted' });
    expect(res.json.changed.sort()).toEqual([pets[0], pets[2]].sort());
    expect(res.json.skipped).toEqual([{ id: pets[1], why: 'has_requests' }]);
    const now = await statuses(pets);
    expect([now[pets[0]], now[pets[1]], now[pets[2]]]).toEqual(['adopted', 'available', 'adopted']);
    // Adopted animals can't be put en proceso.
    expect((await bulk(sid, owner.cookie, { ids: [pets[0]], action: 'reserved' })).json.skipped).toEqual([{ id: pets[0], why: 'not_live' }]);
  });

  it('withdraws them with one reason, closing their requests so those adopters’ slots free up', async () => {
    const { owner, sid, pets } = await setup();
    const adopter = await signIn();
    const sent = await api('/api/requests', { method: 'POST', cookie: adopter.cookie, body: form(pets[0]) });
    const res = await bulk(sid, owner.cookie, { ids: pets, action: 'withdrawn', reason: 'salud' });
    expect(res.json.changed).toHaveLength(3);
    expect(res.json.closed).toBe(1);
    const req = await env.DB.prepare('SELECT status, closed_reason FROM adoption_requests WHERE id = ?').bind(sent.json.request.id).first<{ status: string; closed_reason: string }>();
    expect(req).toEqual({ status: 'closed', closed_reason: 'retirado' });
    const row = await env.DB.prepare('SELECT withdrawn_reason FROM pets WHERE id = ?').bind(pets[2]).first<{ withdrawn_reason: string }>();
    expect(row!.withdrawn_reason).toBe('salud');
    // They leave the catalogue.
    const seen = (await api('/api/pets?lat=18.47&lng=-69.90')).json.pets as { id: string }[];
    expect(seen.some((p) => pets.includes(p.id))).toBe(false);
  });

  it('marks health done on drafts and live animals alike, leaving the rest as it was', async () => {
    const { owner, sid, pets } = await setup(['Cinco', 'Seis'], 'draft');
    await env.DB.prepare('UPDATE pets SET dewormed = 1 WHERE id = ?').bind(pets[1]).run();
    const res = await bulk(sid, owner.cookie, { ids: pets, action: 'health', health: { vaccinated: true, sterilized: true } });
    expect(res.json.changed).toHaveLength(2);
    const { results } = await env.DB.prepare('SELECT vaccinated, sterilized, dewormed FROM pets WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id').bind(JSON.stringify(pets)).all();
    expect(results).toEqual([
      { vaccinated: 1, sterilized: 1, dewormed: 0 },
      { vaccinated: 1, sterilized: 1, dewormed: 1 },
    ]);
  });

  it('refuses a suspended shelter', async () => {
    const { owner, sid, pets } = await setup();
    await env.DB.prepare("UPDATE shelters SET status = 'suspended' WHERE id = ?").bind(sid).run();
    expect((await bulk(sid, owner.cookie, { ids: pets, action: 'reserved' })).status).toBe(409);
  });
});
