import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { api, signIn } from './helpers';

// Two owner decisions (2026-10-15): adoption fees are capped at RD$2,000 unless an admin raises a shelter's
// cap; and a suspended shelter's owner can ask for a review, which an admin lifts or keeps with a note.

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const listing = (fee: number | null) => ({
  species: 'perro', name: 'Canela', sex: 'hembra', birthDate: daysAgo(400), birthDateEstimated: true, size: 'mediano', energy: 'media',
  goodWith: { kids: true, dogs: null, cats: false }, health: { vaccinated: true, sterilized: false, dewormed: true },
  story: 'La encontramos en el malecón; es cariñosa y le encanta pasear.', needs: [], adoptionFeeDop: fee,
});

async function shelter(status = 'verified') {
  const owner = await signIn();
  const id = `sh-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status) VALUES (?, ?, 'Refugio Cuota', 'gazcue-distrito-nacional', ?)").bind(id, id, status).run();
  await env.DB.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'owner')").bind(id, owner.id).run();
  return { id, owner };
}
const create = (sid: string, cookie: string, fee: number | null) => api(`/api/portal/shelters/${sid}/pets`, { method: 'POST', cookie, body: listing(fee) });
const setCap = (cookie: string, sid: string, capDop: number | null) => api(`/api/admin/shelters/${sid}/fee-cap`, { method: 'POST', cookie, body: { capDop } });

describe('adoption fee cap', () => {
  it('allows up to RD$2,000 by default, and says the cap when it’s over', async () => {
    const s = await shelter();
    expect((await create(s.id, s.owner.cookie, 2000)).status).toBe(201);
    const over = await create(s.id, s.owner.cookie, 2001);
    expect(over.json).toEqual({ error: 'fee_over_cap', cap: 2000 });
    expect((await api(`/api/portal/shelters/${s.id}/pets`, { cookie: s.owner.cookie })).json.shelter.feeCapDop).toBe(2000);
  });

  it('follows a cap an admin raised, and only admins can change it', async () => {
    const admin = await signIn({ admin: true });
    const s = await shelter();
    expect((await setCap(s.owner.cookie, s.id, 5000)).status).toBe(404);
    expect((await setCap(admin.cookie, s.id, 50001)).json.error).toBe('invalid_fee');
    expect((await setCap(admin.cookie, s.id, 5000)).json.shelter.feeCapDop).toBe(5000);
    expect((await create(s.id, s.owner.cookie, 4500)).status).toBe(201);
    expect((await create(s.id, s.owner.cookie, 5500)).json.cap).toBe(5000);
    // Back to the default.
    expect((await setCap(admin.cookie, s.id, null)).json.shelter.feeCapDop).toBe(2000);
    const row = await env.DB.prepare('SELECT fee_cap_dop FROM shelters WHERE id = ?').bind(s.id).first<{ fee_cap_dop: number | null }>();
    expect(row!.fee_cap_dop).toBeNull();
  });

  it('lets a listing keep a fee it already had above a lowered cap, but not raise it', async () => {
    const admin = await signIn({ admin: true });
    const s = await shelter();
    await setCap(admin.cookie, s.id, 4000);
    const id = (await create(s.id, s.owner.cookie, 3500)).json.pet.id;
    await setCap(admin.cookie, s.id, null);
    const save = (fee: number) => api(`/api/portal/pets/${id}`, { method: 'PUT', cookie: s.owner.cookie, body: { ...listing(fee), name: 'Canela Linda' } });
    expect((await save(3500)).status).toBe(200);
    expect((await save(3600)).json.error).toBe('fee_over_cap');
    expect((await save(1800)).status).toBe(200);
  });
});

const review = (sid: string, cookie: string, message: string) => api(`/api/portal/shelters/${sid}/review`, { method: 'POST', cookie, body: { message } });
const WHY = 'Ya corregimos la publicación que tenía un precio y no volverá a pasar.';
const emails = async (kind: string) => (await env.DB.prepare('SELECT count(*) AS n FROM email_log WHERE kind = ?').bind(kind).first<{ n: number }>())!.n;

describe('asking to lift a suspension', () => {
  it('is for the owner of a suspended shelter, with a real explanation', async () => {
    const ok = await shelter('verified');
    expect((await review(ok.id, ok.owner.cookie, WHY)).json.error).toBe('not_suspended');
    const s = await shelter('suspended');
    const stranger = await signIn();
    expect((await review(s.id, stranger.cookie, WHY)).status).toBe(404);
    expect((await review(s.id, s.owner.cookie, 'Fue un error')).json.error).toBe('message_too_short');
  });

  it('waits one at a time, emails the admins, and shows on the owner’s card and the admin queue', async () => {
    const admin = await signIn({ admin: true });
    const s = await shelter('suspended');
    const before = await emails('review_admin');
    const sent = await review(s.id, s.owner.cookie, WHY);
    expect(sent.status).toBe(201);
    expect(sent.json.review).toMatchObject({ status: 'pending', message: WHY });
    expect(await emails('review_admin')).toBeGreaterThan(before);
    expect((await review(s.id, s.owner.cookie, WHY)).json.error).toBe('already_pending');

    const mine = (await api('/api/portal/shelters', { cookie: s.owner.cookie })).json.shelters.find((x: { id: string }) => x.id === s.id);
    expect(mine.review).toMatchObject({ status: 'pending' });
    const queue = (await api('/api/admin/shelters?status=suspended', { cookie: admin.cookie })).json;
    expect(queue.pendingReviews).toBeGreaterThan(0);
    expect(queue.shelters.find((x: { id: string }) => x.id === s.id).review).toMatchObject({ message: WHY });
    const summary = (await api('/api/admin/summary', { cookie: admin.cookie })).json;
    expect(summary.shelters).toBeGreaterThan(0);
  });

  it('kept: needs a note, emails the owner, and the owner can ask again later', async () => {
    const admin = await signIn({ admin: true });
    const s = await shelter('suspended');
    await review(s.id, s.owner.cookie, WHY);
    const keep = (note?: string) => api(`/api/admin/shelters/${s.id}/review/keep`, { method: 'POST', cookie: admin.cookie, body: { note } });
    expect((await keep()).json.error).toBe('reason_required');
    expect((await keep('Necesitamos ver el acuerdo de adopción que usan.')).status).toBe(200);
    expect((await keep('otra vez')).status).toBe(409);
    const mine = (await api('/api/portal/shelters', { cookie: s.owner.cookie })).json.shelters.find((x: { id: string }) => x.id === s.id);
    expect(mine.review).toMatchObject({ status: 'kept', note: 'Necesitamos ver el acuerdo de adopción que usan.' });
    expect((await review(s.id, s.owner.cookie, WHY)).status).toBe(201);
  });

  it('lifted: verifying the shelter again answers the request', async () => {
    const admin = await signIn({ admin: true });
    const s = await shelter('suspended');
    await review(s.id, s.owner.cookie, WHY);
    expect((await api(`/api/admin/shelters/${s.id}/decision`, { method: 'POST', cookie: admin.cookie, body: { action: 'verify' } })).status).toBe(200);
    const row = await env.DB.prepare('SELECT status FROM shelter_reviews WHERE shelter_id = ?').bind(s.id).first<{ status: string }>();
    expect(row!.status).toBe('lifted');
  });

  it('allows three in 90 days', async () => {
    const admin = await signIn({ admin: true });
    const s = await shelter('suspended');
    for (let i = 0; i < 3; i++) {
      expect((await review(s.id, s.owner.cookie, WHY)).status).toBe(201);
      await api(`/api/admin/shelters/${s.id}/review/keep`, { method: 'POST', cookie: admin.cookie, body: { note: 'Todavía no.' } });
    }
    expect((await review(s.id, s.owner.cookie, WHY)).status).toBe(429);
  });
});
