import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetCatalogVersion } from '../src/cache';
import { api, signIn } from './helpers';

// Who may register a shelter: a person asks to be a shelter owner, an admin gets to know them and approves,
// and only then can they register (or the admin registers the shelter for them).

const form = (over: Record<string, unknown> = {}) => ({
  shelterName: 'Huellas del Sur',
  zone: 'Gazcue, Santo Domingo',
  phone: '809-555-0101',
  link: 'https://instagram.com/huellasdelsur',
  about: 'Soy la coordinadora de voluntarios; rescatamos perros y gatos de la calle desde hace cinco años.',
  consent: true,
  ...over,
});
const ask = (cookie: string, over: Record<string, unknown> = {}) => api('/api/portal/owner-request', { method: 'POST', cookie, body: form(over) });
const queue = (cookie: string, status = 'pending') => api(`/api/admin/owners?status=${status}`, { cookie });
const decide = (cookie: string, id: string, action: string, note?: string) => api(`/api/admin/owners/${id}/decision`, { method: 'POST', cookie, body: { action, note } });
const emails = async (kind: string) => (await env.DB.prepare('SELECT count(*) AS n FROM email_log WHERE kind = ?').bind(kind).first<{ n: number }>())!.n;

const shelterForm = (over: Record<string, unknown> = {}) => ({
  name: 'Huellas del Sur',
  placeId: 'gazcue-distrito-nacional',
  contactName: 'María Rodríguez',
  contactPhone: '809-555-0101',
  address: 'Calle Las Flores 12, Gazcue',
  history: 'Llevamos cinco años rescatando, con unos 40 animales al año y hogares temporales.',
  reference: { name: 'Clínica Vet Centro', contact: '809-555-0202', kind: 'veterinaria' },
  rules: true,
  ...over,
});
const register = (cookie: string, over: Record<string, unknown> = {}) => api('/api/portal/shelters', { method: 'POST', cookie, body: shelterForm(over) });

beforeEach(() => forgetCatalogVersion());

describe('registering a shelter needs approval', () => {
  it('refuses a plain account, and lets approved owners and admins through', async () => {
    const plain = await signIn();
    expect((await register(plain.cookie)).json.error).toBe('owner_approval_required');
    expect((await register(plain.cookie)).status).toBe(403);
    expect((await register((await signIn({ owner: true })).cookie)).status).toBe(201);
    expect((await register((await signIn({ admin: true })).cookie)).status).toBe(201);
  });
});

describe('asking to be a shelter owner', () => {
  it('needs consent, the basics and a Dominican phone', async () => {
    const u = await signIn();
    expect((await ask(u.cookie, { consent: false })).json.error).toBe('consent_required');
    expect((await ask(u.cookie, { shelterName: 'Hi' })).json.error).toBe('invalid_name');
    expect((await ask(u.cookie, { zone: '' })).json.error).toBe('invalid_zone');
    expect((await ask(u.cookie, { phone: '555-1234' })).json.error).toBe('invalid_phone');
    expect((await ask(u.cookie, { link: 'no es un enlace' })).json.error).toBe('invalid_link');
    expect((await ask(u.cookie, { about: 'Corto.' })).json.error).toBe('about_too_short');
    expect((await api('/api/portal/owner-request', { method: 'POST', body: form() })).status).toBe(401);
  });

  it('waits for an admin, one at a time, and /api/me says where it stands', async () => {
    const u = await signIn();
    const before = (await api('/api/me', { cookie: u.cookie })).json.user;
    expect(before).toMatchObject({ shelterOwner: false, ownerRequest: null });
    const sent = await ask(u.cookie);
    expect(sent.status).toBe(201);
    expect(sent.json.request).toMatchObject({ status: 'pending', shelterName: 'Huellas del Sur' });
    expect((await ask(u.cookie)).json.error).toBe('already_pending');
    expect((await api('/api/me', { cookie: u.cookie })).json.user.ownerRequest).toMatchObject({ status: 'pending' });
    // Still can't register while it waits.
    expect((await register(u.cookie)).json.error).toBe('owner_approval_required');
  });

  it('three in 90 days at most, and not for someone who already is an owner', async () => {
    const u = await signIn();
    for (let i = 0; i < 3; i++) {
      await env.DB.prepare("INSERT INTO shelter_owner_requests (id, user_id, shelter_name, zone, phone, about, consent_at, status, decided_at) VALUES (?, ?, 'Otro', 'Zona', '+18095550101', ?, '2026-01-01T00:00:00Z', 'declined', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day'))")
        .bind(crypto.randomUUID(), u.id, form().about)
        .run();
    }
    expect((await ask(u.cookie)).json.error).toBe('too_many_requests');
    expect((await ask((await signIn({ owner: true })).cookie)).json.error).toBe('already_owner');
    expect((await ask((await signIn({ admin: true })).cookie)).json.error).toBe('already_owner');
  });

  it('tells the admins, within a daily cap', async () => {
    await signIn({ admin: true });
    const before = await emails('owner_admin');
    await ask((await signIn()).cookie);
    expect(await emails('owner_admin')).toBeGreaterThan(before);
  });
});

describe('the admin’s review', () => {
  it('is for admins only', async () => {
    const u = await signIn();
    expect((await queue(u.cookie)).status).toBe(404);
    expect((await decide(u.cookie, 'x', 'approve')).status).toBe(404);
    expect((await api('/api/admin/shelters', { method: 'POST', cookie: u.cookie, body: { ownerEmail: 'a@example.test', ...shelterForm() } })).status).toBe(404);
  });

  it('flags a repeat: the same name, a shared word, the same phone', async () => {
    const admin = await signIn({ admin: true });
    // A shelter we already know, with its owner's phone.
    const owner = await signIn({ owner: true });
    expect((await register(owner.cookie, { name: 'Patitas de Gazcue', contactPhone: '809-555-7777' })).status).toBe(201);
    const a = await signIn();
    const b = await signIn();
    const c = await signIn();
    const sentA = await ask(a.cookie, { shelterName: 'Patitas de Gazcue', phone: '809-555-1111' });
    const sentB = await ask(b.cookie, { shelterName: 'Patitas Gazcue', phone: '809-555-2222' });
    const sentC = await ask(c.cookie, { shelterName: 'Santuario Luna', phone: '809-555-7777' });
    const rows = (await queue(admin.cookie)).json.requests as { id: string; lookAlikes: { kind: string; why: string; name: string }[] }[];
    const of = (id: string) => rows.find((r) => r.id === id)!.lookAlikes;
    // A is the same name as the known shelter. B is spelled differently ("Patitas Gazcue", no "de") but it's
    // the same name to a person: it matches both the shelter and A.
    expect(of(sentA.json.request.id)).toContainEqual(expect.objectContaining({ kind: 'shelter', why: 'same_name', name: 'Patitas de Gazcue' }));
    expect(of(sentB.json.request.id).map((l) => `${l.kind}:${l.why}`)).toEqual(expect.arrayContaining(['shelter:same_name', 'request:same_name']));
    // C has a different name but the phone of that shelter's owner: the strongest sign, listed first.
    expect(of(sentC.json.request.id)[0]).toMatchObject({ kind: 'shelter', why: 'same_phone' });
    // A typo is still the same name, one shared word of several is not enough to flag, and a name of one word is.
    const typo = await ask((await signIn()).cookie, { shelterName: 'Patitaz Gazcue', phone: '809-555-3333' });
    const one = await ask((await signIn()).cookie, { shelterName: 'Patitas Otra Zona Lejana', phone: '809-555-3334' });
    const lone = await ask((await signIn()).cookie, { shelterName: 'Gazcue', phone: '809-555-3335' });
    const after = (await queue(admin.cookie)).json.requests as { id: string; lookAlikes: { kind: string; why: string; name: string }[] }[];
    const alikes = (id: string) => after.find((r) => r.id === id)!.lookAlikes;
    expect(alikes(typo.json.request.id)).toContainEqual(expect.objectContaining({ kind: 'shelter', why: 'same_name' }));
    expect(alikes(one.json.request.id).filter((l) => l.kind === 'shelter')).toEqual([]);
    expect(alikes(lone.json.request.id)).toContainEqual(expect.objectContaining({ kind: 'shelter', why: 'shared_word', name: 'Patitas de Gazcue' }));
    // A new, unrelated request is flagged against nothing.
    const fresh = await ask((await signIn()).cookie, { shelterName: 'Refugio Zzyzx', phone: '809-555-4444' });
    expect((await queue(admin.cookie)).json.requests.find((r: { id: string }) => r.id === fresh.json.request.id).lookAlikes).toEqual([]);
  });

  it('declines with a reason the person reads, or approves so they can register', async () => {
    const admin = await signIn({ admin: true });
    const u = await signIn();
    const first = (await ask(u.cookie)).json.request.id;
    expect((await decide(admin.cookie, first, 'decline')).json.error).toBe('reason_required');
    expect((await decide(admin.cookie, first, 'maybe')).json.error).toBe('invalid_action');
    expect((await decide(admin.cookie, first, 'decline', 'No pudimos confirmar el refugio.')).json.request.status).toBe('declined');
    expect((await decide(admin.cookie, first, 'approve')).json.error).toBe('invalid_transition');
    expect((await api('/api/me', { cookie: u.cookie })).json.user.ownerRequest).toMatchObject({ status: 'declined', note: 'No pudimos confirmar el refugio.' });
    expect((await register(u.cookie)).status).toBe(403);
    expect(await emails('owner_decision')).toBeGreaterThanOrEqual(1);

    const second = (await ask(u.cookie)).json.request.id;
    expect((await decide(admin.cookie, second, 'approve', 'Te esperamos.')).json.request.status).toBe('approved');
    const me = (await api('/api/me', { cookie: u.cookie })).json.user;
    expect(me).toMatchObject({ shelterOwner: true, ownerRequest: null });
    expect((await register(u.cookie)).status).toBe(201);
    const log = await env.DB.prepare("SELECT action FROM admin_actions WHERE subject_type = 'owner_request' ORDER BY rowid").all<{ action: string }>();
    expect(log.results.map((r) => r.action)).toEqual(['owner.decline', 'owner.approve']);
  });
});

describe('an admin registering a shelter for someone', () => {
  it('creates the owner, the shelter (already verified), logs it, and closes their waiting request', async () => {
    const admin = await signIn({ admin: true });
    const waiting = await signIn();
    await ask(waiting.cookie, { shelterName: 'Hogar Sur' });
    const res = await api('/api/admin/shelters', { method: 'POST', cookie: admin.cookie, body: { ownerEmail: waiting.email.toUpperCase(), ...shelterForm({ name: 'Hogar Sur' }) } });
    expect(res.status).toBe(201);
    expect(res.json.shelter).toMatchObject({ name: 'Hogar Sur', status: 'verified' });
    // The person who had asked is now its owner and an approved shelter owner; their request is closed.
    const mine = await api('/api/portal/shelters', { cookie: waiting.cookie });
    expect(mine.json.shelters[0]).toMatchObject({ name: 'Hogar Sur', role: 'owner', status: 'verified' });
    expect((await api('/api/me', { cookie: waiting.cookie })).json.user).toMatchObject({ shelterOwner: true, ownerRequest: null });
    const log = await env.DB.prepare("SELECT action, note FROM admin_actions WHERE action = 'shelter.register_for' ORDER BY rowid DESC LIMIT 1").first<{ action: string; note: string }>();
    expect(log!.note).toBe(`owner=${waiting.email}`);
  });

  it('makes the account when the owner has none yet, who then finds the shelter on signing in', async () => {
    const admin = await signIn({ admin: true });
    const email = `nuevo-${crypto.randomUUID().slice(0, 6)}@example.test`;
    expect((await api('/api/admin/shelters', { method: 'POST', cookie: admin.cookie, body: { ownerEmail: email, ...shelterForm({ name: 'Rescate Norte' }) } })).status).toBe(201);
    const user = await env.DB.prepare('SELECT id, shelter_owner_at FROM users WHERE email = ?').bind(email).first<{ id: string; shelter_owner_at: string | null }>();
    expect(user!.shelter_owner_at).toBeTruthy();
    expect(await env.DB.prepare("SELECT count(*) AS n FROM shelter_members WHERE user_id = ? AND role = 'owner'").bind(user!.id).first()).toEqual({ n: 1 });
  });

  it('checks the owner’s email and the form like any registration, and the three-shelter limit', async () => {
    const admin = await signIn({ admin: true });
    const reg = (over: Record<string, unknown>) => api('/api/admin/shelters', { method: 'POST', cookie: admin.cookie, body: { ownerEmail: 'dueno@example.test', ...shelterForm(), ...over } });
    expect((await reg({ ownerEmail: 'no-es-un-correo' })).json.error).toBe('invalid_owner_email');
    expect((await reg({ contactPhone: '555-0101' })).json.error).toBe('invalid_phone');
    expect((await reg({ rules: false })).json.error).toBe('rules_required');
    for (let i = 0; i < 3; i++) expect((await reg({ name: `Refugio ${i}` })).status).toBe(201);
    expect((await reg({ name: 'Uno más' })).json.error).toBe('too_many_shelters');
  });
});
