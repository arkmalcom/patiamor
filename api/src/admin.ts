import { Hono } from 'hono';
import { nowIso } from './auth/crypto';
import { hasEmailBudget, sendShelterDecisionEmail, type ShelterDecision } from './auth/email';
import { appOrigin } from './auth/routes';
import { forgetCatalogVersion } from './cache';
import type { AppContext } from './env';
import { placeById } from './places';

// Admin tools. For now: the shelter verification queue (PAT-13). Every decision is written to
// admin_actions; the full console (PAT-14) builds on this.

const STATUSES = ['pending', 'verified', 'rejected', 'suspended'] as const;
/** Which decision is allowed from which status. */
const DECISIONS: Record<string, { to: ShelterDecision; from: readonly string[]; needsReason: boolean }> = {
  verify: { to: 'verified', from: ['pending', 'rejected', 'suspended'], needsReason: false },
  reject: { to: 'rejected', from: ['pending'], needsReason: true },
  suspend: { to: 'suspended', from: ['verified'], needsReason: true },
};

export const admin = new Hono<AppContext>();

admin.use('*', async (c, next) => {
  // Not found, not forbidden: the admin area doesn't announce itself.
  if (!c.get('user')?.is_admin) return c.json({ error: 'not_found' }, 404);
  await next();
});

admin.get('/shelters', async (c) => {
  const status = STATUSES.includes(c.req.query('status') as never) ? c.req.query('status')! : 'pending';
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.slug, s.description, s.place_id, s.phone, s.email, s.website, s.visit_hours, s.status, s.status_reason, s.created_at,
            a.contact_name, a.contact_phone, a.rnc, a.address, a.social, a.history, a.reference_name, a.reference_contact, a.reference_kind, a.submitted_at,
            (SELECT group_concat(u.email, ', ') FROM shelter_members m JOIN users u ON u.id = m.user_id WHERE m.shelter_id = s.id AND m.role = 'owner') AS owners
       FROM shelters s LEFT JOIN shelter_applications a ON a.shelter_id = s.id
      WHERE s.status = ? ORDER BY coalesce(a.submitted_at, s.created_at)`,
  )
    .bind(status)
    .all<Record<string, string | null>>();
  return c.json({
    shelters: results.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      place: placeById(r.place_id!) ?? null,
      publicPhone: r.phone,
      email: r.email,
      website: r.website,
      visitHours: r.visit_hours,
      status: r.status,
      statusReason: r.status_reason,
      owners: r.owners,
      application: r.contact_name
        ? {
            contactName: r.contact_name,
            contactPhone: r.contact_phone,
            rnc: r.rnc,
            address: r.address,
            social: JSON.parse(r.social ?? '[]') as string[],
            history: r.history,
            reference: { name: r.reference_name, contact: r.reference_contact, kind: r.reference_kind },
            submittedAt: r.submitted_at,
          }
        : null,
    })),
  });
});

admin.post('/shelters/:id/decision', async (c) => {
  const id = c.req.param('id');
  const adminUser = c.get('user')!;
  const b = await c.req.json<{ action?: string; reason?: string }>().catch(() => ({}) as { action?: string; reason?: string });
  const rule = b.action ? DECISIONS[b.action] : undefined;
  if (!rule) return c.json({ error: 'invalid_action' }, 400);
  const reason = (b.reason ?? '').trim().slice(0, 500) || null;
  if (rule.needsReason && !reason) return c.json({ error: 'reason_required' }, 400);

  const db = c.env.DB;
  const s = await db.prepare('SELECT name, status FROM shelters WHERE id = ?').bind(id).first<{ name: string; status: string }>();
  if (!s) return c.json({ error: 'not_found' }, 404);
  if (!rule.from.includes(s.status)) return c.json({ error: 'invalid_transition' }, 409);

  const now = nowIso();
  await db.batch([
    db
      .prepare("UPDATE shelters SET status = ?, status_reason = ?, verified_at = CASE WHEN ? = 'verified' THEN coalesce(verified_at, ?) ELSE verified_at END, updated_at = ? WHERE id = ?")
      .bind(rule.to, rule.to === 'verified' ? null : reason, rule.to, now, now, id),
    db.prepare('UPDATE shelter_applications SET reviewed_at = ?, reviewed_by = ? WHERE shelter_id = ?').bind(now, adminUser.id, id),
    db
      .prepare("INSERT INTO admin_actions (id, admin_id, action, subject_type, subject_id, note) VALUES (?, ?, ?, 'shelter', ?, ?)")
      .bind(crypto.randomUUID(), adminUser.id, `shelter.${b.action}`, id, reason),
  ]);

  forgetCatalogVersion(); // the shelter's pets appear or disappear at once here

  // Tell the owners, within the day's email budget.
  const { results: owners } = await db.prepare("SELECT u.email FROM shelter_members m JOIN users u ON u.id = m.user_id WHERE m.shelter_id = ? AND m.role = 'owner'").bind(id).all<{ email: string }>();
  for (const o of owners) {
    if (!(await hasEmailBudget(db, 'shelter_decision'))) break;
    await sendShelterDecisionEmail(c.env, o.email, { shelter: s.name, decision: rule.to, reason, portalUrl: `${appOrigin(c)}/#/refugio` }).catch((err) =>
      console.error('shelter decision email failed', err),
    );
  }
  return c.json({ shelter: { id, status: rule.to } });
});
