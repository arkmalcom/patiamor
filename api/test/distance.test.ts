import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetCatalogVersion } from '../src/cache';
import { api, signIn } from './helpers';

// Adopters far from the animal (while shelters are few): beyond 50 km the form asks whether they can
// travel, and the shelter sees the distance and the answer.

const PUNTA_CANA = 'punta-cana-la-altagracia'; // about 160 km from the shelter below
const GAZCUE = 'gazcue-distrito-nacional';

async function setup() {
  const owner = await signIn();
  const sid = `sh-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status, verified_at) VALUES (?, ?, 'Refugio Lejano', ?, 'verified', '2026-01-01T00:00:00Z')").bind(sid, sid, GAZCUE).run();
  await env.DB.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'owner')").bind(sid, owner.id).run();
  const pet = `${sid}-luna`;
  await env.DB.prepare("INSERT INTO pets (id, listed_by, shelter_id, place_id, name, sex, size, energy, status, birth_date) VALUES (?, ?, ?, ?, 'Luna', 'hembra', 'mediano', 'media', 'available', '2022-01-01')")
    .bind(pet, owner.id, sid, GAZCUE)
    .run();
  return { pet, sid, owner };
}

const form = (petId: string, extra: Record<string, unknown> = {}) => ({
  petId, answers: { space: 'si', time: 'si', cost: 'si' }, name: 'Ana Pérez', pref: 'whatsapp', phone: '809-555-1234', consent: true, ...extra,
});
const ask = (cookie: string, body: Record<string, unknown>) => api('/api/requests', { method: 'POST', cookie, body });

beforeEach(() => forgetCatalogVersion());

describe('adopters far from the animal', () => {
  it('must say whether they can travel, and the shelter sees how far and what they said', async () => {
    const { pet, sid, owner } = await setup();
    const adopter = await signIn();
    expect((await ask(adopter.cookie, form(pet, { fromPlaceId: PUNTA_CANA }))).json.error).toBe('travel_required');
    expect((await ask(adopter.cookie, form(pet, { fromPlaceId: PUNTA_CANA, travel: 'quizas' }))).json.error).toBe('invalid_request');
    expect((await ask(adopter.cookie, form(pet, { fromPlaceId: PUNTA_CANA, travel: 'pensando' }))).status).toBe(201);
    const row = (await api(`/api/portal/shelters/${sid}/requests`, { cookie: owner.cookie })).json.requests[0];
    expect(row.about.travel).toBe('pensando');
    expect(row.about.distanceKm).toBeGreaterThan(150);
    expect(row.about.distanceKm % 5).toBe(0); // rounded, never a precise position
  });

  it('asks nothing of someone nearby, and a made-up place just means no distance', async () => {
    const { pet, sid, owner } = await setup();
    const near = await signIn();
    expect((await ask(near.cookie, form(pet, { fromPlaceId: GAZCUE, travel: 'si' }))).status).toBe(201);
    const other = await signIn();
    expect((await ask(other.cookie, form(pet, { fromPlaceId: 'nowhere' }))).status).toBe(201);
    const rows = (await api(`/api/portal/shelters/${sid}/requests`, { cookie: owner.cookie })).json.requests as { about: { travel: string | null; distanceKm: number | null } }[];
    const distances = rows.map((r) => r.about.distanceKm).sort();
    expect(distances).toEqual([0, null]);
    expect(rows.every((r) => r.about.travel === null)).toBe(true); // not asked, so not kept
  });
});
