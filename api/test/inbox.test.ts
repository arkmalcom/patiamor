import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetCatalogVersion } from '../src/cache';
import { runDigest } from '../src/digest';
import { api, signIn } from './helpers';

// The shelter's request inbox (PAT-5) and the morning job (PAT-4): who sees what, how requests move,
// and one summary a day instead of an email per request.

const form = (petId: string) => ({ petId, answers: { space: 'si', time: 'si', cost: 'pensando' }, name: 'Ana Pérez', pref: 'whatsapp', phone: '809-555-1234', consent: true, home: 'casa_patio' });

async function setup() {
  const owner = await signIn();
  const sid = `sh-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status, verified_at) VALUES (?, ?, 'Refugio Bandeja', 'gazcue-distrito-nacional', 'verified', '2026-01-01T00:00:00Z')").bind(sid, sid).run();
  await env.DB.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'owner')").bind(sid, owner.id).run();
  const pets: string[] = [];
  for (const name of ['Luna', 'Sol']) {
    const id = `${sid}-${name}`;
    await env.DB.prepare("INSERT INTO pets (id, listed_by, shelter_id, place_id, name, sex, size, energy, status, birth_date) VALUES (?, ?, ?, 'gazcue-distrito-nacional', ?, 'hembra', 'mediano', 'media', 'available', '2022-01-01')")
      .bind(id, owner.id, sid, name)
      .run();
    pets.push(id);
  }
  return { owner, sid, pets };
}

const send = async (petId: string) => {
  const adopter = await signIn();
  const res = await api('/api/requests', { method: 'POST', cookie: adopter.cookie, body: form(petId) });
  return { adopter, id: res.json.request.id as string };
};
const inboxOf = (sid: string, cookie: string) => api(`/api/portal/shelters/${sid}/requests`, { cookie });
const move = (id: string, cookie: string, body: Record<string, unknown>) => api(`/api/portal/requests/${id}/status`, { method: 'POST', cookie, body });
const emails = async (kind: string) => (await env.DB.prepare('SELECT count(*) AS n FROM email_log WHERE kind = ?').bind(kind).first<{ n: number }>())!.n;

beforeEach(async () => {
  forgetCatalogVersion();
  // Each test starts with an empty email budget and no other shelters' summaries pending.
  await env.DB.prepare('DELETE FROM email_log').run();
  await env.DB.prepare("UPDATE adoption_requests SET digested_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE digested_at IS NULL").run();
});

describe('the inbox', () => {
  it('shows a shelter its requests, with the details the adopter agreed to share', async () => {
    const { owner, sid, pets } = await setup();
    await send(pets[0]);
    const res = await inboxOf(sid, owner.cookie);
    expect(res.status).toBe(200);
    expect(res.json.requests[0]).toMatchObject({
      status: 'sent',
      answers: { cost: 'pensando' },
      about: { home: 'casa_patio' },
      contact: { name: 'Ana Pérez', phone: '+18095551234', pref: 'whatsapp' },
      pet: { name: 'Luna' },
    });
  });

  it('is only for the shelter’s members', async () => {
    const { sid, pets } = await setup();
    const { id } = await send(pets[0]);
    const stranger = await signIn();
    expect((await inboxOf(sid, stranger.cookie)).status).toBe(404);
    expect((await move(id, stranger.cookie, { status: 'seen' })).status).toBe(404);
    const other = await setup(); // a member of a different shelter
    expect((await move(id, other.owner.cookie, { status: 'contacted' })).status).toBe(404);
  });

  it('moves a request along, and the adopter sees each step', async () => {
    const { owner, pets } = await setup();
    const { adopter, id } = await send(pets[0]);
    expect((await move(id, owner.cookie, { status: 'seen' })).json.request.status).toBe('seen');
    expect((await move(id, owner.cookie, { status: 'contacted' })).json.request.status).toBe('contacted');
    expect((await move(id, owner.cookie, { status: 'visit' })).json.request.status).toBe('visit');
    expect((await move(id, owner.cookie, { status: 'seen' })).json.request.status).toBe('visit'); // reopening doesn't go back
    const mine = await api('/api/requests', { cookie: adopter.cookie });
    expect(mine.json.items[0].request.status).toBe('visit');
  });

  it('closing needs a reason, frees the adopter’s slot, and hides their contact details', async () => {
    const { owner, sid, pets } = await setup();
    const { id } = await send(pets[0]);
    expect((await move(id, owner.cookie, { status: 'closed' })).json.error).toBe('reason_required');
    const closed = await move(id, owner.cookie, { status: 'closed', reason: 'otra_familia' });
    expect(closed.json.request).toMatchObject({ status: 'closed', closedReason: 'otra_familia' });
    expect(closed.json.request.contact).toEqual({ name: 'Ana Pérez' });
    expect((await move(id, owner.cookie, { status: 'contacted' })).json.error).toBe('invalid_transition');
    const row = (await inboxOf(sid, owner.cookie)).json.requests[0];
    expect(row.contact.phone).toBeUndefined();
  });

  it('shows withdrawals with the reason, without contact details', async () => {
    const { owner, sid, pets } = await setup();
    const { adopter, id } = await send(pets[0]);
    await api(`/api/requests/${id}/withdraw`, { method: 'POST', cookie: adopter.cookie, body: { reason: 'vivienda' } });
    const row = (await inboxOf(sid, owner.cookie)).json.requests[0];
    expect(row).toMatchObject({ status: 'withdrawn', closedReason: 'vivienda', contact: { name: 'Ana Pérez' } });
    expect(row.contact.email).toBeUndefined();
  });

  it('counts new requests on the portal home', async () => {
    const { owner, pets } = await setup();
    await send(pets[0]);
    await send(pets[1]);
    const mine = await api('/api/portal/shelters', { cookie: owner.cookie });
    expect(mine.json.shelters[0].newRequests).toBe(2);
  });
});

describe('en proceso and pause', () => {
  it('reserving stops new requests; reopening tells people waiting, the next morning', async () => {
    const { owner, pets } = await setup();
    const avail = (body: Record<string, unknown>) => api(`/api/portal/pets/${pets[0]}/availability`, { method: 'POST', cookie: owner.cookie, body });
    expect((await avail({ reserved: true })).json.pet.status).toBe('reserved');
    const waiting = await signIn();
    expect((await api('/api/requests', { method: 'POST', cookie: waiting.cookie, body: form(pets[0]) })).json.error).toBe('reserved');
    await api(`/api/alerts/${pets[0]}`, { method: 'PUT', cookie: waiting.cookie, body: {} });
    // Make the alert older than the reopening (timestamps have one-second resolution).
    await env.DB.prepare("UPDATE availability_alerts SET created_at = '2026-01-01T00:00:00Z' WHERE user_id = ?").bind(waiting.id).run();
    expect((await avail({ reserved: false })).json.pet.status).toBe('available');
    const first = await runDigest(env, 'https://example.test');
    expect(first.alertEmails).toBe(1);
    expect(await emails('available')).toBe(1);
    expect((await runDigest(env, 'https://example.test')).alertEmails).toBe(0); // one notice per wish
    expect((await api('/api/requests', { method: 'POST', cookie: waiting.cookie, body: form(pets[0]) })).status).toBe(201);
  });

  it('pausing stops new requests without reserving', async () => {
    const { owner, pets } = await setup();
    expect((await api(`/api/portal/pets/${pets[1]}/availability`, { method: 'POST', cookie: owner.cookie, body: { paused: true } })).json.pet).toMatchObject({ status: 'available', requestsPaused: true });
    const adopter = await signIn();
    expect((await api('/api/requests', { method: 'POST', cookie: adopter.cookie, body: form(pets[1]) })).json.error).toBe('paused');
  });
});

describe('the morning summary', () => {
  it('one email per member per day, covering only what’s new', async () => {
    const { owner, sid, pets } = await setup();
    const maintainer = await signIn();
    await env.DB.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'maintainer')").bind(sid, maintainer.id).run();
    await send(pets[0]);
    await send(pets[0]);
    await send(pets[1]);
    const first = await runDigest(env, 'https://example.test');
    expect(first).toMatchObject({ shelters: 1, digestEmails: 2, deferred: false });
    expect((await runDigest(env, 'https://example.test')).digestEmails).toBe(0);
    // A request sent in the same second as the last run is still news the next time.
    await send(pets[1]);
    expect((await runDigest(env, 'https://example.test')).digestEmails).toBe(2);
    void owner;
  });

  it('waits for tomorrow when the email budget is spent, keeping room for sign-in codes', async () => {
    const { pets } = await setup();
    await send(pets[0]);
    await env.DB.prepare('DELETE FROM email_log').run();
    await env.DB.prepare("INSERT INTO email_log (kind) SELECT 'signin' FROM (WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 80) SELECT i FROM n)").run();
    const res = await runDigest(env, 'https://example.test');
    expect(res).toMatchObject({ digestEmails: 0, deferred: true });
    await env.DB.prepare('DELETE FROM email_log').run();
    expect((await runDigest(env, 'https://example.test')).digestEmails).toBe(1); // still pending, sent the next run
  });

  it('never emails the sample data’s made-up addresses', async () => {
    const { sid, pets } = await setup();
    const sample = `sample-${crypto.randomUUID().slice(0, 6)}`;
    await env.DB.prepare("INSERT INTO users (id, email) VALUES (?, ?)").bind(sample, `${sample}@ejemplo.do`).run();
    await env.DB.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'maintainer')").bind(sid, sample).run();
    await send(pets[0]);
    await runDigest(env, 'https://example.test');
    expect(await emails('digest')).toBe(1); // the owner only
  });

  it('can be run by an admin now, and by nobody else', async () => {
    const someone = await signIn();
    expect((await api('/api/admin/digest', { method: 'POST', cookie: someone.cookie, body: {} })).status).toBe(404);
    const admin = await signIn({ admin: true });
    const res = await api('/api/admin/digest', { method: 'POST', cookie: admin.cookie, body: {} });
    expect(res.status).toBe(200);
    expect(res.json).toHaveProperty('digestEmails');
  });
});
