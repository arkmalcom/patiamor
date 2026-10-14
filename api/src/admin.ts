import { Hono } from 'hono';
import { isoIn, nowIso } from './auth/crypto';
import { hasEmailBudget, sendBulkDecisionEmail, sendOwnerDecisionEmail, sendPauseClearedEmail, sendShelterDecisionEmail, type BulkDecision, type ShelterDecision } from './auth/email';
import { appOrigin } from './auth/routes';
import { isEmail, normalizeEmail, userForEmail } from './auth/users';
import type { BulkRow } from './bulk';
import { forgetCatalogVersion } from './cache';
import { runDigest } from './digest';
import type { AppContext } from './env';
import { placeById } from './places';
import { loadKnown, lookAlikes } from './owners';
import { insertShelter, MAX_OWNED, readApplication } from './portal';
import { OPEN_STATUSES, PAUSED_SQL, requestsRestricted, WITHDRAW_WINDOW_DAYS } from './requests';

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

// What is waiting for an answer, for the console's front page and the counts on its tabs: one request, not
// one per queue.
admin.get('/summary', async (c) => {
  const db = c.env.DB;
  const [shelters, owners, bulk, paused] = await db.batch<{ n: number }>([
    db.prepare("SELECT count(*) AS n FROM shelters WHERE status = 'pending'"),
    db.prepare("SELECT count(*) AS n FROM shelter_owner_requests WHERE status = 'pending'"),
    db.prepare("SELECT count(*) AS n FROM bulk_requests WHERE status = 'pending'"),
    db.prepare(`SELECT count(*) AS n FROM (${PAUSED_SQL})`),
  ]);
  return c.json({ shelters: shelters.results[0].n, owners: owners.results[0].n, bulk: bulk.results[0].n, paused: paused.results[0].n });
});

admin.get('/shelters', async (c) => {
  const status = STATUSES.includes(c.req.query('status') as never) ? c.req.query('status')! : 'pending';
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.slug, s.description, s.place_id, s.phone, s.email, s.website, s.visit_hours, s.status, s.status_reason, s.created_at,
            a.contact_name, a.contact_phone, a.rnc, a.address, a.social, a.history, a.reference_name, a.reference_contact, a.reference_kind, a.more_references, a.submitted_at,
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
            references: [{ name: r.reference_name, contact: r.reference_contact, kind: r.reference_kind }, ...(JSON.parse(r.more_references ?? '[]') as object[])],
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
    await sendShelterDecisionEmail(c.env, o.email, { shelter: s.name, decision: rule.to, reason, portalUrl: `${appOrigin(c)}/refugio` }).catch((err) =>
      console.error('shelter decision email failed', err),
    );
  }
  return c.json({ shelter: { id, status: rule.to } });
});

// ---------- Adopters whose new requests are paused ----------

// Who is paused now (withdrew three requests within 90 days, since any clearing), with what they withdrew
// and why, to judge whether to lift it.
admin.get('/paused', async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(`${PAUSED_SQL} ORDER BY last DESC LIMIT 100`).all<{ id: string; name: string | null; email: string; phone: string | null; withdrawals: number; last: string }>();
  const ids = JSON.stringify(results.map((r) => r.id));
  const [{ results: withdrawn }, { results: history }] = await Promise.all([
    db
      .prepare(
        `SELECT r.user_id, r.closed_reason, r.updated_at, d.name AS pet, s.name AS shelter
           FROM adoption_requests r JOIN users u ON u.id = r.user_id JOIN pets d ON d.id = r.pet_id LEFT JOIN shelters s ON s.id = d.shelter_id
          WHERE r.user_id IN (SELECT value FROM json_each(?)) AND r.status = 'withdrawn'
            AND r.updated_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-${WITHDRAW_WINDOW_DAYS} days')
            AND (u.requests_cleared_at IS NULL OR r.updated_at > u.requests_cleared_at)
          ORDER BY r.updated_at DESC`,
      )
      .bind(ids)
      .all<{ user_id: string; closed_reason: string | null; updated_at: string; pet: string; shelter: string | null }>(),
    db
      .prepare(`SELECT user_id, sum(status IN ${OPEN_STATUSES}) AS open, sum(status = 'adopted') AS adopted FROM adoption_requests WHERE user_id IN (SELECT value FROM json_each(?)) GROUP BY user_id`)
      .bind(ids)
      .all<{ user_id: string; open: number; adopted: number }>(),
  ]);
  return c.json({
    paused: results.map((r) => ({
      id: r.id,
      who: { name: r.name, email: r.email, phone: r.phone },
      since: r.last,
      withdrawals: withdrawn.filter((w) => w.user_id === r.id).map((w) => ({ pet: w.pet, shelter: w.shelter, reason: w.closed_reason, at: w.updated_at })),
      open: history.find((h) => h.user_id === r.id)?.open ?? 0,
      adopted: history.find((h) => h.user_id === r.id)?.adopted ?? 0,
    })),
  });
});

// Lift the pause: withdrawals before now stop counting, so new requests work again. They'd be paused again
// by three more withdrawals. The person is emailed.
admin.post('/paused/:userId/clear', async (c) => {
  const userId = c.req.param('userId');
  const adminUser = c.get('user')!;
  const b = await c.req.json<{ note?: string }>().catch(() => ({}) as { note?: string });
  const note = (b.note ?? '').trim().slice(0, 500) || null;
  const db = c.env.DB;
  const user = await db.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string }>();
  if (!user) return c.json({ error: 'not_found' }, 404);
  if (!(await requestsRestricted(db, userId))) return c.json({ error: 'not_paused' }, 409);

  await db.batch([
    db.prepare('UPDATE users SET requests_cleared_at = ? WHERE id = ?').bind(nowIso(), userId),
    db.prepare("INSERT INTO admin_actions (id, admin_id, action, subject_type, subject_id, note) VALUES (?, ?, 'pause.clear', 'user', ?, ?)").bind(crypto.randomUUID(), adminUser.id, userId, note),
  ]);
  if (await hasEmailBudget(db, 'pause_cleared')) {
    await sendPauseClearedEmail(c.env, user.email, { note, exploreUrl: appOrigin(c) }).catch((err) => console.error('pause cleared email failed', err));
  }
  return c.json({ cleared: { id: userId } });
});

// ---------- Requests to be a shelter owner ----------

type OwnerQueueRow = {
  id: string; user_id: string; shelter_name: string; zone: string; phone: string; link: string | null; about: string; status: string;
  decision_note: string | null; created_at: string; decided_at: string | null; name: string | null; email: string;
};

// The queue, each with the shelters and other requests it might duplicate (same or overlapping name, same
// phone) so an admin can spot a repeat before approving.
admin.get('/owners', async (c) => {
  const status = BULK_STATUSES.includes(c.req.query('status') as never) ? c.req.query('status')! : 'pending';
  const db = c.env.DB;
  const { results } = await db
    .prepare(
      `SELECT r.id, r.user_id, r.shelter_name, r.zone, r.phone, r.link, r.about, r.status, r.decision_note, r.created_at, r.decided_at, u.name, u.email
         FROM shelter_owner_requests r JOIN users u ON u.id = r.user_id WHERE r.status = ?
        ORDER BY r.created_at ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 100`,
    )
    .bind(status)
    .all<OwnerQueueRow>();
  const known = await loadKnown(db);
  return c.json({
    requests: results.map((r) => ({
      id: r.id,
      status: r.status,
      shelterName: r.shelter_name,
      zone: r.zone,
      link: r.link,
      about: r.about,
      createdAt: r.created_at,
      decidedAt: r.decided_at,
      note: r.decision_note,
      who: { name: r.name, email: r.email, phone: r.phone },
      lookAlikes: lookAlikes(known, { id: r.id, shelterName: r.shelter_name, phone: r.phone }),
    })),
  });
});

// Approve (they can then register the shelter themselves) or decline (with the reason they will read).
admin.post('/owners/:id/decision', async (c) => {
  const id = c.req.param('id');
  const adminUser = c.get('user')!;
  const b = await c.req.json<{ action?: string; note?: string }>().catch(() => ({}) as { action?: string; note?: string });
  const decision: BulkDecision | null = b.action === 'approve' ? 'approved' : b.action === 'decline' ? 'declined' : null;
  if (!decision) return c.json({ error: 'invalid_action' }, 400);
  const note = (b.note ?? '').trim().slice(0, 500) || null;
  if (decision === 'declined' && !note) return c.json({ error: 'reason_required' }, 400);

  const db = c.env.DB;
  const row = await db
    .prepare('SELECT r.status, r.user_id, u.email FROM shelter_owner_requests r JOIN users u ON u.id = r.user_id WHERE r.id = ?')
    .bind(id)
    .first<{ status: string; user_id: string; email: string }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.status !== 'pending') return c.json({ error: 'invalid_transition' }, 409);

  const now = nowIso();
  await db.batch([
    db.prepare("UPDATE shelter_owner_requests SET status = ?, decision_note = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'").bind(decision, note, adminUser.id, now, id),
    ...(decision === 'approved' ? [db.prepare('UPDATE users SET shelter_owner_at = coalesce(shelter_owner_at, ?) WHERE id = ?').bind(now, row.user_id)] : []),
    db.prepare("INSERT INTO admin_actions (id, admin_id, action, subject_type, subject_id, note) VALUES (?, ?, ?, 'owner_request', ?, ?)").bind(crypto.randomUUID(), adminUser.id, `owner.${b.action}`, id, note),
  ]);
  if (await hasEmailBudget(db, 'owner_decision')) {
    await sendOwnerDecisionEmail(c.env, row.email, { decision, note, portalUrl: `${appOrigin(c)}/refugio` }).catch((err) => console.error('owner decision email failed', err));
  }
  return c.json({ request: { id, status: decision } });
});

// Register a shelter for someone, from what they told the admin: it needs the owner's email besides the
// usual form, and starts verified, since an admin has already got to know them. They sign in with that
// email and find the shelter. (A request of theirs that was waiting is closed as approved.)
admin.post('/shelters', async (c) => {
  const adminUser = c.get('user')!;
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const ownerEmail = normalizeEmail(typeof body.ownerEmail === 'string' ? body.ownerEmail : '');
  if (!isEmail(ownerEmail)) return c.json({ error: 'invalid_owner_email' }, 400);
  const { app, error } = readApplication(body);
  if (error) return c.json({ error }, 400);

  const db = c.env.DB;
  const owner = await userForEmail(db, ownerEmail, app.contactName);
  const owned = await db.prepare("SELECT count(*) AS n FROM shelter_members WHERE user_id = ? AND role = 'owner'").bind(owner.id).first<{ n: number }>();
  if ((owned?.n ?? 0) >= MAX_OWNED) return c.json({ error: 'too_many_shelters' }, 409);

  const now = nowIso();
  await db.prepare('UPDATE users SET shelter_owner_at = coalesce(shelter_owner_at, ?) WHERE id = ?').bind(now, owner.id).run();
  const { id, slug } = await insertShelter(db, app, owner.id, { status: 'verified', adminId: adminUser.id });
  await db.batch([
    db.prepare("UPDATE shelter_owner_requests SET status = 'approved', decision_note = 'Registrado por Patiamor.', decided_by = ?, decided_at = ? WHERE user_id = ? AND status = 'pending'").bind(adminUser.id, now, owner.id),
    db.prepare("INSERT INTO admin_actions (id, admin_id, action, subject_type, subject_id, note) VALUES (?, ?, 'shelter.register_for', 'shelter', ?, ?)").bind(crypto.randomUUID(), adminUser.id, id, `owner=${ownerEmail}`),
  ]);
  if (await hasEmailBudget(db, 'shelter_decision')) {
    await sendShelterDecisionEmail(c.env, ownerEmail, { shelter: app.name, decision: 'verified', reason: null, portalUrl: `${appOrigin(c)}/refugio` }).catch((err) => console.error('shelter registered email failed', err));
  }
  return c.json({ shelter: { id, slug, name: app.name, status: 'verified' } }, 201);
});

// ---------- Special requests to adopt more than three ----------

type BulkQueueRow = BulkRow & { wanted: string | null; about: string; contact_phone: string | null; name: string | null; email: string; user_id: string; account_phone: string | null };
const BULK_STATUSES = ['pending', 'approved', 'declined'] as const;

// The queue, each with what an admin needs to weigh it: the person's requests in progress, how many
// they've withdrawn lately and how many animals they've already adopted through Patiamor.
admin.get('/bulk', async (c) => {
  const status = BULK_STATUSES.includes(c.req.query('status') as never) ? c.req.query('status')! : 'pending';
  const db = c.env.DB;
  const { results } = await db
    .prepare(
      `SELECT b.id, b.user_id, b.animals, b.species, b.wanted, b.about, b.contact_phone, b.status, b.decision_note, b.created_at, b.decided_at,
              u.name, u.email, u.phone AS account_phone
         FROM bulk_requests b JOIN users u ON u.id = b.user_id WHERE b.status = ?
        ORDER BY b.created_at ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 100`,
    )
    .bind(status)
    .all<BulkQueueRow>();
  const ids = JSON.stringify([...new Set(results.map((r) => r.user_id))]);
  const [{ results: open }, { results: history }] = await Promise.all([
    db
      .prepare(
        `SELECT r.user_id, r.status, d.name AS pet, s.name AS shelter FROM adoption_requests r JOIN pets d ON d.id = r.pet_id LEFT JOIN shelters s ON s.id = d.shelter_id
          WHERE r.user_id IN (SELECT value FROM json_each(?)) AND r.status IN ${OPEN_STATUSES} ORDER BY r.created_at`,
      )
      .bind(ids)
      .all<{ user_id: string; status: string; pet: string; shelter: string | null }>(),
    db
      .prepare(
        `SELECT user_id, sum(status = 'withdrawn' AND updated_at > ?) AS withdrawn, sum(status = 'adopted') AS adopted FROM adoption_requests
          WHERE user_id IN (SELECT value FROM json_each(?)) GROUP BY user_id`,
      )
      .bind(isoIn(-90 * 24 * 60 * 60 * 1000), ids)
      .all<{ user_id: string; withdrawn: number; adopted: number }>(),
  ]);
  return c.json({
    requests: results.map((r) => ({
      id: r.id,
      status: r.status,
      animals: r.animals,
      species: r.species,
      wanted: r.wanted,
      about: r.about,
      createdAt: r.created_at,
      decidedAt: r.decided_at,
      note: r.decision_note,
      who: { name: r.name, email: r.email, phone: r.contact_phone ?? r.account_phone },
      inProgress: open.filter((o) => o.user_id === r.user_id).map((o) => ({ pet: o.pet, shelter: o.shelter, status: o.status })),
      withdrawn90: history.find((h) => h.user_id === r.user_id)?.withdrawn ?? 0,
      adopted: history.find((h) => h.user_id === r.user_id)?.adopted ?? 0,
    })),
  });
});

// Approve (optionally with a note for the adopter) or decline (with the reason the adopter will read).
admin.post('/bulk/:id/decision', async (c) => {
  const id = c.req.param('id');
  const adminUser = c.get('user')!;
  const b = await c.req.json<{ action?: string; note?: string }>().catch(() => ({}) as { action?: string; note?: string });
  const decision: BulkDecision | null = b.action === 'approve' ? 'approved' : b.action === 'decline' ? 'declined' : null;
  if (!decision) return c.json({ error: 'invalid_action' }, 400);
  const note = (b.note ?? '').trim().slice(0, 500) || null;
  if (decision === 'declined' && !note) return c.json({ error: 'reason_required' }, 400);

  const db = c.env.DB;
  const row = await db
    .prepare('SELECT b.status, b.animals, u.email FROM bulk_requests b JOIN users u ON u.id = b.user_id WHERE b.id = ?')
    .bind(id)
    .first<{ status: string; animals: number; email: string }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.status !== 'pending') return c.json({ error: 'invalid_transition' }, 409);

  const now = nowIso();
  await db.batch([
    db.prepare("UPDATE bulk_requests SET status = ?, decision_note = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'").bind(decision, note, adminUser.id, now, id),
    db.prepare("INSERT INTO admin_actions (id, admin_id, action, subject_type, subject_id, note) VALUES (?, ?, ?, 'bulk_request', ?, ?)").bind(crypto.randomUUID(), adminUser.id, `bulk.${b.action}`, id, note),
  ]);
  if (await hasEmailBudget(db, 'bulk_decision')) {
    await sendBulkDecisionEmail(c.env, row.email, { decision, animals: row.animals, note, listUrl: `${appOrigin(c)}/lista` }).catch((err) => console.error('bulk decision email failed', err));
  }
  return c.json({ bulk: { id, status: decision } });
});

// Run the morning job now (it also runs daily at 8:00): for checking the emails on staging, or catching
// up after a problem. It only sends what's new, so running it twice sends nothing more.
admin.post('/digest', async (c) => {
  const result = await runDigest(c.env, appOrigin(c));
  await c.env.DB.prepare("INSERT INTO admin_actions (id, admin_id, action, subject_type, subject_id, note) VALUES (?, ?, 'digest.run', 'system', 'digest', ?)")
    .bind(crypto.randomUUID(), c.get('user')!.id, JSON.stringify(result))
    .run();
  return c.json(result);
});
