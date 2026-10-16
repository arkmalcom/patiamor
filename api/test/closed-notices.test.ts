import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetCatalogVersion } from '../src/cache';
import { noticeFor, runDigest } from '../src/digest';
import { api, signIn } from './helpers';

// PAT-6 (owner decision 2026-10-16): an adopter is emailed only when a request ends without a home for
// them, in the morning job, one email per person however many ended. Good news (the animal is theirs) and
// their own withdrawals send nothing.

const form = (petId: string) => ({ petId, answers: { space: 'si', time: 'si', cost: 'si' }, name: 'Ana Pérez', pref: 'correo', phone: '', consent: true });
const ORIGIN = 'https://example.test';

async function setup(names = ['Luna', 'Sol']) {
  const owner = await signIn();
  const sid = `sh-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status, verified_at) VALUES (?, ?, 'Refugio Aviso', 'gazcue-distrito-nacional', 'verified', '2026-01-01T00:00:00Z')").bind(sid, sid).run();
  await env.DB.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'owner')").bind(sid, owner.id).run();
  const pets: string[] = [];
  for (const name of names) {
    const id = `${sid}-${name}`;
    await env.DB.prepare(
      "INSERT INTO pets (id, listed_by, shelter_id, place_id, name, sex, size, energy, status, birth_date, story, published_at) VALUES (?, ?, ?, 'gazcue-distrito-nacional', ?, 'hembra', 'mediano', 'media', 'available', '2022-01-01', 'Una perra tranquila y cariñosa con todos.', '2026-01-01T00:00:00Z')",
    )
      .bind(id, owner.id, sid, name)
      .run();
    pets.push(id);
  }
  return { owner, sid, pets };
}
const ask = async (petId: string, adopter = signIn()) => {
  const a = await adopter;
  const res = await api('/api/requests', { method: 'POST', cookie: a.cookie, body: form(petId) });
  return { adopter: a, id: res.json.request.id as string };
};
const close = (id: string, cookie: string, reason = 'otra_familia') => api(`/api/portal/requests/${id}/status`, { method: 'POST', cookie, body: { status: 'closed', reason } });
const closedEmails = async () => (await env.DB.prepare("SELECT count(*) AS n FROM email_log WHERE kind = 'request_closed'").first<{ n: number }>())!.n;
const clean = async () => {
  await env.DB.prepare('DELETE FROM email_log').run();
  // Other tests' loose ends (requests closed earlier in this file's database) are announced once and for all.
  await runDigest(env, ORIGIN);
  await env.DB.prepare('DELETE FROM email_log').run();
};

beforeEach(async () => {
  forgetCatalogVersion();
  await clean();
});

describe('telling an adopter their request ended', () => {
  it('emails once when a shelter moves on, and not again', async () => {
    const { owner, pets } = await setup();
    const { id } = await ask(pets[0]);
    await close(id, owner.cookie, 'sin_respuesta');
    const first = await runDigest(env, ORIGIN);
    expect(first.closedEmails).toBe(1);
    expect(await closedEmails()).toBe(1);
    expect((await runDigest(env, ORIGIN)).closedEmails).toBe(0);
    const row = await env.DB.prepare('SELECT closed_notified_at FROM adoption_requests WHERE id = ?').bind(id).first<{ closed_notified_at: string | null }>();
    expect(row!.closed_notified_at).not.toBeNull();
  });

  it('is one email per person however many ended, and one each for different people', async () => {
    const { owner, pets } = await setup();
    const ana = await signIn();
    const luis = await signIn();
    const a1 = await ask(pets[0], Promise.resolve(ana));
    const a2 = await ask(pets[1], Promise.resolve(ana));
    const l1 = await ask(pets[0], Promise.resolve(luis));
    for (const r of [a1, a2, l1]) await close(r.id, owner.cookie);
    expect((await runDigest(env, ORIGIN)).closedEmails).toBe(2);
  });

  it('tells the other families when an animal goes home with someone else, but not the one it went home with', async () => {
    const { owner, pets } = await setup();
    const chosen = await ask(pets[0]);
    const other = await ask(pets[0]);
    expect((await api(`/api/portal/pets/${pets[0]}/adopted`, { method: 'POST', cookie: owner.cookie, body: { requestId: chosen.id } })).status).toBe(200);
    expect((await runDigest(env, ORIGIN)).closedEmails).toBe(1);
    const status = async (id: string) => (await env.DB.prepare('SELECT closed_notified_at AS n FROM adoption_requests WHERE id = ?').bind(id).first<{ n: string | null }>())!.n;
    expect(await status(other.id)).not.toBeNull();
    expect(await status(chosen.id)).toBeNull(); // adopted: no email, and nothing to mark
  });

  it('tells them when an animal is withdrawn', async () => {
    const { owner, pets } = await setup();
    await ask(pets[0]);
    await api(`/api/portal/pets/${pets[0]}/withdraw`, { method: 'POST', cookie: owner.cookie, body: { reason: 'salud' } });
    expect((await runDigest(env, ORIGIN)).closedEmails).toBe(1);
  });

  it('says nothing for their own withdrawal', async () => {
    const { pets } = await setup();
    const { adopter, id } = await ask(pets[0]);
    await api(`/api/requests/${id}/withdraw`, { method: 'POST', cookie: adopter.cookie, body: { reason: 'situacion' } });
    expect((await runDigest(env, ORIGIN)).closedEmails).toBe(0);
  });

  it('says nothing when an adoption is undone, or for requests that ended days ago', async () => {
    const { owner, pets } = await setup();
    const returned = await ask(pets[0]);
    await api(`/api/portal/pets/${pets[0]}/adopted`, { method: 'POST', cookie: owner.cookie, body: { requestId: returned.id } });
    await api(`/api/portal/pets/${pets[0]}/relist`, { method: 'POST', cookie: owner.cookie, body: {} });
    const old = await ask(pets[1]);
    await close(old.id, owner.cookie);
    await env.DB.prepare("UPDATE adoption_requests SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-5 days') WHERE id = ?").bind(old.id).run();
    expect((await runDigest(env, ORIGIN)).closedEmails).toBe(0);
    expect(await closedEmails()).toBe(0);
  });

  it('waits for tomorrow when the email budget is spent', async () => {
    const { owner, pets } = await setup();
    const { id } = await ask(pets[0]);
    await close(id, owner.cookie);
    await env.DB.prepare("INSERT INTO email_log (kind) SELECT 'signin' FROM (WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 80) SELECT i FROM n)").run();
    expect(await runDigest(env, ORIGIN)).toMatchObject({ closedEmails: 0, deferred: true });
    await env.DB.prepare('DELETE FROM email_log').run();
    expect((await runDigest(env, ORIGIN)).closedEmails).toBe(1);
  });

  it('never names a private lister, and never says why a shelter moved on', () => {
    const notice = (over: Record<string, unknown>) => noticeFor({ closed_reason: 'otra_familia', pet: 'Gala', lister: 'Particular · Ana Secreta', lister_kind: 'private', ...over } as Parameters<typeof noticeFor>[0]);
    expect(notice({})).toEqual({ pet: 'Gala', outcome: 'moved_on', lister: 'La persona que lo publicó' });
    expect(notice({ lister_kind: 'shelter', lister: 'Refugio Aviso' })).toEqual({ pet: 'Gala', outcome: 'moved_on', lister: 'Refugio Aviso' });
    // The reason is a shelter's own: sin_respuesta and no_encaja read the same to the adopter.
    expect(notice({ closed_reason: 'sin_respuesta' })).toEqual(notice({ closed_reason: 'no_encaja' }));
    expect(JSON.stringify(notice({ closed_reason: 'sin_respuesta' }))).not.toContain('respuesta');
    expect(notice({ closed_reason: 'adoptado' }).outcome).toBe('found_home');
    expect(notice({ closed_reason: 'retirado' }).outcome).toBe('gone');
  });
});
