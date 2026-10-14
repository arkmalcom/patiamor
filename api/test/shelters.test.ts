import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetCatalogVersion } from '../src/cache';
import { api, signIn } from './helpers';

// Shelter registration and verification (PAT-13): who can do what, and what adopters can see.

const application = (over: Record<string, unknown> = {}) => ({
  name: 'Huellitas del Sur',
  placeId: 'gazcue-distrito-nacional',
  description: 'Rescatamos perros y gatos de la calle.',
  visitHours: 'Sábados 9-12',
  contactName: 'María Rodríguez',
  contactPhone: '809-555-0101',
  address: 'Calle Las Flores 12, Gazcue',
  social: ['https://instagram.com/huellitas'],
  history: 'Llevamos cinco años rescatando, con unos 40 animales al año y hogares temporales.',
  reference: { name: 'Clínica Vet Centro', contact: '809-555-0202', kind: 'veterinaria' },
  rules: true,
  ...over,
});

async function register(cookie: string, over: Record<string, unknown> = {}) {
  return api('/api/portal/shelters', { method: 'POST', body: application(over), cookie });
}

/** A pet listed by the shelter, available, so only the shelter's status decides whether adopters see it. */
async function petFor(shelterId: string, ownerId: string) {
  const id = `pet-${shelterId.slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO pets (id, listed_by, shelter_id, place_id, name, sex, size, energy, status, birth_date) VALUES (?, ?, ?, 'gazcue-distrito-nacional', 'Lucero', 'macho', 'mediano', 'media', 'available', '2023-01-01')",
  )
    .bind(id, ownerId, shelterId)
    .run();
  return id;
}

const visible = async (petId: string) => {
  forgetCatalogVersion();
  const list = await api('/api/pets?lat=18.47&lng=-69.90');
  const profile = await api(`/api/pets/${petId}`);
  return { inList: list.json.pets.some((p: { id: string }) => p.id === petId), profile: profile.status };
};

beforeEach(() => forgetCatalogVersion());

describe('registering a shelter', () => {
  it('needs a signed-in person', async () => {
    expect((await api('/api/portal/shelters', { method: 'POST', body: application() })).status).toBe(401);
  });

  it('checks the essentials and names the first problem', async () => {
    const u = await signIn();
    expect((await register(u.cookie, { rules: false })).json.error).toBe('rules_required');
    expect((await register(u.cookie, { contactPhone: '555-0101' })).json.error).toBe('invalid_phone');
    expect((await register(u.cookie, { placeId: 'nowhere' })).json.error).toBe('invalid_place');
    expect((await register(u.cookie, { history: 'Poco.' })).json.error).toBe('history_too_short');
    expect((await register(u.cookie, { reference: { name: 'X', contact: '', kind: 'amigo' } })).json.error).toBe('invalid_reference');
  });

  it('starts pending, makes the person its owner, and gives a unique slug', async () => {
    const u = await signIn();
    const first = await register(u.cookie);
    expect(first.status).toBe(201);
    expect(first.json.shelter.status).toBe('pending');
    const second = await register(u.cookie);
    expect(second.json.shelter.slug).not.toBe(first.json.shelter.slug);
    const mine = await api('/api/portal/shelters', { cookie: u.cookie });
    expect(mine.json.shelters.map((s: { role: string }) => s.role)).toEqual(['owner', 'owner']);
  });

  it('takes up to three references; extra ones must be complete', async () => {
    const u = await signIn();
    const vet = { name: 'Clínica Vet Centro', contact: '809-555-0202', kind: 'veterinaria' };
    const other = { name: 'Refugio Amigo', contact: '829-555-0303', kind: 'refugio' };
    expect((await register(u.cookie, { references: [vet, { name: 'Ana', contact: '', kind: 'otro' }] })).json.error).toBe('invalid_more_reference');
    const id = (await register(u.cookie, { references: [vet, other, { ...other, name: 'Tercera' }, { ...other, name: 'Cuarta' }] })).json.shelter.id;
    const refs = (await api(`/api/portal/shelters/${id}`, { cookie: u.cookie })).json.application.references;
    expect(refs.map((r: { name: string }) => r.name)).toEqual(['Clínica Vet Centro', 'Refugio Amigo', 'Tercera']);
  });

  it('caps how many shelters one person can own', async () => {
    const u = await signIn();
    // Registered over several days (two a day is its own limit, in limits.test.ts).
    for (let i = 0; i < 3; i++) {
      expect((await register(u.cookie, { name: `Refugio ${i}` })).status).toBe(201);
      await env.DB.prepare("UPDATE shelter_members SET created_at = '2026-01-01T00:00:00Z' WHERE user_id = ?").bind(u.id).run();
    }
    expect((await register(u.cookie, { name: 'Uno más' })).json.error).toBe('too_many_shelters');
  });

  it('keeps the application private to its owners', async () => {
    const owner = await signIn();
    const other = await signIn();
    const { json } = await register(owner.cookie);
    const id = json.shelter.id;
    expect((await api(`/api/portal/shelters/${id}`, { cookie: owner.cookie })).json.application.address).toContain('Las Flores');
    expect((await api(`/api/portal/shelters/${id}`, { cookie: other.cookie })).status).toBe(404);

    const maintainer = await signIn();
    await env.DB.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'maintainer')").bind(id, maintainer.id).run();
    const seen = await api(`/api/portal/shelters/${id}`, { cookie: maintainer.cookie });
    expect(seen.json.shelter.role).toBe('maintainer');
    expect(seen.json.application).toBeNull();
    expect((await api(`/api/portal/shelters/${id}/application`, { method: 'PUT', body: application(), cookie: maintainer.cookie })).status).toBe(404);
  });
});

describe('verifying a shelter', () => {
  it('is for admins only, and the admin area does not announce itself', async () => {
    const u = await signIn();
    expect((await api('/api/admin/shelters', { cookie: u.cookie })).status).toBe(404);
    expect((await api('/api/admin/shelters')).status).toBe(404);
  });

  it('hides a pending shelter\'s animals, shows them once verified, hides them again when suspended', async () => {
    const owner = await signIn();
    const adminUser = await signIn({ admin: true });
    const id = (await register(owner.cookie)).json.shelter.id;
    const pet = await petFor(id, owner.id);
    expect(await visible(pet)).toEqual({ inList: false, profile: 404 });

    const queue = await api('/api/admin/shelters?status=pending', { cookie: adminUser.cookie });
    expect(queue.json.shelters.some((s: { id: string }) => s.id === id)).toBe(true);

    expect((await api(`/api/admin/shelters/${id}/decision`, { method: 'POST', body: { action: 'verify' }, cookie: adminUser.cookie })).json.shelter.status).toBe('verified');
    expect(await visible(pet)).toEqual({ inList: true, profile: 200 });

    expect((await api(`/api/admin/shelters/${id}/decision`, { method: 'POST', body: { action: 'suspend' }, cookie: adminUser.cookie })).json.error).toBe('reason_required');
    await api(`/api/admin/shelters/${id}/decision`, { method: 'POST', body: { action: 'suspend', reason: 'Reportes de venta' }, cookie: adminUser.cookie });
    expect(await visible(pet)).toEqual({ inList: false, profile: 404 });

    const log = await env.DB.prepare("SELECT action FROM admin_actions WHERE subject_id = ? ORDER BY created_at, rowid").bind(id).all<{ action: string }>();
    expect(log.results.map((r) => r.action)).toEqual(['shelter.verify', 'shelter.suspend']);
  });

  it('lets a rejected shelter fix its application and resend it', async () => {
    const owner = await signIn();
    const adminUser = await signIn({ admin: true });
    const id = (await register(owner.cookie)).json.shelter.id;
    expect((await api(`/api/admin/shelters/${id}/decision`, { method: 'POST', body: { action: 'reject' }, cookie: adminUser.cookie })).json.error).toBe('reason_required');
    await api(`/api/admin/shelters/${id}/decision`, { method: 'POST', body: { action: 'reject', reason: 'Falta una referencia que podamos contactar.' }, cookie: adminUser.cookie });

    const rejected = await api(`/api/portal/shelters/${id}`, { cookie: owner.cookie });
    expect(rejected.json.shelter.status).toBe('rejected');
    expect(rejected.json.shelter.statusReason).toContain('referencia');

    const resent = await api(`/api/portal/shelters/${id}/application`, { method: 'PUT', body: application({ reference: { name: 'Refugio Amigo', contact: '829-555-0303', kind: 'refugio' } }), cookie: owner.cookie });
    expect(resent.json.shelter.status).toBe('pending');
    expect((await api(`/api/portal/shelters/${id}`, { cookie: owner.cookie })).json.shelter.statusReason).toBeNull();
  });

  it('does not allow decisions that skip a step', async () => {
    const owner = await signIn();
    const adminUser = await signIn({ admin: true });
    const id = (await register(owner.cookie)).json.shelter.id;
    // A pending shelter can't be suspended; it hasn't been verified yet.
    expect((await api(`/api/admin/shelters/${id}/decision`, { method: 'POST', body: { action: 'suspend', reason: 'x' }, cookie: adminUser.cookie })).json.error).toBe('invalid_transition');
  });
});
