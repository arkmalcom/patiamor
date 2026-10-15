import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetCatalogVersion } from '../src/cache';
import { moneyWords } from '../../web/src/money';
import { addPhoto, api, signIn } from './helpers';

// The anti-resale safeguards: the report button, where three people hide a listing (PAT-15); money
// language, which sends a listing to review (PAT-16); and what admins do with both.

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const listing = (over: Record<string, unknown> = {}) => ({
  species: 'perro', name: 'Canela', sex: 'hembra', birthDate: daysAgo(400), birthDateEstimated: true, size: 'mediano', energy: 'media',
  goodWith: { kids: true, dogs: null, cats: false }, health: { vaccinated: true, sterilized: false, dewormed: true },
  story: 'La encontramos en el malecón; es cariñosa y le encanta pasear.', needs: [], adoptionFeeDop: null, ...over,
});

async function shelter() {
  const owner = await signIn();
  const id = `sh-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status, verified_at) VALUES (?, ?, 'Refugio Reglas', 'gazcue-distrito-nacional', 'verified', '2026-01-01T00:00:00Z')").bind(id, id).run();
  await env.DB.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'owner')").bind(id, owner.id).run();
  return { id, owner };
}
/** A published listing, the app's way: a draft, its photo, then publish. */
async function published(sid: string, cookie: string, over: Record<string, unknown> = {}) {
  const id = (await api(`/api/portal/shelters/${sid}/pets`, { method: 'POST', cookie, body: listing() })).json.pet.id as string;
  await addPhoto(id, cookie);
  const res = await api(`/api/portal/pets/${id}`, { method: 'PUT', cookie, body: { ...listing(over), publish: true } });
  return { id, res };
}
const save = (id: string, cookie: string, over: Record<string, unknown>) => api(`/api/portal/pets/${id}`, { method: 'PUT', cookie, body: listing(over) });
const status = async (id: string) => (await env.DB.prepare('SELECT status FROM pets WHERE id = ?').bind(id).first<{ status: string }>())!.status;
const inCatalogue = async (id: string) => {
  forgetCatalogVersion();
  return (await api('/api/pets?lat=18.47&lng=-69.90')).json.pets.some((p: { id: string }) => p.id === id);
};
const report = (id: string, cookie: string, reason = 'venta', details?: string) => api(`/api/pets/${id}/report`, { method: 'POST', cookie, body: { reason, details } });
const emails = async (kind: string) => (await env.DB.prepare('SELECT count(*) AS n FROM email_log WHERE kind = ?').bind(kind).first<{ n: number }>())!.n;

beforeEach(() => forgetCatalogVersion());

describe('money language', () => {
  it('finds selling, prices, deposits, breeding and phone numbers', () => {
    expect(moneyWords('Se vende a buen precio, negociable')).toEqual(expect.arrayContaining(['se vende', 'precio', 'negociable']));
    expect(moneyWords('Cuesta RD$5,000 con depósito por transferencia')).toEqual(expect.arrayContaining(['rd$5,000', 'deposito', 'transferencia']));
    expect(moneyWords('solo $ 500')).toEqual(['$ 500']);
    expect(moneyWords('Llama al 809-555-1234')).toEqual(['809-555-1234']);
    expect(moneyWords('WhatsApp +1 829 555 1234')).toEqual(['+1 829 555 1234']);
    expect(moneyWords('Disponible para monta')).toEqual(['monta']);
    expect(moneyWords('Puedes reservarlo hoy')).toEqual(['reservarlo']);
  });

  it('leaves ordinary stories alone', () => {
    expect(moneyWords('Es preciosa, vacunada y desparasitada. Llegó entre 2024 - 2025 al refugio.', 'Patio grande', 'Canela')).toEqual([]);
    expect(moneyWords('Le encanta pasear y la reservamos para una familia con niños', null)).toEqual([]);
  });

  it('a listing going live with money language goes to review instead, and the shelter is told why', async () => {
    const s = await shelter();
    const { id, res } = await published(s.id, s.owner.cookie, { story: 'Cariñosa y tranquila, se entrega por RD$5,000 a quien la cuide.' });
    expect(res.json.pet.status).toBe('in_review');
    expect(res.json.review).toEqual({ reason: 'dinero', words: ['rd$5,000'] });
    expect(await inCatalogue(id)).toBe(false);
    const form = (await api(`/api/portal/pets/${id}`, { cookie: s.owner.cookie })).json.pet;
    expect(form.review).toMatchObject({ reason: 'dinero', words: ['rd$5,000'] });
  });

  it('an edit adding it to a live listing hides it; a draft keeps it until it goes live', async () => {
    const s = await shelter();
    const { id } = await published(s.id, s.owner.cookie);
    expect(await status(id)).toBe('available');
    expect((await save(id, s.owner.cookie, { needs: ['Llamar al 8095551234'] })).json.pet.status).toBe('in_review');
    const draft = (await api(`/api/portal/shelters/${s.id}/pets`, { method: 'POST', cookie: s.owner.cookie, body: listing({ story: 'Vendo esta perrita muy linda y cariñosa.' }) })).json;
    expect(draft.pet.status).toBe('draft');
  });

  it('once an admin lets it through, the same words don’t send it back; new ones do', async () => {
    const admin = await signIn({ admin: true });
    const s = await shelter();
    const story = 'Le gusta la monta en el carro y pasear por el parque.';
    const { id } = await published(s.id, s.owner.cookie, { story });
    expect(await status(id)).toBe('in_review');
    expect((await api(`/api/admin/pets/${id}/restore`, { method: 'POST', cookie: admin.cookie, body: {} })).status).toBe(200);
    expect(await status(id)).toBe('available');
    expect((await save(id, s.owner.cookie, { story })).json.pet.status).toBe('available');
    expect((await save(id, s.owner.cookie, { story: `${story} Precio a convenir.` })).json.pet.status).toBe('in_review');
  });
});

describe('reports', () => {
  it('needs an account, a reason, details for "otro", and isn’t for your own animals', async () => {
    const s = await shelter();
    const { id } = await published(s.id, s.owner.cookie);
    expect((await api(`/api/pets/${id}/report`, { method: 'POST', body: { reason: 'venta' } })).status).toBe(401);
    const u = await signIn();
    expect((await report(id, u.cookie, 'spam')).json.error).toBe('invalid_reason');
    expect((await report(id, u.cookie, 'otro', 'raro')).json.error).toBe('details_required');
    expect((await report(id, s.owner.cookie)).json.error).toBe('own_listing');
    expect((await report('nope', u.cookie)).status).toBe(404);
  });

  it('one per person; the third person hides it and the shelter is emailed, the reporter isn’t told', async () => {
    const s = await shelter();
    const { id } = await published(s.id, s.owner.cookie);
    const [a, b, c] = [await signIn(), await signIn(), await signIn()];
    expect((await report(id, a.cookie)).json).toEqual({ report: { received: true } });
    expect((await report(id, a.cookie, 'estafa')).json.error).toBe('already_reported');
    await report(id, b.cookie, 'datos_falsos');
    expect(await inCatalogue(id)).toBe(true);
    const before = await emails('listing_review');
    expect((await report(id, c.cookie, 'otro', 'Pide dinero por WhatsApp antes de visitar.')).json).toEqual({ report: { received: true } });
    expect(await status(id)).toBe('in_review');
    expect(await inCatalogue(id)).toBe(false);
    expect(await emails('listing_review')).toBe(before + 1);
    // Hidden: nobody else can report it now.
    expect((await report(id, (await signIn()).cookie)).status).toBe(404);
  });
});

describe('the admin’s review queue', () => {
  it('lists hidden and reported listings with their reports, and counts them', async () => {
    const admin = await signIn({ admin: true });
    const s = await shelter();
    const { id } = await published(s.id, s.owner.cookie);
    await report(id, (await signIn()).cookie, 'maltrato', 'Se ve muy flaco en las fotos.');
    expect((await api('/api/admin/reports', { cookie: (await signIn()).cookie })).status).toBe(404);
    const queue = (await api('/api/admin/reports', { cookie: admin.cookie })).json.pets as { id: string; review: unknown; reports: { reason: string; details: string }[] }[];
    const mine = queue.find((p) => p.id === id)!;
    expect(mine.review).toBeNull();
    expect(mine.reports).toEqual([expect.objectContaining({ reason: 'maltrato', details: 'Se ve muy flaco en las fotos.' })]);
    expect((await api('/api/admin/summary', { cookie: admin.cookie })).json.reports).toBeGreaterThan(0);
  });

  it('restore: back to what it was (en proceso stays en proceso), reports closed', async () => {
    const admin = await signIn({ admin: true });
    const s = await shelter();
    const { id } = await published(s.id, s.owner.cookie);
    await api(`/api/portal/pets/${id}/availability`, { method: 'POST', cookie: s.owner.cookie, body: { reserved: true } });
    for (let i = 0; i < 3; i++) await report(id, (await signIn()).cookie);
    expect(await status(id)).toBe('in_review');
    await api(`/api/admin/pets/${id}/restore`, { method: 'POST', cookie: admin.cookie, body: { note: 'Revisado con el refugio.' } });
    expect(await status(id)).toBe('reserved');
    const open = await env.DB.prepare('SELECT count(*) AS n FROM reports WHERE pet_id = ? AND resolved_at IS NULL').bind(id).first<{ n: number }>();
    expect(open!.n).toBe(0);
    const queue = (await api('/api/admin/reports', { cookie: admin.cookie })).json.pets as { id: string }[];
    expect(queue.some((p) => p.id === id)).toBe(false);
  });

  it('take down: needs a reason, withdraws it, closes its requests and emails the shelter', async () => {
    const admin = await signIn({ admin: true });
    const s = await shelter();
    const { id } = await published(s.id, s.owner.cookie);
    const adopter = await signIn();
    const sent = await api('/api/requests', { method: 'POST', cookie: adopter.cookie, body: { petId: id, answers: { space: 'si', time: 'si', cost: 'si' }, name: 'Ana', pref: 'correo', phone: '', consent: true } });
    const down = (note?: string) => api(`/api/admin/pets/${id}/takedown`, { method: 'POST', cookie: admin.cookie, body: { note } });
    expect((await down()).json.error).toBe('reason_required');
    const before = await emails('listing_review');
    expect((await down('Pedía dinero por fuera de la cuota.')).json.closed).toBe(1);
    const pet = await env.DB.prepare('SELECT status, withdrawn_reason FROM pets WHERE id = ?').bind(id).first<{ status: string; withdrawn_reason: string }>();
    expect(pet).toEqual({ status: 'withdrawn', withdrawn_reason: 'moderacion' });
    const req = await env.DB.prepare('SELECT status FROM adoption_requests WHERE id = ?').bind(sent.json.request.id).first<{ status: string }>();
    expect(req!.status).toBe('closed');
    expect(await emails('listing_review')).toBe(before + 1);
  });
});

describe('the rules for listing', () => {
  it('are remembered once read', async () => {
    const u = await signIn();
    expect((await api('/api/me', { cookie: u.cookie })).json.user.listerRules).toBe(false);
    await api('/api/me/lister-rules', { method: 'POST', cookie: u.cookie, body: {} });
    expect((await api('/api/me', { cookie: u.cookie })).json.user.listerRules).toBe(true);
  });
});
