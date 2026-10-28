import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetCatalogVersion } from '../src/cache';
import { trimLostFoundPhotos } from '../src/lostfound';
import { api, fakeJpeg, fakeWebp, ORIGIN, signIn } from './helpers';

// Lost and found (migration 0026, owner decision 2026-10-28): verified shelters post animals someone lost or
// found, people who respond call the shelter's public phone, posts carry no other numbers, and they stay up 30
// days unless renewed.

const application = {
  name: 'Huellas Perdidas',
  placeId: 'gazcue-distrito-nacional',
  contactName: 'Luis Gómez',
  contactPhone: '809-555-0101',
  publicPhone: '809-555-0100',
  address: 'Calle Las Flores 12, Gazcue',
  history: 'Llevamos cinco años rescatando, con unos 40 animales al año y hogares temporales.',
  reference: { name: 'Clínica Vet Centro', contact: '809-555-0202', kind: 'veterinaria' },
  rules: true,
};
const today = () => new Date().toISOString().slice(0, 10);
const bruno = () => ({
  kind: 'perdido',
  species: 'perro',
  name: 'Bruno',
  sex: 'macho',
  description: 'Mestizo marrón, mediano, collar rojo con placa. Responde a su nombre y es tímido con extraños.',
  placeId: 'gazcue-distrito-nacional',
  seenOn: today(),
});

async function shelter(opts: { verified?: boolean } = {}) {
  const owner = await signIn({ owner: true });
  const id = (await api('/api/portal/shelters', { method: 'POST', cookie: owner.cookie, body: application })).json.shelter.id as string;
  if (opts.verified !== false) {
    const admin = await signIn({ admin: true });
    await api(`/api/admin/shelters/${id}/decision`, { method: 'POST', cookie: admin.cookie, body: { action: 'verify' } });
  }
  return { owner, id };
}
const create = (shelterId: string, cookie: string, body: object = bruno()) => api(`/api/portal/shelters/${shelterId}/lost`, { method: 'POST', cookie, body });
const save = (postId: string, cookie: string, body: object) => api(`/api/portal/lost/${postId}`, { method: 'PUT', cookie, body });
const addPhoto = (postId: string, cookie: string) =>
  api(`/api/portal/lost/${postId}/photos`, { method: 'POST', cookie, body: { image: fakeJpeg(1600, 1200), thumb: fakeWebp(480, 360) } });
const fresh = <T>(read: () => Promise<T>) => (forgetCatalogVersion(), read());
const publicPost = (id: string) => fresh(() => api(`/api/lost/${id}`));
const publicIds = async () => ((await fresh(() => api('/api/lost'))).json.posts as { id: string }[]).map((l) => l.id);

async function openPost(body: object = bruno()) {
  const s = await shelter();
  const id = (await create(s.id, s.owner.cookie, body)).json.post.id as string;
  expect((await addPhoto(id, s.owner.cookie)).status).toBe(201);
  expect((await save(id, s.owner.cookie, { ...body, publish: true })).json.post.status).toBe('open');
  return { ...s, postId: id };
}

beforeEach(() => forgetCatalogVersion());

describe('who can post', () => {
  it('members of a verified shelter and admins; not strangers, private listers or shelters in review', async () => {
    const { owner, id } = await shelter();
    const stranger = await signIn();
    const admin = await signIn({ admin: true });
    expect((await create(id, owner.cookie)).status).toBe(201);
    expect((await create(id, admin.cookie)).status).toBe(201);
    expect((await create(id, stranger.cookie)).status).toBe(404);
    expect((await api(`/api/portal/shelters/${id}/lost`, { method: 'POST', body: bruno() })).status).toBe(401);

    const pending = await shelter({ verified: false });
    expect((await create(pending.id, pending.owner.cookie)).json.error).toBe('shelter_not_verified');

    const person = await signIn();
    const priv = `private-${person.id}`;
    await env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status, kind, phone) VALUES (?, ?, 'Particular · Prueba', 'gazcue-distrito-nacional', 'verified', 'private', '+18095550000')").bind(priv, priv).run();
    await env.DB.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'owner')").bind(priv, person.id).run();
    expect((await create(priv, person.cookie)).json.error).toBe('not_for_private');
  });

  it('checks every field, and refuses phone numbers in the text', async () => {
    const { owner, id } = await shelter();
    const bad = async (over: object) => (await create(id, owner.cookie, { ...bruno(), ...over })).json;
    expect((await bad({ kind: 'robado' })).error).toBe('invalid_kind');
    expect((await bad({ species: 'loro' })).error).toBe('invalid_species');
    expect((await bad({ sex: 'otro' })).error).toBe('invalid_sex');
    expect((await bad({ placeId: 'no-existe' })).error).toBe('invalid_place');
    expect((await bad({ seenOn: '2020-01-01' })).error).toBe('invalid_seen_on');
    expect((await bad({ seenOn: '2099-01-01' })).error).toBe('invalid_seen_on');
    expect(await bad({ description: 'Si lo ves llama a su dueña al 829-555-3333.' })).toEqual({ error: 'contact_in_text', numbers: ['829-555-3333'] });
    // A found animal often has no known name or sex.
    expect((await create(id, owner.cookie, { ...bruno(), kind: 'encontrado', name: '', sex: null })).status).toBe(201);
  });

  it('needs the shelter\'s public phone, a description and a photo to publish', async () => {
    const { owner, id } = await shelter();
    await env.DB.prepare('UPDATE shelters SET phone = NULL WHERE id = ?').bind(id).run();
    const postId = (await create(id, owner.cookie, { ...bruno(), description: 'Marrón.' })).json.post.id as string;
    expect((await save(postId, owner.cookie, { ...bruno(), description: 'Marrón.', publish: true })).json.error).toBe('no_public_phone');
    await api(`/api/portal/shelters/${id}/phone`, { method: 'PUT', cookie: owner.cookie, body: { phone: '809-555-0100' } });
    expect((await save(postId, owner.cookie, { ...bruno(), description: 'Marrón.', publish: true })).json.error).toBe('description_required');
    expect((await save(postId, owner.cookie, { ...bruno(), publish: true })).json.error).toBe('photo_required');
    await addPhoto(postId, owner.cookie);
    expect((await save(postId, owner.cookie, { ...bruno(), publish: true })).json.post.status).toBe('open');
  });
});

describe('what people see', () => {
  it('open posts with where and when, and the shelter\'s phone to call', async () => {
    const { owner, id, postId } = await openPost();
    const draft = (await create(id, owner.cookie)).json.post.id as string;
    const ids = await publicIds();
    expect(ids).toContain(postId);
    expect(ids).not.toContain(draft);
    const post = (await publicPost(postId)).json.post;
    expect(post).toMatchObject({ kind: 'perdido', name: 'Bruno', sex: 'macho', seenOn: today(), place: { id: 'gazcue-distrito-nacional' }, shelter: { id, name: 'Huellas Perdidas', phone: '+18095550100' } });
    expect(post.place.lat).toBeTypeOf('number');
    expect(post.photos).toHaveLength(1);

    // Without a phone there's no one to call: the post is hidden.
    await env.DB.prepare('UPDATE shelters SET phone = NULL WHERE id = ?').bind(id).run();
    expect(await publicIds()).not.toContain(postId);
  });

  it('drop out after 30 days unless renewed', async () => {
    const { owner, postId } = await openPost();
    await env.DB.prepare("UPDATE lost_found SET active_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-31 days') WHERE id = ?").bind(postId).run();
    const lapsed = await publicPost(postId);
    expect(lapsed.status).toBe(410);
    expect(lapsed.json.post.status).toBe('expired');
    expect(JSON.stringify(lapsed.json)).not.toContain('8095550100');
    expect((await api(`/api/portal/lost/${postId}`, { cookie: owner.cookie })).json.post.expired).toBe(true);
    expect((await api(`/api/portal/lost/${postId}/renew`, { method: 'POST', cookie: owner.cookie, body: {} })).status).toBe(200);
    expect(await publicIds()).toContain(postId);
  });

  it('end when the animal is home, and old links say so', async () => {
    const { owner, postId } = await openPost();
    const end = (status: string) => api(`/api/portal/lost/${postId}/end`, { method: 'POST', cookie: owner.cookie, body: { status } });
    expect((await end('found')).json.error).toBe('invalid_status');
    expect((await end('home')).json.post.status).toBe('home');
    const res = await publicPost(postId);
    expect(res.status).toBe(410);
    expect(res.json.post).toMatchObject({ status: 'home', name: 'Bruno' });
    expect(await publicIds()).not.toContain(postId);
    expect((await save(postId, owner.cookie, bruno())).json.error).toBe('post_ended');
    expect((await addPhoto(postId, owner.cookie)).json.error).toBe('post_ended');
    expect((await end('closed')).json.error).toBe('not_open');
  });

  it('get a link preview of their own', async () => {
    const { postId } = await openPost({ ...bruno(), kind: 'encontrado', name: '', sex: 'hembra' });
    forgetCatalogVersion();
    const page = await (await exports.default.fetch(new Request(`${ORIGIN}/perdidos/${postId}`))).text();
    expect(page).toContain('<meta property="og:title" content="Perra encontrada en Gazcue" />');
    expect(page).toContain('¿Es tuyo? Pregunta a Huellas Perdidas');
  });
});

describe('lost and found photos', () => {
  it('a draft is deleted with its photos; an open post keeps one; old ones are trimmed', async () => {
    const { owner, id, postId } = await openPost();
    const photo = (await api(`/api/portal/lost/${postId}`, { cookie: owner.cookie })).json.post.photos[0].id as string;
    expect((await api(`/api/portal/lost/${postId}/photos/${photo}`, { method: 'DELETE', cookie: owner.cookie, body: {} })).json.error).toBe('last_photo');

    const draft = (await create(id, owner.cookie)).json.post.id as string;
    const key = decodeURIComponent((await addPhoto(draft, owner.cookie)).json.photo.url.split('/').pop());
    expect(key.startsWith('lost/')).toBe(true);
    expect((await api(`/api/portal/lost/${draft}`, { method: 'DELETE', cookie: owner.cookie, body: {} })).status).toBe(200);
    expect(await env.PHOTOS.head(key)).toBeNull();

    await addPhoto(postId, owner.cookie);
    await api(`/api/portal/lost/${postId}/end`, { method: 'POST', cookie: owner.cookie, body: { status: 'home' } });
    await env.DB.prepare("UPDATE lost_found SET ended_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-91 days') WHERE id = ?").bind(postId).run();
    expect((await trimLostFoundPhotos(env)).photos).toBeGreaterThanOrEqual(1);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM lost_found_photos WHERE post_id = ?').bind(postId).first<{ n: number }>())?.n).toBe(1);
  });
});
