import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetCatalogVersion } from '../src/cache';
import { addPhoto, api, fakeJpeg, fakeWebp, signIn } from './helpers';

// Photo uploads (PAT-9): who may upload, what bytes are accepted, the limits, and how photos are served.

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const listing = (over: Record<string, unknown> = {}) => ({
  species: 'perro', name: 'Canela', sex: 'hembra', birthDate: daysAgo(400), birthDateEstimated: true, size: 'mediano', energy: 'media',
  story: 'La encontramos en el malecón; es cariñosa y le encanta pasear.', ...over,
});

async function draftPet() {
  const owner = await signIn();
  const sid = `sh-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status) VALUES (?, ?, 'Refugio Fotos', 'gazcue-distrito-nacional', 'verified')").bind(sid, sid).run();
  await env.DB.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'owner')").bind(sid, owner.id).run();
  const petId = (await api(`/api/portal/shelters/${sid}/pets`, { method: 'POST', cookie: owner.cookie, body: listing() })).json.pet.id as string;
  return { owner, sid, petId };
}

const upload = (petId: string, cookie: string, body: Record<string, unknown>) => api(`/api/portal/pets/${petId}/photos`, { method: 'POST', cookie, body });
const b64text = (s: string) => btoa(s);

beforeEach(() => forgetCatalogVersion());

describe('who can upload', () => {
  it('only signed-in members of the animal’s shelter', async () => {
    const { petId } = await draftPet();
    const stranger = await signIn();
    expect((await addPhoto(petId, '')).status).toBe(401);
    expect((await addPhoto(petId, stranger.cookie)).status).toBe(404);
  });

  it('not from another site', async () => {
    const { petId, owner } = await draftPet();
    const res = await api(`/api/portal/pets/${petId}/photos`, { method: 'POST', cookie: owner.cookie, origin: 'https://evil.example', body: { image: fakeJpeg(1600, 1200), thumb: fakeWebp(480, 360) } });
    expect(res.status).toBe(403);
  });

  it('not while the shelter is suspended', async () => {
    const { petId, owner, sid } = await draftPet();
    await env.DB.prepare("UPDATE shelters SET status = 'suspended' WHERE id = ?").bind(sid).run();
    expect((await addPhoto(petId, owner.cookie)).json.error).toBe('shelter_suspended');
  });
});

describe('what is accepted', () => {
  it('stores a real image under a key the server chose, and serves it safely', async () => {
    const { petId, owner } = await draftPet();
    const res = await addPhoto(petId, owner.cookie, { focus: '70% 30%' });
    expect(res.status).toBe(201);
    expect(res.json.photo.url).toMatch(/^\/api\/photos\/pets%2F[a-z0-9-]+%2F[0-9a-f]{32}\.jpg$/);
    const served = await api(res.json.photo.url);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/jpeg');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(served.headers.get('content-security-policy')).toContain('sandbox');
    expect(served.headers.get('cache-control')).toContain('immutable');
    expect((await api(res.json.photo.thumb)).headers.get('content-type')).toBe('image/webp');
  });

  it('serves the same photo again from the edge cache with the API headers', async () => {
    const { petId, owner } = await draftPet();
    const url = (await addPhoto(petId, owner.cookie)).json.photo.url as string;
    await api(url); // fills the cache (waitUntil)
    const again = await api(url);
    expect(again.status).toBe(200);
    expect(again.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('rejects anything that isn’t a JPEG or WebP, whatever it claims', async () => {
    const { petId, owner } = await draftPet();
    const svg = b64text('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
    const html = b64text('<!doctype html><script>alert(1)</script>');
    expect((await upload(petId, owner.cookie, { image: svg, thumb: fakeWebp(480, 360) })).json.error).toBe('invalid_image');
    expect((await upload(petId, owner.cookie, { image: fakeJpeg(1600, 1200), thumb: html })).json.error).toBe('thumb_invalid_image');
    expect((await upload(petId, owner.cookie, { image: 'not base64!', thumb: fakeWebp(480, 360) })).json.error).toBe('image_too_large');
  });

  it('rejects photos carrying camera metadata (GPS lives there)', async () => {
    const { petId, owner } = await draftPet();
    expect((await upload(petId, owner.cookie, { image: fakeJpeg(1600, 1200, { exif: true }), thumb: fakeWebp(480, 360) })).json.error).toBe('invalid_image');
  });

  it('checks dimensions and sizes', async () => {
    const { petId, owner } = await draftPet();
    expect((await upload(petId, owner.cookie, { image: fakeJpeg(4000, 3000), thumb: fakeWebp(480, 360) })).json.error).toBe('invalid_dimensions');
    expect((await upload(petId, owner.cookie, { image: fakeJpeg(1600, 1200), thumb: fakeWebp(1600, 1200) })).json.error).toBe('thumb_invalid_dimensions');
    // Over the image limit but within the request limit; then a request too large to even read.
    expect((await upload(petId, owner.cookie, { image: fakeJpeg(1600, 1200, { extra: 650_000 }), thumb: fakeWebp(480, 360) })).json.error).toBe('image_too_large');
    expect((await upload(petId, owner.cookie, { image: fakeJpeg(1600, 1200, { extra: 900_000 }), thumb: fakeWebp(480, 360) })).status).toBe(413);
  });

  it('refuses a bad focus point', async () => {
    const { petId, owner } = await draftPet();
    expect((await addPhoto(petId, owner.cookie, { focus: '150% 20%' })).json.error).toBe('invalid_focus');
    expect((await addPhoto(petId, owner.cookie, { focus: 'center; background:url(x)' })).json.error).toBe('invalid_focus');
  });

  it('serves nothing outside the photo keys', async () => {
    expect((await api('/api/photos/..%2F..%2Fsecret')).status).toBe(404);
    expect((await api(`/api/photos/${encodeURIComponent('pets/x/' + 'a'.repeat(32) + '.jpg')}`)).status).toBe(404);
  });
});

describe('limits', () => {
  it('five photos per animal', async () => {
    const { petId, owner } = await draftPet();
    for (let i = 0; i < 5; i++) expect((await addPhoto(petId, owner.cookie)).status).toBe(201);
    expect((await addPhoto(petId, owner.cookie)).json.error).toBe('photos_full');
  });

  it('a daily budget per person that deleting doesn’t refill', async () => {
    const { petId, owner } = await draftPet();
    const day = new Date().toISOString().slice(0, 10);
    await env.DB.prepare('INSERT INTO photo_quota (day, user_id, n) VALUES (?, ?, 99)').bind(day, owner.id).run();
    const ok = await addPhoto(petId, owner.cookie);
    expect(ok.status).toBe(201);
    await api(`/api/portal/pets/${petId}/photos/${ok.json.photo.id}`, { method: 'DELETE', cookie: owner.cookie, body: {} });
    expect((await addPhoto(petId, owner.cookie)).json.error).toBe('upload_limit');
  });

  it('stops before the storage ceiling', async () => {
    const { petId, owner } = await draftPet();
    await env.DB.prepare('UPDATE photo_storage SET bytes = ? WHERE id = 1').bind(8 * 1024 ** 3).run();
    expect((await addPhoto(petId, owner.cookie)).json.error).toBe('storage_full');
    await env.DB.prepare('UPDATE photo_storage SET bytes = 0 WHERE id = 1').run();
  });

  it('the same photo twice is refused', async () => {
    const { petId, owner } = await draftPet();
    const body = { image: fakeJpeg(1600, 1200), thumb: fakeWebp(480, 360) };
    expect((await upload(petId, owner.cookie, body)).status).toBe(201);
    expect((await upload(petId, owner.cookie, body)).json.error).toBe('duplicate_photo');
  });
});

describe('arranging and removing', () => {
  it('reorders and reframes; the first is the cover adopters see', async () => {
    const { petId, owner } = await draftPet();
    const a = (await addPhoto(petId, owner.cookie)).json.photo;
    const b = (await addPhoto(petId, owner.cookie)).json.photo;
    const put = (photos: unknown) => api(`/api/portal/pets/${petId}/photos`, { method: 'PUT', cookie: owner.cookie, body: { photos } });
    expect((await put([{ id: b.id, focus: '80% 35%' }])).json.error).toBe('invalid_order'); // must list every photo
    expect((await put([{ id: b.id, focus: 'x' }, { id: a.id, focus: '50% 40%' }])).json.error).toBe('invalid_order');
    expect((await put([{ id: b.id, focus: '80% 35%' }, { id: a.id, focus: '50% 40%' }])).status).toBe(200);
    await api(`/api/portal/pets/${petId}`, { method: 'PUT', cookie: owner.cookie, body: { ...listing(), publish: true } });
    forgetCatalogVersion();
    const pet = (await api(`/api/pets/${petId}`)).json.pet;
    expect(pet.photo).toMatchObject({ url: b.url, thumb: b.thumb, focus: '80% 35%' });
    expect(pet.photos.map((p: { url: string }) => p.url)).toEqual([b.url, a.url]);
  });

  it('a live animal keeps at least one photo, and removed photos leave storage', async () => {
    const { petId, owner } = await draftPet();
    const a = (await addPhoto(petId, owner.cookie)).json.photo;
    await api(`/api/portal/pets/${petId}`, { method: 'PUT', cookie: owner.cookie, body: { ...listing(), publish: true } });
    const del = (id: string) => api(`/api/portal/pets/${petId}/photos/${id}`, { method: 'DELETE', cookie: owner.cookie, body: {} });
    expect((await del(a.id)).json.error).toBe('last_photo');
    const b = (await addPhoto(petId, owner.cookie)).json.photo;
    expect((await del(a.id)).status).toBe(200);
    expect((await api(a.url)).status).toBe(404);
    expect((await api(b.url)).status).toBe(200);
  });
});
