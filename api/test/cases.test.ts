import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetCatalogVersion } from '../src/cache';
import { trimEndedCasePhotos } from '../src/cases';
import { contactNumbers } from '../../web/src/money';
import { api, fakeJpeg, fakeWebp, ORIGIN, signIn } from './helpers';

// Help cases (migration 0025, owner decision 2026-10-28): verified shelters (or an admin, for one) ask for help
// with an animal's medical costs, apart from adoption. Donors give to the shelter's own accounts; a case
// needs them to be seen, can't carry phone or account numbers, drops out of view after 60 days without news,
// and ends with what happened.

const application = {
  name: 'Patas Unidas',
  placeId: 'gazcue-distrito-nacional',
  contactName: 'Ana Pérez',
  contactPhone: '809-555-0101',
  publicPhone: '809-555-0100',
  address: 'Calle Las Flores 12, Gazcue',
  history: 'Llevamos cinco años rescatando, con unos 40 animales al año y hogares temporales.',
  reference: { name: 'Clínica Vet Centro', contact: '809-555-0202', kind: 'veterinaria' },
  rules: true,
};
const account = { bank: 'Banco Popular', accountType: 'ahorros', account: '812-345678-9', holder: 'Fundación Patas Unidas', holderId: '' };
const luna = {
  species: 'perro',
  name: 'Luna',
  need: 'cirugia',
  story: 'La atropellaron en la autopista y tiene la cadera rota. El veterinario dice que con la cirugía volverá a caminar.',
  costDop: 35000,
  alsoNeeded: 'Un hogar temporal para la recuperación.',
};

async function shelter(opts: { verified?: boolean; accounts?: boolean } = {}) {
  const owner = await signIn({ owner: true });
  const id = (await api('/api/portal/shelters', { method: 'POST', cookie: owner.cookie, body: application })).json.shelter.id as string;
  if (opts.verified !== false) {
    const admin = await signIn({ admin: true });
    await api(`/api/admin/shelters/${id}/decision`, { method: 'POST', cookie: admin.cookie, body: { action: 'verify' } });
  }
  if (opts.accounts !== false) await api(`/api/portal/shelters/${id}/donation`, { method: 'PUT', cookie: owner.cookie, body: { accounts: [account], note: null } });
  return { owner, id };
}
const create = (shelterId: string, cookie: string, body: object = luna) => api(`/api/portal/shelters/${shelterId}/cases`, { method: 'POST', cookie, body });
const save = (caseId: string, cookie: string, body: object) => api(`/api/portal/cases/${caseId}`, { method: 'PUT', cookie, body });
const addPhoto = (caseId: string, cookie: string) =>
  api(`/api/portal/cases/${caseId}/photos`, { method: 'POST', cookie, body: { image: fakeJpeg(1600, 1200), thumb: fakeWebp(480, 360) } });
const fresh = <T>(read: () => Promise<T>) => (forgetCatalogVersion(), read());
const publicCase = (id: string) => fresh(() => api(`/api/cases/${id}`));
const publicList = () => fresh(() => api('/api/cases'));

/** A verified shelter with an open case: a draft, a photo, then published. */
async function openCase(body: object = luna) {
  const s = await shelter();
  const id = (await create(s.id, s.owner.cookie, body)).json.case.id as string;
  expect((await addPhoto(id, s.owner.cookie)).status).toBe(201);
  expect((await save(id, s.owner.cookie, { ...body, publish: true })).json.case.status).toBe('open');
  return { ...s, caseId: id };
}

beforeEach(() => forgetCatalogVersion());

describe('who can write a case', () => {
  it('members of the shelter and admins; nobody else', async () => {
    const { owner, id } = await shelter();
    const maintainer = await signIn();
    await env.DB.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'maintainer')").bind(id, maintainer.id).run();
    const stranger = await signIn();
    const admin = await signIn({ admin: true });

    expect((await create(id, owner.cookie)).status).toBe(201);
    expect((await create(id, maintainer.cookie)).status).toBe(201);
    expect((await create(id, stranger.cookie)).status).toBe(404);
    expect((await api(`/api/portal/shelters/${id}/cases`, { method: 'POST', body: luna })).status).toBe(401);
    // An admin publishes for the shelter (owner decision): the case is still the shelter's, with its accounts.
    const byAdmin = (await create(id, admin.cookie)).json.case.id as string;
    expect((await api(`/api/portal/shelters/${id}/cases`, { cookie: admin.cookie })).json.shelter.role).toBe('admin');
    expect((await addPhoto(byAdmin, admin.cookie)).status).toBe(201);
    expect((await save(byAdmin, admin.cookie, { ...luna, publish: true })).json.case.status).toBe('open');
    expect((await publicCase(byAdmin)).json.case.shelter.donation.accounts[0].bank).toBe('Banco Popular');
    // A stranger can't read or change it either.
    expect((await api(`/api/portal/cases/${byAdmin}`, { cookie: stranger.cookie })).status).toBe(404);
    expect((await save(byAdmin, stranger.cookie, luna)).status).toBe(404);
    expect((await addPhoto(byAdmin, stranger.cookie)).status).toBe(404);
  });

  it('only from a verified shelter: not one in review, nor a suspended one', async () => {
    const pending = await shelter({ verified: false, accounts: false });
    expect((await create(pending.id, pending.owner.cookie)).json).toEqual({ error: 'shelter_not_verified' });

    const { owner, id, caseId } = await openCase();
    const admin = await signIn({ admin: true });
    await api(`/api/admin/shelters/${id}/decision`, { method: 'POST', cookie: admin.cookie, body: { action: 'suspend', reason: 'Revisión de rutina por reportes.' } });
    expect((await create(id, owner.cookie)).json).toEqual({ error: 'shelter_suspended' });
    expect((await save(caseId, owner.cookie, luna)).json).toEqual({ error: 'shelter_suspended' });
    expect((await addPhoto(caseId, owner.cookie)).json).toEqual({ error: 'shelter_suspended' });
    // And donors don't see it at all, as with its animals.
    expect((await publicCase(caseId)).status).toBe(404);
  });

  it('never from a private lister, who can\'t ask for money', async () => {
    const person = await signIn();
    const id = `private-${person.id}`;
    await env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status, kind) VALUES (?, ?, 'Particular · Prueba', 'gazcue-distrito-nacional', 'verified', 'private')").bind(id, id).run();
    await env.DB.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'owner')").bind(id, person.id).run();
    expect((await create(id, person.cookie)).json).toEqual({ error: 'not_for_private' });
    expect((await api(`/api/portal/shelters/${id}/cases`, { cookie: person.cookie })).status).toBe(403);
  });

  it('at most 10 drafts and open cases at once', async () => {
    const { owner, id } = await shelter();
    for (let i = 0; i < 10; i++) expect((await create(id, owner.cookie)).status).toBe(201);
    expect((await create(id, owner.cookie)).json).toEqual({ error: 'too_many_cases', max: 10 });
  });
});

describe('publishing a case', () => {
  it('needs the shelter\'s donation accounts, a story and a photo', async () => {
    const { owner, id } = await shelter({ accounts: false });
    const caseId = (await create(id, owner.cookie, { ...luna, story: 'Corto.' })).json.case.id as string;
    expect((await save(caseId, owner.cookie, { ...luna, story: 'Corto.', publish: true })).json).toEqual({ error: 'no_donation_accounts' });
    await api(`/api/portal/shelters/${id}/donation`, { method: 'PUT', cookie: owner.cookie, body: { accounts: [account], note: null } });
    expect((await save(caseId, owner.cookie, { ...luna, story: 'Corto.', publish: true })).json).toEqual({ error: 'story_required' });
    expect((await save(caseId, owner.cookie, { ...luna, publish: true })).json).toEqual({ error: 'photo_required' });
    await addPhoto(caseId, owner.cookie);
    expect((await save(caseId, owner.cookie, { ...luna, publish: true })).json.case.status).toBe('open');
  });

  it('checks every field', async () => {
    const { owner, id } = await shelter();
    expect((await create(id, owner.cookie, { ...luna, species: 'loro' })).json.error).toBe('invalid_species');
    expect((await create(id, owner.cookie, { ...luna, name: ' ' })).json.error).toBe('invalid_name');
    expect((await create(id, owner.cookie, { ...luna, need: 'vacaciones' })).json.error).toBe('invalid_need');
    expect((await create(id, owner.cookie, { ...luna, costDop: 0 })).json.error).toBe('invalid_cost');
    expect((await create(id, owner.cookie, { ...luna, costDop: 12.5 })).json.error).toBe('invalid_cost');
    expect((await create(id, owner.cookie, { ...luna, costDop: 2_000_001 })).json.error).toBe('invalid_cost');
    expect((await create(id, owner.cookie, { ...luna, costDop: null })).status).toBe(201);
  });

  it('refuses phone and account numbers in its text: donations only go to the shelter\'s accounts', async () => {
    const { owner, id } = await shelter();
    const res = await create(id, owner.cookie, { ...luna, story: `${luna.story} Escríbenos al 809-555-1234 o deposita en la 9600123456.` });
    expect(res.json).toEqual({ error: 'contact_in_text', numbers: ['809-555-1234', '9600123456'] });
    expect((await create(id, owner.cookie, { ...luna, alsoNeeded: 'Llama al 8095551234' })).json.error).toBe('contact_in_text');
    // Amounts and dates are fine.
    expect((await create(id, owner.cookie, { ...luna, story: `${luna.story} Cuesta RD$35,000 (o 1.500.000 en total) y la operan el 2026-11-02.` })).status).toBe(201);
  });

  it('can link the same animal\'s listing, if it\'s this shelter\'s and still with it', async () => {
    const { owner, id } = await shelter();
    const other = await shelter();
    const mine = `pet-${id.slice(0, 8)}`;
    const theirs = `pet-${other.id.slice(0, 8)}`;
    for (const [pet, sid, by] of [[mine, id, owner.id], [theirs, other.id, other.owner.id]])
      await env.DB.prepare(
        "INSERT INTO pets (id, listed_by, shelter_id, place_id, name, sex, size, energy, status, birth_date, published_at) VALUES (?, ?, ?, 'gazcue-distrito-nacional', 'Luna', 'hembra', 'mediano', 'media', 'available', '2023-01-01', '2026-10-01T00:00:00Z')",
      )
        .bind(pet, by, sid)
        .run();
    expect((await create(id, owner.cookie, { ...luna, petId: theirs })).json).toEqual({ error: 'invalid_pet' });
    const caseId = (await create(id, owner.cookie, { ...luna, petId: mine })).json.case.id as string;
    await addPhoto(caseId, owner.cookie);
    await save(caseId, owner.cookie, { ...luna, petId: mine, publish: true });
    // The case points to the profile, and the profile to the case.
    expect((await publicCase(caseId)).json.case.pet).toEqual({ id: mine, name: 'Luna' });
    expect((await fresh(() => api(`/api/pets/${mine}`))).json.pet.helpCase).toEqual({ id: caseId, need: 'cirugia' });
  });
});

describe('what donors see', () => {
  it('open cases from verified shelters with accounts; never drafts', async () => {
    const { owner, id, caseId } = await openCase();
    const draft = (await create(id, owner.cookie, { ...luna, name: 'Borrador' })).json.case.id as string;
    const list = (await publicList()).json.cases.map((k: { id: string }) => k.id);
    expect(list).toContain(caseId);
    expect(list).not.toContain(draft);
    expect((await publicCase(draft)).status).toBe(404);

    const page = (await publicCase(caseId)).json.case;
    expect(page).toMatchObject({ name: 'Luna', need: 'cirugia', costDop: 35000, alsoNeeded: luna.alsoNeeded, story: luna.story, shelter: { id, name: 'Patas Unidas' } });
    expect(page.shelter.donation.accounts).toHaveLength(1);
    expect(page.photos).toHaveLength(1);

    // Without accounts, there's nowhere to give: the case is paused.
    await api(`/api/portal/shelters/${id}/donation`, { method: 'PUT', cookie: owner.cookie, body: { accounts: [], note: null } });
    expect((await publicList()).json.cases.map((k: { id: string }) => k.id)).not.toContain(caseId);
    const paused = await publicCase(caseId);
    expect(paused.status).toBe(410);
    expect(paused.json.case.status).toBe('paused');
    expect(JSON.stringify(paused.json)).not.toContain('812-345678-9');
  });

  it('drop out of view after 60 days without news, and come back with an update', async () => {
    const { owner, caseId } = await openCase();
    await env.DB.prepare("UPDATE cases SET active_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-61 days') WHERE id = ?").bind(caseId).run();
    expect((await publicCase(caseId)).json.case.status).toBe('paused');
    expect((await api(`/api/portal/cases/${caseId}`, { cookie: owner.cookie })).json.case.stale).toBe(true);

    expect((await api(`/api/portal/cases/${caseId}/updates`, { method: 'POST', cookie: owner.cookie, body: { body: 'Corto' } })).json.error).toBe('update_too_short');
    expect((await api(`/api/portal/cases/${caseId}/updates`, { method: 'POST', cookie: owner.cookie, body: { body: 'Llámanos al 809 555 1234' } })).json.error).toBe('contact_in_text');
    const news = await api(`/api/portal/cases/${caseId}/updates`, { method: 'POST', cookie: owner.cookie, body: { body: 'Ya la operaron y está comiendo bien.' } });
    expect(news.status).toBe(201);
    const page = (await publicCase(caseId)).json.case;
    expect(page.updates.map((u: { body: string }) => u.body)).toEqual(['Ya la operaron y está comiendo bien.']);

    // News posted by mistake can be taken back.
    expect((await api(`/api/portal/cases/${caseId}/updates/${news.json.update.id}`, { method: 'DELETE', cookie: owner.cookie, body: {} })).status).toBe(200);
    expect((await publicCase(caseId)).json.case.updates).toEqual([]);
  });

  it('end with what happened, shown to old links without the accounts', async () => {
    const { owner, caseId } = await openCase();
    const end = (body: object) => api(`/api/portal/cases/${caseId}/end`, { method: 'POST', cookie: owner.cookie, body });
    expect((await end({ status: 'resolved', outcome: 'Gracias' })).json.error).toBe('outcome_too_short');
    expect((await end({ status: 'adopted', outcome: 'Gracias a todos los que ayudaron.' })).json.error).toBe('invalid_status');
    expect((await end({ status: 'resolved', outcome: 'La operaron y ya camina. ¡Gracias a todos los que ayudaron!' })).json.case.status).toBe('resolved');

    const res = await publicCase(caseId);
    expect(res.status).toBe(410);
    expect(res.json.case).toMatchObject({ status: 'resolved', outcome: 'La operaron y ya camina. ¡Gracias a todos los que ayudaron!' });
    expect(JSON.stringify(res.json)).not.toContain('812-345678-9');
    expect((await publicList()).json.cases.map((k: { id: string }) => k.id)).not.toContain(caseId);
    // An ended case stays as it ended.
    expect((await save(caseId, owner.cookie, luna)).json.error).toBe('case_ended');
    expect((await addPhoto(caseId, owner.cookie)).json.error).toBe('case_ended');
    expect((await end({ status: 'closed', outcome: 'Otra cosa distinta pasó al final.' })).json.error).toBe('not_open');
  });

  it('get a link preview of their own', async () => {
    const { caseId } = await openCase();
    forgetCatalogVersion();
    const res = await exports.default.fetch(new Request(`${ORIGIN}/caso/${caseId}`));
    const page = await res.text();
    expect(page).toContain('<meta property="og:title" content="Luna necesita tu ayuda" />');
    expect(page).toContain('Necesita una cirugía · costo estimado RD$35,000 · Patas Unidas');
    expect((await exports.default.fetch(new Request(`${ORIGIN}/caso/no-existe`))).status).toBe(404);
  });
});

describe('case photos', () => {
  it('an open case keeps one; a draft can be deleted with all of them', async () => {
    const { owner, id, caseId } = await openCase();
    const photo = (await api(`/api/portal/cases/${caseId}`, { cookie: owner.cookie })).json.case.photos[0].id as string;
    expect((await api(`/api/portal/cases/${caseId}/photos/${photo}`, { method: 'DELETE', cookie: owner.cookie, body: {} })).json.error).toBe('last_photo');
    expect((await api(`/api/portal/cases/${caseId}`, { method: 'DELETE', cookie: owner.cookie, body: {} })).json.error).toBe('not_draft');

    const draft = (await create(id, owner.cookie)).json.case.id as string;
    const key = (await addPhoto(draft, owner.cookie)).json.photo.url.split('/').pop();
    expect(await env.PHOTOS.head(decodeURIComponent(key))).not.toBeNull();
    expect((await api(`/api/portal/cases/${draft}`, { method: 'DELETE', cookie: owner.cookie, body: {} })).status).toBe(200);
    expect(await env.PHOTOS.head(decodeURIComponent(key))).toBeNull();
  });

  it('are trimmed to the main one 90 days after the case ends', async () => {
    const { owner, caseId } = await openCase();
    await addPhoto(caseId, owner.cookie);
    await api(`/api/portal/cases/${caseId}/end`, { method: 'POST', cookie: owner.cookie, body: { status: 'closed', outcome: 'No sobrevivió a la cirugía. Gracias por acompañarla.' } });
    await env.DB.prepare("UPDATE cases SET ended_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-91 days') WHERE id = ?").bind(caseId).run();
    expect((await trimEndedCasePhotos(env)).photos).toBeGreaterThanOrEqual(1);
    const left = await env.DB.prepare('SELECT count(*) AS n FROM case_photos WHERE case_id = ?').bind(caseId).first<{ n: number }>();
    expect(left?.n).toBe(1);
  });
});

describe('contactNumbers', () => {
  it('finds phones and account numbers, not amounts or dates', () => {
    expect(contactNumbers('Llama al (809) 555-1234 o al +1 829 555 0000')).toEqual(['555-1234', '1 829 555 0000']);
    expect(contactNumbers('Cuenta 812-345678-9')).toEqual(['812-345678-9']);
    expect(contactNumbers('Cuesta RD$35,000, unos 1.500.000 en total, el 28-10-2026 o 2026-10-28')).toEqual([]);
  });
});
