import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetCatalogVersion } from '../src/cache';
import { api, signIn } from './helpers';

// Donations (migration 0023, owner decision 2026-10-27): a shelter's owner adds a bank account from the
// portal, never at registration; adopters see it on the shelter's card in each pet's profile, only while
// the shelter is verified. Private listers can't ask for money, so they have none.

const application = {
  name: 'Huellitas del Este',
  placeId: 'gazcue-distrito-nacional',
  contactName: 'María Rodríguez',
  contactPhone: '809-555-0101',
  address: 'Calle Las Flores 12, Gazcue',
  history: 'Llevamos cinco años rescatando, con unos 40 animales al año y hogares temporales.',
  reference: { name: 'Clínica Vet Centro', contact: '809-555-0202', kind: 'veterinaria' },
  rules: true,
};
const account = (over: Record<string, unknown> = {}) => ({
  bank: 'Banco Popular',
  accountType: 'ahorros',
  account: '812-345678-9',
  holder: 'Fundación Huellitas del Este',
  holderId: '1-31-12345-6',
  note: 'También recibimos alimento.',
  ...over,
});
const save = (id: string, cookie: string, body: unknown) => api(`/api/portal/shelters/${id}/donation`, { method: 'PUT', cookie, body });

async function shelter() {
  const owner = await signIn({ owner: true });
  const id = (await api('/api/portal/shelters', { method: 'POST', cookie: owner.cookie, body: application })).json.shelter.id as string;
  const pet = `pet-${id.slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO pets (id, listed_by, shelter_id, place_id, name, sex, size, energy, status, birth_date) VALUES (?, ?, ?, 'gazcue-distrito-nacional', 'Lucero', 'macho', 'mediano', 'media', 'available', '2023-01-01')",
  )
    .bind(pet, owner.id, id)
    .run();
  return { owner, id, pet };
}
const verify = async (id: string) => {
  const admin = await signIn({ admin: true });
  await api(`/api/admin/shelters/${id}/decision`, { method: 'POST', cookie: admin.cookie, body: { action: 'verify' } });
};
const profile = async (pet: string) => {
  forgetCatalogVersion();
  return api(`/api/pets/${pet}`);
};

beforeEach(() => forgetCatalogVersion());

describe('a shelter\'s donation details', () => {
  it('are not part of registration: a new shelter has none', async () => {
    const { owner, id } = await shelter();
    expect((await api(`/api/portal/shelters/${id}`, { cookie: owner.cookie })).json.shelter.donation).toBeNull();
  });

  it('are set by the owner only', async () => {
    const { owner, id } = await shelter();
    const stranger = await signIn();
    const maintainer = await signIn();
    await env.DB.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'maintainer')").bind(id, maintainer.id).run();
    expect((await save(id, stranger.cookie, account())).status).toBe(404);
    expect((await save(id, maintainer.cookie, account())).status).toBe(404);
    expect((await api(`/api/portal/shelters/${id}/donation`, { method: 'PUT', body: account() })).status).toBe(401);

    const res = await save(id, owner.cookie, account());
    expect(res.status).toBe(200);
    expect(res.json.donation).toEqual({ bank: 'Banco Popular', accountType: 'ahorros', account: '812-345678-9', holder: 'Fundación Huellitas del Este', holderId: '1-31-12345-6', note: 'También recibimos alimento.' });
    expect((await api(`/api/portal/shelters/${id}`, { cookie: owner.cookie })).json.shelter.donation.bank).toBe('Banco Popular');
  });

  it('check every field and name the first problem', async () => {
    const { owner, id } = await shelter();
    expect((await save(id, owner.cookie, account({ bank: '' }))).json.error).toBe('invalid_bank');
    expect((await save(id, owner.cookie, account({ accountType: 'plazo fijo' }))).json.error).toBe('invalid_account_type');
    expect((await save(id, owner.cookie, account({ account: '123' }))).json.error).toBe('invalid_account');
    expect((await save(id, owner.cookie, account({ account: 'llámanos' }))).json.error).toBe('invalid_account');
    expect((await save(id, owner.cookie, account({ holder: '' }))).json.error).toBe('invalid_holder');
    expect((await save(id, owner.cookie, account({ holderId: '12345' }))).json.error).toBe('invalid_holder_id');
    // Cédula and RNC are optional, and so is the note.
    expect((await save(id, owner.cookie, account({ holderId: '', note: '' }))).json.donation).toMatchObject({ holderId: null, note: null });
    expect((await save(id, owner.cookie, account({ holderId: '001-1234567-8' }))).json.donation.holderId).toBe('001-1234567-8');
  });

  it('are removed by sending the form blank', async () => {
    const { owner, id } = await shelter();
    await save(id, owner.cookie, account());
    const blank = { bank: '', accountType: '', account: '', holder: '', holderId: '', note: '' };
    expect((await save(id, owner.cookie, blank)).json.donation).toBeNull();
    const row = await env.DB.prepare('SELECT donation_bank, donation_note FROM shelters WHERE id = ?').bind(id).first();
    expect(row).toEqual({ donation_bank: null, donation_note: null });
  });

  it('can\'t be given by a private lister', async () => {
    const user = await signIn();
    const id = `private-${user.id}`;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status, verified_at, kind) VALUES (?, ?, 'Particular · Ana', 'gazcue-distrito-nacional', 'verified', '2026-10-01T00:00:00Z', 'private')").bind(id, id),
      env.DB.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'owner')").bind(id, user.id),
    ]);
    expect((await save(id, user.cookie, account())).json.error).toBe('not_for_private');
  });

  it('show on the shelter\'s card in a pet\'s profile once the shelter is verified, and follow changes', async () => {
    const { owner, id, pet } = await shelter();
    await save(id, owner.cookie, account()); // added while pending: nobody sees the pet yet
    expect((await profile(pet)).status).toBe(404);

    await verify(id);
    expect((await profile(pet)).json.pet.lister.donation).toMatchObject({ bank: 'Banco Popular', account: '812-345678-9', holder: 'Fundación Huellitas del Este' });

    await save(id, owner.cookie, account({ bank: 'Banreservas', accountType: 'corriente' }));
    expect((await profile(pet)).json.pet.lister.donation).toMatchObject({ bank: 'Banreservas', accountType: 'corriente' });

    await save(id, owner.cookie, {});
    expect((await profile(pet)).json.pet.lister.donation).toBeNull();
  });
});
