import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetCatalogVersion } from '../src/cache';
import { runDigest } from '../src/digest';
import { trimAdoptedPhotos } from '../src/lifecycle';
import { addPhoto, api, signIn } from './helpers';

// How an animal's time on Patiamor ends (PAT-11): adopted, withdrawn, relisted; what adopters see; and
// the photo trim 90 days after an adoption.

const form = (petId: string) => ({ petId, answers: { space: 'si', time: 'si', cost: 'si' }, name: 'Ana Pérez', pref: 'whatsapp', phone: '809-555-1234', consent: true });

async function setup() {
  const owner = await signIn();
  const sid = `sh-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status, verified_at) VALUES (?, ?, 'Refugio Final', 'gazcue-distrito-nacional', 'verified', '2026-01-01T00:00:00Z')").bind(sid, sid).run();
  await env.DB.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'owner')").bind(sid, owner.id).run();
  const pet = `${sid}-luna`;
  await env.DB.prepare(
    "INSERT INTO pets (id, listed_by, shelter_id, place_id, name, sex, size, energy, status, birth_date, story, published_at) VALUES (?, ?, ?, 'gazcue-distrito-nacional', 'Luna', 'hembra', 'mediano', 'media', 'available', '2022-01-01', 'Luna es tranquila y cariñosa con todos.', '2026-01-01T00:00:00Z')",
  )
    .bind(pet, owner.id, sid)
    .run();
  return { owner, sid, pet };
}

const send = async (petId: string) => {
  const adopter = await signIn();
  const res = await api('/api/requests', { method: 'POST', cookie: adopter.cookie, body: form(petId) });
  return { adopter, id: res.json.request.id as string };
};
const post = (path: string, cookie: string, body: Record<string, unknown> = {}) => api(`/api/portal/pets/${path}`, { method: 'POST', cookie, body });
const statusOf = async (id: string) => (await env.DB.prepare('SELECT status, closed_reason FROM adoption_requests WHERE id = ?').bind(id).first<{ status: string; closed_reason: string | null }>())!;
const inSearch = async (petId: string) => {
  forgetCatalogVersion();
  return (await api('/api/pets?lat=18.47&lng=-69.90')).json.pets.some((p: { id: string }) => p.id === petId);
};
const myList = async (cookie: string) => (await api('/api/requests', { cookie })).json.items as { pet: { status: string }; request: { status: string } }[];

beforeEach(() => forgetCatalogVersion());

describe('se fue a casa', () => {
  it('with one family: their request is the adoption, the others close and free their slots', async () => {
    const { owner, pet } = await setup();
    const chosen = await send(pet);
    const other = await send(pet);
    const res = await post(`${pet}/adopted`, owner.cookie, { requestId: chosen.id });
    expect(res.json).toMatchObject({ pet: { status: 'adopted' }, closed: 1 });
    expect(await statusOf(chosen.id)).toMatchObject({ status: 'adopted' });
    expect(await statusOf(other.id)).toEqual({ status: 'closed', closed_reason: 'adoptado' });
    const row = await env.DB.prepare('SELECT adopted_request_id, adopted_at, open_requests FROM pets WHERE id = ?').bind(pet).first<{ adopted_request_id: string; adopted_at: string; open_requests: number }>();
    expect(row).toMatchObject({ adopted_request_id: chosen.id, open_requests: 0 });
    expect(row!.adopted_at).toBeTruthy();
    // Mi lista shows how it ended, for both families.
    expect((await myList(chosen.adopter.cookie))[0]).toMatchObject({ pet: { status: 'adopted' }, request: { status: 'adopted' } });
    expect((await myList(other.adopter.cookie))[0]).toMatchObject({ pet: { status: 'adopted' }, request: { status: 'closed' } });
  });

  it('with a family from outside Patiamor: every open request closes', async () => {
    const { owner, pet } = await setup();
    const a = await send(pet);
    expect((await post(`${pet}/adopted`, owner.cookie)).json.closed).toBe(1);
    expect((await statusOf(a.id)).status).toBe('closed');
    expect((await env.DB.prepare('SELECT adopted_request_id FROM pets WHERE id = ?').bind(pet).first<{ adopted_request_id: string | null }>())!.adopted_request_id).toBeNull();
  });

  it('leaves search at once; old links say it found a home', async () => {
    const { owner, pet } = await setup();
    expect(await inSearch(pet)).toBe(true);
    await post(`${pet}/adopted`, owner.cookie);
    expect(await inSearch(pet)).toBe(false);
    const profile = await api(`/api/pets/${pet}`);
    expect(profile.status).toBe(410);
    expect(profile.json).toMatchObject({ error: 'gone', pet: { id: pet, name: 'Luna', status: 'adopted' } });
    expect(profile.json.pet.story).toBeUndefined();
  });

  it('only for a request of this animal, and only once', async () => {
    const { owner, pet } = await setup();
    const elsewhere = await setup();
    const theirs = await send(elsewhere.pet);
    expect((await post(`${pet}/adopted`, owner.cookie, { requestId: theirs.id })).json.error).toBe('invalid_request');
    await post(`${pet}/adopted`, owner.cookie);
    expect((await post(`${pet}/adopted`, owner.cookie)).json.error).toBe('invalid_transition');
  });

  it('is for the shelter’s members only', async () => {
    const { pet } = await setup();
    const stranger = await signIn();
    expect((await post(`${pet}/adopted`, stranger.cookie)).status).toBe(404);
    expect((await post(`${pet}/withdraw`, stranger.cookie, { reason: 'otro' })).status).toBe(404);
    expect((await post(`${pet}/relist`, stranger.cookie)).status).toBe(404);
  });

  it('a draft can’t be adopted or withdrawn', async () => {
    const { owner, pet } = await setup();
    await env.DB.prepare("UPDATE pets SET status = 'draft' WHERE id = ?").bind(pet).run();
    expect((await post(`${pet}/adopted`, owner.cookie)).json.error).toBe('invalid_transition');
    expect((await post(`${pet}/withdraw`, owner.cookie, { reason: 'otro' })).json.error).toBe('invalid_transition');
  });
});

describe('retirar', () => {
  it('needs a reason, closes requests, and old links say it’s no longer available', async () => {
    const { owner, pet } = await setup();
    const a = await send(pet);
    expect((await post(`${pet}/withdraw`, owner.cookie)).json.error).toBe('reason_required');
    expect((await post(`${pet}/withdraw`, owner.cookie, { reason: 'familia_original' })).json).toMatchObject({ pet: { status: 'withdrawn' }, closed: 1 });
    expect(await statusOf(a.id)).toEqual({ status: 'closed', closed_reason: 'retirado' });
    expect(await inSearch(pet)).toBe(false);
    expect((await api(`/api/pets/${pet}`)).json).toMatchObject({ error: 'gone', pet: { status: 'withdrawn' } });
  });
});

describe('volver a publicar', () => {
  it('undoes an adoption: the family’s request ends as “devuelto” and the animal is back in search', async () => {
    const { owner, pet } = await setup();
    await addPhoto(pet, owner.cookie);
    const chosen = await send(pet);
    await post(`${pet}/adopted`, owner.cookie, { requestId: chosen.id });
    expect((await post(`${pet}/relist`, owner.cookie)).json.pet.status).toBe('available');
    expect(await statusOf(chosen.id)).toEqual({ status: 'closed', closed_reason: 'devuelto' });
    expect(await inSearch(pet)).toBe(true);
    const row = await env.DB.prepare('SELECT adopted_at, adopted_request_id FROM pets WHERE id = ?').bind(pet).first();
    expect(row).toEqual({ adopted_at: null, adopted_request_id: null });
    // The family can ask again; their old request no longer blocks it.
    expect((await api('/api/requests', { method: 'POST', cookie: chosen.adopter.cookie, body: form(pet) })).status).toBe(201);
  });

  it('follows the publishing rules', async () => {
    const { owner, pet } = await setup(); // no photo
    await post(`${pet}/withdraw`, owner.cookie, { reason: 'salud' });
    expect((await post(`${pet}/relist`, owner.cookie)).json.error).toBe('photo_required');
    expect((await post(`${pet}/relist`, owner.cookie)).status).toBe(409);
  });

  it('tells people waiting with “Avísame” the next morning', async () => {
    const { owner, pet } = await setup();
    await addPhoto(pet, owner.cookie);
    await env.DB.prepare("UPDATE pets SET status = 'reserved' WHERE id = ?").bind(pet).run();
    const waiting = await signIn();
    await api(`/api/alerts/${pet}`, { method: 'PUT', cookie: waiting.cookie, body: {} });
    await env.DB.prepare("UPDATE availability_alerts SET created_at = '2026-01-01T00:00:00Z' WHERE user_id = ?").bind(waiting.id).run();
    await post(`${pet}/withdraw`, owner.cookie, { reason: 'salud' });
    await post(`${pet}/relist`, owner.cookie);
    await env.DB.prepare('DELETE FROM email_log').run();
    const res = await runDigest(env, 'https://example.test');
    expect(res.alertEmails).toBeGreaterThanOrEqual(1);
    expect(await env.DB.prepare('SELECT 1 FROM availability_alerts WHERE user_id = ?').bind(waiting.id).first()).toBeNull();
  });
});

describe('photos after an adoption', () => {
  it('keep only the main one after 90 days, in the database and in R2', async () => {
    const { owner, pet } = await setup();
    for (let i = 0; i < 3; i++) expect((await addPhoto(pet, owner.cookie)).status).toBe(201);
    const recent = await setup();
    for (let i = 0; i < 2; i++) await addPhoto(recent.pet, recent.owner.cookie);
    await post(`${pet}/adopted`, owner.cookie);
    await post(`${recent.pet}/adopted`, recent.owner.cookie);
    await env.DB.prepare("UPDATE pets SET adopted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-91 days') WHERE id = ?").bind(pet).run();
    const before = await env.DB.prepare('SELECT r2_key, thumb_key, position FROM pet_photos WHERE pet_id = ? ORDER BY position').bind(pet).all<{ r2_key: string; thumb_key: string; position: number }>();

    const res = await trimAdoptedPhotos(env);
    expect(res.photos).toBeGreaterThanOrEqual(2);
    const after = await env.DB.prepare('SELECT r2_key FROM pet_photos WHERE pet_id = ?').bind(pet).all<{ r2_key: string }>();
    expect(after.results.map((r) => r.r2_key)).toEqual([before.results[0].r2_key]);
    expect(await env.PHOTOS.head(before.results[0].r2_key)).not.toBeNull();
    for (const p of before.results.slice(1)) {
      expect(await env.PHOTOS.head(p.r2_key)).toBeNull();
      expect(await env.PHOTOS.head(p.thumb_key)).toBeNull();
    }
    // Adopted last week: untouched.
    expect((await env.DB.prepare('SELECT count(*) AS n FROM pet_photos WHERE pet_id = ?').bind(recent.pet).first<{ n: number }>())!.n).toBe(2);
  });
});
