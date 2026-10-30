import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetCatalogVersion } from '../src/cache';
import { runDigest } from '../src/digest';
import { api, ORIGIN, signIn } from './helpers';

// Fostering: an offer to be a foster home for a shelter's animal, for a chosen length. It is a request like
// any other (the same slots and inbox), stays open while the animal lives with them, and tags the animal
// "En hogar temporal" without taking it off the list.

const form = (petId: string, over: Record<string, unknown> = {}) => ({
  petId, answers: { space: 'si', time: 'si', cost: 'si' }, name: 'Ana Pérez', pref: 'whatsapp', phone: '809-555-1234', consent: true,
  kind: 'foster', fosterLength: 'un_mes', ...over,
});

async function setup(kind: 'shelter' | 'private' = 'shelter', count = 1) {
  const owner = await signIn();
  const sid = `sh-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status, verified_at, kind) VALUES (?, ?, 'Refugio Temporal', 'gazcue-distrito-nacional', 'verified', '2026-01-01T00:00:00Z', ?)").bind(sid, sid, kind).run();
  await env.DB.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'owner')").bind(sid, owner.id).run();
  const pets: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `${sid}-${i}`;
    await env.DB.prepare("INSERT INTO pets (id, listed_by, shelter_id, place_id, name, sex, size, energy, status, birth_date) VALUES (?, ?, ?, 'gazcue-distrito-nacional', ?, 'hembra', 'mediano', 'media', 'available', '2022-01-01')")
      .bind(id, owner.id, sid, `Luna${i}`)
      .run();
    pets.push(id);
  }
  return { owner, sid, pets };
}

const offer = (cookie: string, petId: string, over: Record<string, unknown> = {}) => api('/api/requests', { method: 'POST', cookie, body: form(petId, over) });
const move = (id: string, cookie: string, body: Record<string, unknown>) => api(`/api/portal/requests/${id}/status`, { method: 'POST', cookie, body });
const fostered = async (petId: string) => (await env.DB.prepare('SELECT fostered FROM pets WHERE id = ?').bind(petId).first<{ fostered: number }>())!.fostered;
const mine = async (cookie: string) => (await api('/api/requests', { cookie })).json.items as { request: { id: string; status: string; kind: string; fosterLength: string | null } }[];

beforeEach(async () => {
  forgetCatalogVersion();
  await env.DB.prepare('DELETE FROM email_log').run();
  await env.DB.prepare("UPDATE adoption_requests SET closed_notified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE closed_notified_at IS NULL").run();
});

describe('foster offers', () => {
  it('are sent with a length, and the adopter and the shelter both see it', async () => {
    const { owner, sid, pets } = await setup();
    const adopter = await signIn();
    const res = await offer(adopter.cookie, pets[0], { fosterLength: 'dos_tres_meses' });
    expect(res.status).toBe(201);
    expect((await mine(adopter.cookie))[0].request).toMatchObject({ status: 'sent', kind: 'foster', fosterLength: 'dos_tres_meses' });
    const inbox = await api(`/api/portal/shelters/${sid}/requests`, { cookie: owner.cookie });
    expect(inbox.json.requests[0]).toMatchObject({ kind: 'foster', fosterLength: 'dos_tres_meses', status: 'sent' });
  });

  it('need a known length, and adoptions take none', async () => {
    const { pets } = await setup();
    const adopter = await signIn();
    expect((await offer(adopter.cookie, pets[0], { fosterLength: undefined })).status).toBe(400);
    expect((await offer(adopter.cookie, pets[0], { fosterLength: 'un_año' })).status).toBe(400);
    expect((await offer(adopter.cookie, pets[0], { kind: 'adopt' })).status).toBe(400);
    expect((await offer(adopter.cookie, pets[0], { kind: 'otro' })).status).toBe(400);
    // Without a kind it's an adoption, as before.
    const adoption = await offer(adopter.cookie, pets[0], { kind: undefined, fosterLength: undefined });
    expect(adoption.status).toBe(201);
    expect((await mine(adopter.cookie))[0].request).toMatchObject({ kind: 'adopt', fosterLength: null });
  });

  it('are only for shelters, not private listers', async () => {
    const { pets } = await setup('private');
    const adopter = await signIn();
    const res = await offer(adopter.cookie, pets[0]);
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('foster_unavailable');
  });

  it('use one of the same three slots as adoptions', async () => {
    const { pets } = await setup('shelter', 4);
    const adopter = await signIn();
    expect((await offer(adopter.cookie, pets[0])).status).toBe(201);
    expect((await offer(adopter.cookie, pets[1], { kind: 'adopt', fosterLength: undefined })).status).toBe(201);
    expect((await offer(adopter.cookie, pets[2])).status).toBe(201);
    const fourth = await offer(adopter.cookie, pets[3]);
    expect(fourth.status).toBe(409);
    expect(fourth.json.error).toBe('requests_full');
  });
});

describe('a foster in progress', () => {
  it('tags the animal, keeps it listed for adoption, and keeps the slot until the shelter ends it', async () => {
    const { owner, pets } = await setup();
    const foster = await signIn();
    const { json } = await offer(foster.cookie, pets[0]);
    const id = json.request.id as string;
    expect((await move(id, owner.cookie, { status: 'contacted' })).json.request.status).toBe('contacted');
    const started = await move(id, owner.cookie, { status: 'fostering' });
    expect(started.json.request).toMatchObject({ status: 'fostering', fosterStartedAt: expect.any(String) });
    expect(await fostered(pets[0])).toBe(1);
    expect((await mine(foster.cookie))[0].request.status).toBe('fostering');

    // Still on the list and its profile, tagged, and other families can still ask to adopt it.
    const profile = await api(`/api/pets/${pets[0]}`);
    expect(profile.json.pet).toMatchObject({ fostered: true, requests: 'open' });
    const family = await signIn();
    expect((await offer(family.cookie, pets[0], { kind: 'adopt', fosterLength: undefined })).status).toBe(201);
    // But not a second foster home.
    const second = await offer((await signIn()).cookie, pets[0]);
    expect(second.json.error).toBe('fostered');

    // Only closing moves it on; the foster can't withdraw it from the app.
    expect((await move(id, owner.cookie, { status: 'visit' })).status).toBe(409);
    expect((await api(`/api/requests/${id}/withdraw`, { method: 'POST', cookie: foster.cookie, body: { reason: 'situacion' } })).status).toBe(409);
    expect((await move(id, owner.cookie, { status: 'closed', reason: 'otra_familia' })).status).toBe(400);

    const ended = await move(id, owner.cookie, { status: 'closed', reason: 'acogida_terminada' });
    expect(ended.json.request).toMatchObject({ status: 'closed', closedReason: 'acogida_terminada' });
    expect(await fostered(pets[0])).toBe(0);
    expect((await api(`/api/pets/${pets[0]}`)).json.pet.fostered).toBe(false);
  });

  it('only starts for foster offers, one foster home at a time', async () => {
    const { owner, pets } = await setup();
    const adoption = await offer((await signIn()).cookie, pets[0], { kind: 'adopt', fosterLength: undefined });
    expect((await move(adoption.json.request.id, owner.cookie, { status: 'fostering' })).status).toBe(409);
    const a = await offer((await signIn()).cookie, pets[0]);
    const b = await offer((await signIn()).cookie, pets[0]);
    expect((await move(a.json.request.id, owner.cookie, { status: 'fostering' })).status).toBe(200);
    const clash = await move(b.json.request.id, owner.cookie, { status: 'fostering' });
    expect(clash.status).toBe(409);
    expect(clash.json.error).toBe('already_fostered');
  });

  it('ends when the foster home adopts the animal', async () => {
    const { owner, pets } = await setup();
    const foster = await signIn();
    const { json } = await offer(foster.cookie, pets[0]);
    await move(json.request.id, owner.cookie, { status: 'fostering' });
    const res = await api(`/api/portal/pets/${pets[0]}/adopted`, { method: 'POST', cookie: owner.cookie, body: { requestId: json.request.id } });
    expect(res.status).toBe(200);
    expect((await mine(foster.cookie))[0].request.status).toBe('adopted');
    expect(await fostered(pets[0])).toBe(0);
  });

  it('sends no "ended without a home" email when it ends', async () => {
    const { owner, pets } = await setup();
    const foster = await signIn();
    const { json } = await offer(foster.cookie, pets[0]);
    await move(json.request.id, owner.cookie, { status: 'fostering' });
    await move(json.request.id, owner.cookie, { status: 'closed', reason: 'acogida_terminada' });
    expect((await runDigest(env, ORIGIN)).closedEmails).toBe(0);
  });
});
