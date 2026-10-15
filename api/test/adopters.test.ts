import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetCatalogVersion } from '../src/cache';
import { api, signIn } from './helpers';

// "Verificado por Patiamor" (PAT-2): an admin marks an adopter they've checked out or know, and the shelter
// sees the badge on that person's requests, but not how the admin knows them.

const form = (petId: string) => ({ petId, answers: { space: 'si', time: 'si', cost: 'si' }, name: 'Ana Pérez', pref: 'correo', phone: '', consent: true });

async function shelterWithPet() {
  const owner = await signIn();
  const sid = `sh-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status, verified_at) VALUES (?, ?, 'Refugio Sello', 'gazcue-distrito-nacional', 'verified', '2026-01-01T00:00:00Z')").bind(sid, sid).run();
  await env.DB.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'owner')").bind(sid, owner.id).run();
  const pet = `${sid}-luna`;
  await env.DB.prepare("INSERT INTO pets (id, listed_by, shelter_id, place_id, name, sex, size, energy, status, birth_date) VALUES (?, ?, ?, 'gazcue-distrito-nacional', 'Luna', 'hembra', 'mediano', 'media', 'available', '2022-01-01')")
    .bind(pet, owner.id, sid)
    .run();
  return { owner, sid, pet };
}

const lookup = (cookie: string, email: string) => api(`/api/admin/adopters/lookup?email=${encodeURIComponent(email)}`, { cookie });
const verify = (cookie: string, id: string, note?: string) => api(`/api/admin/adopters/${id}/verify`, { method: 'POST', cookie, body: { note } });
const unverify = (cookie: string, id: string, note?: string) => api(`/api/admin/adopters/${id}/unverify`, { method: 'POST', cookie, body: { note } });

beforeEach(() => forgetCatalogVersion());

describe('verified adopters', () => {
  it('is for admins only', async () => {
    const u = await signIn();
    expect((await api('/api/admin/adopters', { cookie: u.cookie })).status).toBe(404);
    expect((await lookup(u.cookie, u.email)).status).toBe(404);
    expect((await verify(u.cookie, u.id, 'yo mismo')).status).toBe(404);
    expect((await unverify(u.cookie, u.id)).status).toBe(404);
  });

  it('finds a person by email, whatever the capitals, and nobody for an unknown email', async () => {
    const admin = await signIn({ admin: true });
    const ana = await signIn({ name: 'Ana Sello' });
    const found = await lookup(admin.cookie, ana.email.toUpperCase());
    expect(found.json.adopter).toMatchObject({ id: ana.id, who: { email: ana.email }, verified: null, requests: { open: 0, adopted: 0, withdrawn90: 0 } });
    expect((await lookup(admin.cookie, 'nadie-aqui@example.com')).json.adopter).toBeNull();
    expect((await lookup(admin.cookie, 'no es un correo')).status).toBe(400);
  });

  it('needs a note saying how you know them, and gives the badge once', async () => {
    const admin = await signIn({ admin: true });
    const ana = await signIn();
    expect((await verify(admin.cookie, ana.id, '  ')).json.error).toBe('reason_required');
    expect((await verify(admin.cookie, ana.id, 'Adoptó a Luna con Hogar Gazcue')).status).toBe(200);
    expect((await verify(admin.cookie, ana.id, 'otra vez')).status).toBe(409);
    expect((await verify(admin.cookie, 'no-such-user', 'x')).status).toBe(404);

    const found = (await lookup(admin.cookie, ana.email)).json.adopter;
    expect(found.verified).toMatchObject({ note: 'Adoptó a Luna con Hogar Gazcue' });
    expect(found.verified.by).toBeTruthy();
    const list = (await api('/api/admin/adopters', { cookie: admin.cookie })).json.adopters as { id: string }[];
    expect(list.some((a) => a.id === ana.id)).toBe(true);
    const logged = await env.DB.prepare("SELECT count(*) AS n FROM admin_actions WHERE action = 'adopter.verify' AND subject_id = ?").bind(ana.id).first<{ n: number }>();
    expect(logged!.n).toBe(1);
  });

  it('shows the shelter the badge on requests, without the note', async () => {
    const admin = await signIn({ admin: true });
    const { owner, sid, pet } = await shelterWithPet();
    const ana = await signIn();
    await api('/api/requests', { method: 'POST', cookie: ana.cookie, body: form(pet) });
    const inbox = async () => (await api(`/api/portal/shelters/${sid}/requests`, { cookie: owner.cookie })).json.requests[0];

    expect((await inbox()).verified).toBe(false);
    await verify(admin.cookie, ana.id, 'Nota privada del admin');
    const seen = await inbox();
    expect(seen.verified).toBe(true);
    expect(JSON.stringify(seen)).not.toContain('Nota privada');

    await unverify(admin.cookie, ana.id, 'Me equivoqué de persona');
    expect((await inbox()).verified).toBe(false);
    expect((await unverify(admin.cookie, ana.id)).status).toBe(409);
    const list = (await api('/api/admin/adopters', { cookie: admin.cookie })).json.adopters as { id: string }[];
    expect(list.some((a) => a.id === ana.id)).toBe(false);
  });

  it('counts the person’s requests so far', async () => {
    const admin = await signIn({ admin: true });
    const { pet } = await shelterWithPet();
    const ana = await signIn();
    await api('/api/requests', { method: 'POST', cookie: ana.cookie, body: form(pet) });
    expect((await lookup(admin.cookie, ana.email)).json.adopter.requests).toEqual({ open: 1, adopted: 0, withdrawn90: 0 });
  });
});
