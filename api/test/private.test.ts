import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetCatalogVersion } from '../src/cache';
import { addPhoto, api, signIn } from './helpers';

// Private listers (owner decision 2026-10-16): a person outside any shelter asks to list, an admin approves
// the person (not each listing), and they then work like a small verified shelter: same form, inbox and
// moderation. Adopters see "Particular" and the area, never a name; no fee; a small limit on animals.

const PLACE = 'gazcue-distrito-nacional';
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const listing = (over: Record<string, unknown> = {}) => ({
  species: 'perro', name: 'Gala', sex: 'hembra', birthDate: daysAgo(400), birthDateEstimated: true, size: 'mediano', energy: 'media',
  goodWith: { kids: true, dogs: null, cats: false }, health: { vaccinated: true, sterilized: false, dewormed: true },
  story: 'Mi perra tuvo una camada y busco buenas familias para ellos.', needs: [], adoptionFeeDop: null, ...over,
});
const form = (over: Record<string, unknown> = {}) => ({ kind: 'private', placeId: PLACE, phone: '809-555-0177', about: 'Mi perra tuvo seis cachorros y busco hogares cercanos, por favor.', consent: true, ...over });
const ask = (cookie: string, over: Record<string, unknown> = {}) => api('/api/portal/owner-request', { method: 'POST', cookie, body: form(over) });
const decide = (cookie: string, id: string, action: 'approve' | 'decline', note?: string) => api(`/api/admin/owners/${id}/decision`, { method: 'POST', cookie, body: { action, note } });
const mine = async (cookie: string) => ((await api('/api/portal/shelters', { cookie })).json.shelters as { id: string; kind: string; status: string }[]).find((s) => s.kind === 'private');

/** The real path: ask, an admin approves, and the profile exists. */
async function approvedLister(name = 'Ana Particular') {
  const admin = await signIn({ admin: true });
  const user = await signIn({ name });
  const request = (await ask(user.cookie)).json.request;
  await decide(admin.cookie, request.id, 'approve');
  return { admin, user, id: (await mine(user.cookie))!.id };
}
const create = (sid: string, cookie: string, over: Record<string, unknown> = {}) => api(`/api/portal/shelters/${sid}/pets`, { method: 'POST', cookie, body: listing(over) });
async function published(sid: string, cookie: string, over: Record<string, unknown> = {}) {
  const id = (await create(sid, cookie)).json.pet.id as string;
  await addPhoto(id, cookie);
  const res = await api(`/api/portal/pets/${id}`, { method: 'PUT', cookie, body: { ...listing(over), publish: true } });
  return { id, res };
}
const inCatalogue = async (id: string) => {
  forgetCatalogVersion();
  return (await api('/api/pets?lat=18.47&lng=-69.90')).json.pets.some((p: { id: string }) => p.id === id);
};

beforeEach(() => forgetCatalogVersion());

describe('asking to list as a private person', () => {
  it('needs an area, a phone, a few lines about them and consent', async () => {
    const u = await signIn();
    expect((await ask(u.cookie, { placeId: 'nowhere' })).json.error).toBe('invalid_place');
    expect((await ask(u.cookie, { phone: '123' })).json.error).toBe('invalid_phone');
    expect((await ask(u.cookie, { about: 'Corto' })).json.error).toBe('about_too_short');
    expect((await ask(u.cookie, { consent: false })).json.error).toBe('consent_required');
    expect((await ask(u.cookie)).status).toBe(201);
  });

  it('shows on their account as a private request, and one waits at a time', async () => {
    const u = await signIn();
    const sent = await ask(u.cookie);
    expect(sent.json.request).toMatchObject({ kind: 'private', status: 'pending', shelterName: 'Particular', zone: expect.stringContaining('Gazcue') });
    expect((await ask(u.cookie)).json.error).toBe('already_pending');
    const me = (await api('/api/me', { cookie: u.cookie })).json.user;
    expect(me.listerRequest).toMatchObject({ kind: 'private', status: 'pending' });
    expect(me.ownerRequest).toBeNull();
  });

  it('is separate from being a shelter owner: a shelter owner can ask too', async () => {
    const owner = await signIn({ owner: true });
    expect((await ask(owner.cookie)).status).toBe(201);
  });

  it('lands in the admin queue as "Particular", flagged only by a shared phone', async () => {
    const admin = await signIn({ admin: true });
    const a = await signIn();
    const b = await signIn();
    const c = await signIn();
    await ask(a.cookie, { phone: '809-555-0191' });
    await ask(b.cookie, { phone: '809-555-0191' });
    await ask(c.cookie, { phone: '809-555-0192' });
    const queue = (await api('/api/admin/owners', { cookie: admin.cookie })).json.requests as { kind: string; who: { email: string }; place: { id: string } | null; lookAlikes: { why: string }[] }[];
    const forB = queue.find((r) => r.who.email === b.email)!;
    expect(forB).toMatchObject({ kind: 'private', place: { id: PLACE } });
    expect(forB.lookAlikes.map((l) => l.why)).toEqual(['same_phone']);
    expect(queue.find((r) => r.who.email === c.email)!.lookAlikes).toEqual([]);
  });
});

describe('approving a private lister', () => {
  it('creates their profile, verified, without making them a shelter owner', async () => {
    const { user, id } = await approvedLister();
    expect((await mine(user.cookie))).toMatchObject({ id, kind: 'private', status: 'verified' });
    const row = await env.DB.prepare('SELECT kind, status, place_id FROM shelters WHERE id = ?').bind(id).first();
    expect(row).toEqual({ kind: 'private', status: 'verified', place_id: PLACE });
    const me = (await api('/api/me', { cookie: user.cookie })).json.user;
    expect(me.shelterOwner).toBe(false);
    // They can't register a shelter.
    const reg = await api('/api/portal/shelters', { method: 'POST', cookie: user.cookie, body: {} });
    expect(reg.json.error).toBe('owner_approval_required');
  });

  it('declining creates nothing, and they can ask again later', async () => {
    const admin = await signIn({ admin: true });
    const u = await signIn();
    const request = (await ask(u.cookie)).json.request;
    expect((await decide(admin.cookie, request.id, 'decline')).json.error).toBe('reason_required');
    expect((await decide(admin.cookie, request.id, 'decline', 'No pudimos confirmar tus datos.')).status).toBe(200);
    expect(await mine(u.cookie)).toBeUndefined();
    expect((await ask(u.cookie)).status).toBe(201);
  });

  it('is once per person', async () => {
    const { user } = await approvedLister();
    expect((await ask(user.cookie)).json.error).toBe('already_lister');
  });

  it('does not use up the three shelters an owner may have', async () => {
    const { admin, user } = await approvedLister();
    await env.DB.prepare('UPDATE users SET shelter_owner_at = ? WHERE id = ?').bind('2026-01-01T00:00:00Z', user.id).run();
    const form = { name: 'Refugio Uno', placeId: PLACE, description: '', visitHours: '', publicPhone: '', email: '', website: '', contactName: 'Ana', contactPhone: '809-555-0100', rnc: '', address: 'Calle 1, Gazcue', social: [], history: 'x'.repeat(60), references: [{ name: 'Vet', contact: '809-555-0101', kind: 'veterinaria' }], rules: true };
    expect((await api('/api/portal/shelters', { method: 'POST', cookie: user.cookie, body: form })).status).toBe(201);
    expect(admin).toBeTruthy();
  });
});

describe('what a private lister can do', () => {
  it('publishes at once: no per-listing approval', async () => {
    const { user, id } = await approvedLister();
    const { id: petId, res } = await published(id, user.cookie);
    expect(res.json.pet.status).toBe('available');
    expect(await inCatalogue(petId)).toBe(true);
  });

  it('cannot ask for a fee, not even 0', async () => {
    const { user, id } = await approvedLister();
    expect((await create(id, user.cookie, { adoptionFeeDop: 500 })).json.error).toBe('fee_not_allowed');
    expect((await create(id, user.cookie, { adoptionFeeDop: 0 })).json.error).toBe('fee_not_allowed');
    expect((await create(id, user.cookie, { adoptionFeeDop: null })).status).toBe(201);
    expect((await api(`/api/portal/shelters/${id}/pets`, { cookie: user.cookie })).json.shelter).toMatchObject({ kind: 'private', feeCapDop: 0 });
  });

  it('can have ten animals up at once; ones that left don’t count', async () => {
    const { user, id } = await approvedLister();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push((await create(id, user.cookie, { name: `Cachorro${i}` })).json.pet.id);
    const eleventh = await create(id, user.cookie, { name: 'Uno más' });
    expect(eleventh.status).toBe(409);
    expect(eleventh.json).toEqual({ error: 'too_many_pets', max: 10 });
    await env.DB.prepare("UPDATE pets SET status = 'withdrawn' WHERE id = ?").bind(ids[0]).run();
    expect((await create(id, user.cookie, { name: 'Uno más' })).status).toBe(201);
  });

  it('still goes through the money check', async () => {
    const { user, id } = await approvedLister();
    const { res } = await published(id, user.cookie, { story: 'Se vende a buen precio, negociable.' });
    expect(res.json.pet.status).toBe('in_review');
  });

  it('can be suspended like a shelter, and then its animals disappear', async () => {
    const { admin, user, id } = await approvedLister();
    const { id: petId } = await published(id, user.cookie);
    expect((await api(`/api/admin/shelters/${id}/decision`, { method: 'POST', cookie: admin.cookie, body: { action: 'suspend', reason: 'Vendía los cachorros.' } })).status).toBe(200);
    expect(await inCatalogue(petId)).toBe(false);
  });
});

describe('what adopters see', () => {
  it('is "Particular" and the area, never the person or the profile behind it', async () => {
    const { user, id } = await approvedLister('Ana Secreta Gómez');
    const { id: petId } = await published(id, user.cookie);
    forgetCatalogVersion();
    const listed = (await api('/api/pets?lat=18.47&lng=-69.90')).json.pets.find((p: { id: string }) => p.id === petId);
    expect(listed.lister).toEqual({ type: 'private' });
    const profile = (await api(`/api/pets/${petId}`)).json.pet;
    expect(profile.lister).toEqual({ type: 'private' });
    expect(profile.adoptionFeeDop).toBeNull();
    expect(profile.place.id).toBe(PLACE);
    for (const body of [JSON.stringify(listed), JSON.stringify(profile)]) {
      expect(body).not.toContain('Secreta');
      expect(body).not.toContain(id);
    }
    // Link previews (WhatsApp) too.
    const page = await (await import('cloudflare:workers')).exports.default.fetch(new Request(`https://example.test/mascota/${petId}`));
    expect(await page.text()).not.toContain('Secreta');
  });

  it('and the animal appears in Mi lista without naming them', async () => {
    const { user, id } = await approvedLister('Ana Secreta Gómez');
    const { id: petId } = await published(id, user.cookie);
    const adopter = await signIn();
    const sent = await api('/api/requests', { method: 'POST', cookie: adopter.cookie, body: { petId, answers: { space: 'si', time: 'si', cost: 'si' }, name: 'Luis', pref: 'correo', phone: '', consent: true } });
    expect(sent.status).toBe(201);
    const list = await api('/api/requests', { cookie: adopter.cookie });
    expect(JSON.stringify(list.json)).not.toContain('Secreta');
    expect(list.json.items[0].pet.lister).toEqual({ type: 'private' });
  });
});

describe('requests to a private lister', () => {
  it('reach their inbox like a shelter’s, with the adopter’s contact while it is open', async () => {
    const { user, id } = await approvedLister();
    const { id: petId } = await published(id, user.cookie);
    const adopter = await signIn({ name: 'Luis Adoptante' });
    await api('/api/requests', { method: 'POST', cookie: adopter.cookie, body: { petId, answers: { space: 'si', time: 'si', cost: 'si' }, name: 'Luis Adoptante', pref: 'correo', phone: '', consent: true } });
    const inbox = (await api(`/api/portal/shelters/${id}/requests`, { cookie: user.cookie })).json.requests;
    expect(inbox).toHaveLength(1);
    expect(inbox[0].contact).toMatchObject({ name: 'Luis Adoptante', email: adopter.email });
    // And the lister can close it out like a shelter: the animal went home.
    expect((await api(`/api/portal/pets/${petId}/adopted`, { method: 'POST', cookie: user.cookie, body: { requestId: inbox[0].id } })).status).toBe(200);
  });
});
