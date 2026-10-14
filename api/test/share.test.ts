import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { safeNext } from '../src/auth/routes';
import { forgetCatalogVersion } from '../src/cache';
import { addPhoto, ORIGIN, signIn } from './helpers';

// Shareable pet links (PAT-32): /mascota/<id> is the app with the pet's link-preview tags.

async function page(path: string) {
  const res = await exports.default.fetch(new Request(`${ORIGIN}${path}`));
  return { status: res.status, html: await res.text() };
}
const meta = (html: string, prop: string) => html.match(new RegExp(`<meta property="${prop}" content="([^"]*)"`))?.[1] ?? null;

async function pet(name: string, over: { status?: string; sex?: string } = {}) {
  const owner = await signIn();
  const sid = `sh-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status, verified_at) VALUES (?, ?, 'Patitas de Prueba', 'gazcue-distrito-nacional', 'verified', '2026-01-01T00:00:00Z')").bind(sid, sid).run();
  await env.DB.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'owner')").bind(sid, owner.id).run();
  const id = `${sid}-p`;
  await env.DB.prepare(
    "INSERT INTO pets (id, listed_by, shelter_id, place_id, name, sex, size, energy, status, birth_date, birth_date_estimated, story, published_at) VALUES (?, ?, ?, 'gazcue-distrito-nacional', ?, ?, 'mediano', 'media', ?, '2022-01-01', 1, 'Una historia de prueba bastante larga.', '2026-01-01T00:00:00Z')",
  )
    .bind(id, owner.id, sid, name, over.sex ?? 'hembra', over.status ?? 'available')
    .run();
  return { id, owner };
}

beforeEach(() => forgetCatalogVersion());

describe('a pet’s link preview', () => {
  it('names the pet, says who it is, and shows its photo (the thumbnail)', async () => {
    const { id, owner } = await pet('Canela');
    expect((await addPhoto(id, owner.cookie)).status).toBe(201);
    const thumb = (await env.DB.prepare('SELECT thumb_key FROM pet_photos WHERE pet_id = ?').bind(id).first<{ thumb_key: string }>())!.thumb_key;
    const { status, html } = await page(`/mascota/${id}`);
    expect(status).toBe(200);
    expect(html).toContain('<title>Canela busca familia · Patiamor</title>');
    expect(meta(html, 'og:title')).toBe('Canela busca familia');
    expect(meta(html, 'og:description')).toMatch(/^Perra · unos \d+ años · Gazcue, Santo Domingo de Guzmán · Patitas de Prueba$/);
    expect(meta(html, 'og:image')).toBe(`${ORIGIN}/api/photos/${encodeURIComponent(thumb)}`);
    expect(meta(html, 'og:url')).toBe(`${ORIGIN}/mascota/${id}`);
    // The app itself is still there, and the defaults appear once, not twice.
    expect(html).toContain('<div id="app"></div>');
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
  });

  it('escapes what shelters type', async () => {
    const { id } = await pet('Luna "<script>alert(1)</script>');
    const { html } = await page(`/mascota/${id}`);
    expect(html).not.toContain('<script>alert(1)');
    expect(meta(html, 'og:title')).toBe('Luna &#34;&#60;script&#62;alert(1)&#60;/script&#62; busca familia');
  });

  it('says an adopted pet found a home', async () => {
    const { id } = await pet('Rocky', { status: 'adopted', sex: 'macho' });
    const { html } = await page(`/mascota/${id}`);
    expect(meta(html, 'og:title')).toBe('¡Rocky ya encontró hogar!');
  });

  it('keeps the app’s defaults for an unknown pet', async () => {
    const { status, html } = await page('/mascota/no-existe');
    expect(status).toBe(200);
    expect(html).toContain('<title>Patiamor · Adopta cerca de ti</title>');
    expect(meta(html, 'og:title')).toBe('Patiamor · Adopta cerca de ti');
  });
});

describe('where sign-in returns to', () => {
  it('only in-app paths; old hash routes still work', () => {
    expect(safeNext('/mascota/canela')).toBe('/mascota/canela');
    expect(safeNext('/refugio/x/animales?ver=adoptados')).toBe('/refugio/x/animales?ver=adoptados');
    expect(safeNext('#/lista')).toBe('/lista');
    expect(safeNext('//evil.example/x')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('/\\evil.example')).toBe('/');
    expect(safeNext(undefined)).toBe('/');
  });
});
