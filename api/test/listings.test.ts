import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetCatalogVersion } from '../src/cache';
import { api, signIn } from './helpers';

// Shelter listings (PAT-8): members create and edit; only verified shelters publish; adopters see it at once.

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const listing = (over: Record<string, unknown> = {}) => ({
  species: 'perro',
  name: 'Canela',
  sex: 'hembra',
  birthDate: daysAgo(400),
  birthDateEstimated: true,
  size: 'mediano',
  energy: 'media',
  goodWith: { kids: true, dogs: null, cats: false },
  health: { vaccinated: true, sterilized: false, dewormed: true },
  story: 'La encontramos en el malecón; es cariñosa y le encanta pasear.',
  needs: ['Patio', '  '],
  adoptionFeeDop: 1500,
  ...over,
});

async function shelter(status: 'pending' | 'verified' | 'suspended' = 'verified') {
  const owner = await signIn();
  const id = `sh-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status) VALUES (?, ?, 'Refugio Prueba', 'gazcue-distrito-nacional', ?)").bind(id, id, status).run();
  await env.DB.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'owner')").bind(id, owner.id).run();
  return { id, owner };
}

const create = (shelterId: string, cookie: string, body: Record<string, unknown>) => api(`/api/portal/shelters/${shelterId}/pets`, { method: 'POST', body, cookie });
const save = (petId: string, cookie: string, body: Record<string, unknown>) => api(`/api/portal/pets/${petId}`, { method: 'PUT', body, cookie });
const publicProfile = (petId: string) => (forgetCatalogVersion(), api(`/api/pets/${petId}`));

beforeEach(() => forgetCatalogVersion());

describe('creating a listing', () => {
  it('is for the shelter’s members only', async () => {
    const s = await shelter();
    const stranger = await signIn();
    expect((await create(s.id, '', listing())).status).toBe(401);
    expect((await create(s.id, stranger.cookie, listing())).status).toBe(404);
    expect((await api(`/api/portal/shelters/${s.id}/pets`, { cookie: stranger.cookie })).status).toBe(404);
  });

  it('checks the fields and names the first problem', async () => {
    const s = await shelter();
    const c = s.owner.cookie;
    expect((await create(s.id, c, listing({ species: 'loro' }))).json.error).toBe('invalid_species');
    expect((await create(s.id, c, listing({ name: '  ' }))).json.error).toBe('invalid_name');
    expect((await create(s.id, c, listing({ birthDate: '2026-02-30' }))).json.error).toBe('invalid_birth_date');
    expect((await create(s.id, c, listing({ birthDate: daysAgo(-3) }))).json.error).toBe('invalid_birth_date');
    expect((await create(s.id, c, listing({ size: 'enorme' }))).json.error).toBe('invalid_size');
    expect((await create(s.id, c, listing({ adoptionFeeDop: -5 }))).json.error).toBe('invalid_fee');
    expect((await create(s.id, c, listing({ adoptionFeeDop: 12.5 }))).json.error).toBe('invalid_fee');
  });

  it('saves a draft adopters can’t see, with the shelter’s place', async () => {
    const s = await shelter();
    const res = await create(s.id, s.owner.cookie, listing());
    expect(res.status).toBe(201);
    expect(res.json.pet.status).toBe('draft');
    expect((await publicProfile(res.json.pet.id)).status).toBe(404);
    const mine = await api(`/api/portal/shelters/${s.id}/pets`, { cookie: s.owner.cookie });
    expect(mine.json.pets.map((p: { id: string }) => p.id)).toEqual([res.json.pet.id]);
    const form = await api(`/api/portal/pets/${res.json.pet.id}`, { cookie: s.owner.cookie });
    expect(form.json.pet).toMatchObject({ name: 'Canela', needs: ['Patio'], goodWith: { kids: true, dogs: null, cats: false }, adoptionFeeDop: 1500 });
  });

  it('publishes at once for a verified shelter', async () => {
    const s = await shelter();
    const res = await create(s.id, s.owner.cookie, listing({ publish: true }));
    expect(res.json.pet.status).toBe('available');
    const profile = await publicProfile(res.json.pet.id);
    expect(profile.status).toBe(200);
    expect(profile.json.pet).toMatchObject({ name: 'Canela', place: { id: 'gazcue-distrito-nacional' }, lister: { type: 'shelter', name: 'Refugio Prueba' } });
  });

  it('lets maintainers list animals too', async () => {
    const s = await shelter();
    const maintainer = await signIn();
    await env.DB.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'maintainer')").bind(s.id, maintainer.id).run();
    expect((await create(s.id, maintainer.cookie, listing({ publish: true }))).status).toBe(201);
  });
});

describe('publishing rules', () => {
  it('waits for verification: pending shelters keep drafts', async () => {
    const s = await shelter('pending');
    expect((await create(s.id, s.owner.cookie, listing({ publish: true }))).json.error).toBe('shelter_not_verified');
    expect((await create(s.id, s.owner.cookie, listing())).status).toBe(201);
  });

  it('refuses animals under 8 weeks and listings without a story', async () => {
    const s = await shelter();
    expect((await create(s.id, s.owner.cookie, listing({ birthDate: daysAgo(30), publish: true }))).json.error).toBe('too_young');
    expect((await create(s.id, s.owner.cookie, listing({ story: 'Linda.', publish: true }))).json.error).toBe('story_required');
    // A young one can wait as a draft until it's old enough.
    expect((await create(s.id, s.owner.cookie, listing({ birthDate: daysAgo(30) }))).status).toBe(201);
  });

  it('keeps a published listing within the rules when it is edited', async () => {
    const s = await shelter();
    const id = (await create(s.id, s.owner.cookie, listing({ publish: true }))).json.pet.id;
    expect((await save(id, s.owner.cookie, listing({ story: '' }))).json.error).toBe('story_required');
    const ok = await save(id, s.owner.cookie, listing({ name: 'Canelita' }));
    expect(ok.json.pet.status).toBe('available');
    expect((await publicProfile(id)).json.pet.name).toBe('Canelita');
  });

  it('publishes a draft on save with publish', async () => {
    const s = await shelter();
    const id = (await create(s.id, s.owner.cookie, listing())).json.pet.id;
    expect((await save(id, s.owner.cookie, listing({ publish: true }))).json.pet.status).toBe('available');
    expect((await publicProfile(id)).status).toBe(200);
  });

  it('freezes a suspended shelter’s listings', async () => {
    const s = await shelter('suspended');
    expect((await create(s.id, s.owner.cookie, listing())).json.error).toBe('shelter_suspended');
  });

  it('never lets another shelter’s member edit', async () => {
    const a = await shelter();
    const b = await shelter();
    const id = (await create(a.id, a.owner.cookie, listing())).json.pet.id;
    expect((await save(id, b.owner.cookie, listing())).status).toBe(404);
    expect((await api(`/api/portal/pets/${id}`, { cookie: b.owner.cookie })).status).toBe(404);
  });
});
