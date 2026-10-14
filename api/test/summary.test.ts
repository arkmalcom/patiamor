import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { api, signIn } from './helpers';

// The admin console's front page: how many of each kind of request are waiting.

const summary = (cookie: string) => api('/api/admin/summary', { cookie });

describe('the admin summary', () => {
  it('is for admins only', async () => {
    expect((await summary((await signIn()).cookie)).status).toBe(404);
    expect((await api('/api/admin/summary')).status).toBe(404);
  });

  it('counts what is waiting in each queue, and only what is waiting', async () => {
    const admin = await signIn({ admin: true });
    const before = (await summary(admin.cookie)).json;
    const user = await signIn();
    const sid = `sh-${crypto.randomUUID().slice(0, 8)}`;
    await env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status) VALUES (?, ?, 'En espera', 'gazcue-distrito-nacional', 'pending')").bind(sid, sid).run();
    await env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status) VALUES ('ya-' || ?, 'ya-' || ?, 'Ya verificado', 'gazcue-distrito-nacional', 'verified')").bind(sid, sid).run();
    await env.DB.prepare("INSERT INTO shelter_owner_requests (id, user_id, shelter_name, zone, phone, about, consent_at) VALUES (?, ?, 'Pide', 'Zona', '+18095550101', 'Una descripción suficientemente larga para pasar.', '2026-01-01T00:00:00Z')")
      .bind(crypto.randomUUID(), user.id)
      .run();
    await env.DB.prepare("INSERT INTO bulk_requests (id, user_id, animals, species, about, consent_at) VALUES (?, ?, 5, 'perros', 'Una descripción suficientemente larga para pasar.', '2026-01-01T00:00:00Z')")
      .bind(crypto.randomUUID(), user.id)
      .run();
    const after = (await summary(admin.cookie)).json;
    expect(after).toEqual({ shelters: before.shelters + 1, owners: before.owners + 1, bulk: before.bulk + 1 });
    // A decided one stops counting.
    await env.DB.prepare("UPDATE shelter_owner_requests SET status = 'declined' WHERE user_id = ?").bind(user.id).run();
    expect((await summary(admin.cookie)).json.owners).toBe(before.owners);
  });
});
