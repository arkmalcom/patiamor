import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetCatalogVersion } from '../src/cache';
import { api, signIn } from './helpers';

// Donations (migrations 0023/0024, owner decisions 2026-10-27): a shelter's owner adds bank accounts from the
// portal (up to four: many shelters bank in more than one place), never at registration; adopters see them on
// the shelter's card in each pet's profile, only while the shelter is verified. Private listers have none.

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
const popular = { bank: 'Banco Popular', accountType: 'ahorros', account: '812-345678-9', holder: 'Fundación Huellitas del Este', holderId: '1-31-12345-6' };
const banreservas = { bank: 'Banreservas', accountType: 'corriente', account: '960-0123456', holder: 'María Rodríguez', holderId: '' };
const form = (accounts: object[], note = 'También recibimos alimento.') => ({ accounts, note });
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

describe('a shelter\'s donation accounts', () => {
  it('are not part of registration: a new shelter has none', async () => {
    const { owner, id } = await shelter();
    expect((await api(`/api/portal/shelters/${id}`, { cookie: owner.cookie })).json.shelter.donation).toBeNull();
  });

  it('are set by the owner only, several at once, in the order given', async () => {
    const { owner, id } = await shelter();
    const stranger = await signIn();
    const maintainer = await signIn();
    await env.DB.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'maintainer')").bind(id, maintainer.id).run();
    expect((await save(id, stranger.cookie, form([popular]))).status).toBe(404);
    expect((await save(id, maintainer.cookie, form([popular]))).status).toBe(404);
    expect((await api(`/api/portal/shelters/${id}/donation`, { method: 'PUT', body: form([popular]) })).status).toBe(401);

    const res = await save(id, owner.cookie, form([popular, banreservas]));
    expect(res.status).toBe(200);
    expect(res.json.donation).toEqual({
      accounts: [
        { bank: 'Banco Popular', accountType: 'ahorros', account: '812-345678-9', holder: 'Fundación Huellitas del Este', holderId: '1-31-12345-6' },
        { bank: 'Banreservas', accountType: 'corriente', account: '960-0123456', holder: 'María Rodríguez', holderId: null },
      ],
      note: 'También recibimos alimento.',
    });
    expect((await api(`/api/portal/shelters/${id}`, { cookie: owner.cookie })).json.shelter.donation.accounts.map((a: { bank: string }) => a.bank)).toEqual(['Banco Popular', 'Banreservas']);

    // Saving again replaces the list: reordered, one dropped.
    expect((await save(id, owner.cookie, form([banreservas]))).json.donation.accounts.map((a: { bank: string }) => a.bank)).toEqual(['Banreservas']);
  });

  it('check every field and name the account at fault', async () => {
    const { owner, id } = await shelter();
    const bad = async (over: object) => (await save(id, owner.cookie, form([popular, { ...banreservas, ...over }]))).json;
    expect(await bad({ bank: '' })).toMatchObject({ error: 'invalid_bank', index: 1 });
    expect(await bad({ accountType: 'plazo fijo' })).toMatchObject({ error: 'invalid_account_type', index: 1 });
    expect(await bad({ account: '123' })).toMatchObject({ error: 'invalid_account', index: 1 });
    expect(await bad({ account: 'llámanos' })).toMatchObject({ error: 'invalid_account', index: 1 });
    expect(await bad({ holder: '' })).toMatchObject({ error: 'invalid_holder', index: 1 });
    expect(await bad({ holderId: '12345' })).toMatchObject({ error: 'invalid_holder_id', index: 1 });
    expect(await bad({ account: '8123456789' })).toMatchObject({ error: 'duplicate_account', index: 1 }); // popular's, without dashes
    // Cédula and RNC are optional, and so is the note.
    expect((await save(id, owner.cookie, form([{ ...popular, holderId: '' }], ''))).json.donation).toMatchObject({ accounts: [{ holderId: null }], note: null });
    expect((await save(id, owner.cookie, form([{ ...popular, holderId: '001-1234567-8' }]))).json.donation.accounts[0].holderId).toBe('001-1234567-8');
  });

  it('are at most four; blank ones are ignored', async () => {
    const { owner, id } = await shelter();
    const n = (i: number) => ({ ...popular, account: `812-34567${i}-9` });
    expect((await save(id, owner.cookie, form([n(1), n(2), n(3), n(4), n(5)]))).json.error).toBe('too_many_accounts');
    const blank = { bank: '', accountType: '', account: '', holder: '', holderId: '' };
    expect((await save(id, owner.cookie, form([n(1), blank, n(2), n(3), n(4)]))).json.donation.accounts).toHaveLength(4);
  });

  it('are all removed by sending none, and the note goes with them', async () => {
    const { owner, id } = await shelter();
    await save(id, owner.cookie, form([popular, banreservas]));
    expect((await save(id, owner.cookie, form([], 'Solo una nota'))).json.donation).toBeNull();
    const left = await env.DB.prepare('SELECT count(*) AS n FROM shelter_donation_accounts WHERE shelter_id = ?').bind(id).first<{ n: number }>();
    expect(left?.n).toBe(0);
    expect(await env.DB.prepare('SELECT donation_note FROM shelters WHERE id = ?').bind(id).first()).toEqual({ donation_note: null });
  });

  it('can\'t be given by a private lister', async () => {
    const user = await signIn();
    const id = `private-${user.id}`;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status, verified_at, kind) VALUES (?, ?, 'Particular · Ana', 'gazcue-distrito-nacional', 'verified', '2026-10-01T00:00:00Z', 'private')").bind(id, id),
      env.DB.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'owner')").bind(id, user.id),
    ]);
    expect((await save(id, user.cookie, form([popular]))).json.error).toBe('not_for_private');
  });

  it('show on the shelter\'s card in a pet\'s profile once the shelter is verified, and follow changes', async () => {
    const { owner, id, pet } = await shelter();
    await save(id, owner.cookie, form([popular])); // added while pending: nobody sees the pet yet
    expect((await profile(pet)).status).toBe(404);

    await verify(id);
    expect((await profile(pet)).json.pet.lister.donation).toMatchObject({ accounts: [{ bank: 'Banco Popular', account: '812-345678-9' }], note: 'También recibimos alimento.' });

    await save(id, owner.cookie, form([popular, banreservas]));
    expect((await profile(pet)).json.pet.lister.donation.accounts.map((a: { bank: string }) => a.bank)).toEqual(['Banco Popular', 'Banreservas']);

    await save(id, owner.cookie, form([]));
    expect((await profile(pet)).json.pet.lister.donation).toBeNull();
  });
});
