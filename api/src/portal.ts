import { Hono, type Context } from 'hono';
import { isoIn, nowIso } from './auth/crypto';
import { hasEmailBudget, sendReviewAdminEmail } from './auth/email';
import { appOrigin } from './auth/routes';
import { DONATION_COLUMNS, donationView, type DonationRow } from './donations';
import type { AppContext } from './env';
import { placeById } from './places';
import { drPhone } from './requests';

// The shelter portal (/refugio): register a shelter, follow its verification, keep its public profile
// up to date. A shelter stays hidden from adopters until an admin verifies it (admin.ts). Members are
// owners (everything) or maintainers (pets and requests, later; not the shelter's settings).

type C = Context<AppContext>;
export type Role = 'owner' | 'maintainer';

/** Owners can have this many shelters; enough for a real network, too few for a mill of fronts. */
export const MAX_OWNED = 3;
/** Registrations per account per day, and how long the review queue may grow before new ones wait.
 *  Real shelters register once; these only bite on someone scripting accounts. */
const MAX_REGISTRATIONS_PER_DAY = 2;
const MAX_PENDING_QUEUE = 30;
const REFERENCE_KINDS = ['veterinaria', 'refugio', 'otro'] as const;
/** Asking to lift a suspension: a real explanation, at most three in 90 days, admins emailed five a day at most. */
const REVIEW_MIN = 30;
const REVIEW_MAX = 1500;
const REVIEWS_PER_90_DAYS = 3;
const REVIEW_ADMIN_EMAILS_PER_DAY = 5;

type ReviewRow = { id: string; shelter_id: string; status: string; message: string; decision_note: string | null; created_at: string; decided_at: string | null };
export const reviewView = (r: ReviewRow) => ({ id: r.id, status: r.status, message: r.message, note: r.decision_note, createdAt: r.created_at, decidedAt: r.decided_at });
const MAX_REFERENCES = 3;

/** This user's role in the shelter, or null if they aren't a member. */
export async function roleIn(c: C, shelterId: string): Promise<Role | null> {
  const user = c.get('user');
  if (!user) return null;
  const row = await c.env.DB.prepare('SELECT role FROM shelter_members WHERE shelter_id = ? AND user_id = ?').bind(shelterId, user.id).first<{ role: Role }>();
  return row?.role ?? null;
}

const slugify = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'refugio';

export const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const longText = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
/** Links people paste: Instagram, Facebook, a website. Kept only if they're http(s) URLs. */
export const links = (v: unknown) =>
  (Array.isArray(v) ? v : [])
    .map((l) => text(l, 200))
    .filter((l) => /^https?:\/\/[^\s]+\.[^\s]+$/i.test(l))
    .slice(0, 5);

/** The fields of a registration, validated; `error` names the first problem. */
export function readApplication(b: Record<string, unknown>) {
  const name = text(b.name, 80);
  const placeId = text(b.placeId, 80);
  const contactName = text(b.contactName, 80);
  const contactPhone = drPhone(text(b.contactPhone, 30));
  const publicPhone = b.publicPhone ? drPhone(text(b.publicPhone, 30)) : null;
  const email = text(b.email, 120) || null;
  // References: the first is required; up to two more are optional but must be complete if started.
  const given = Array.isArray(b.references) ? b.references : [b.reference];
  const refs = given.slice(0, MAX_REFERENCES).map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return { name: text(o.name, 80), contact: text(o.contact, 120), kind: o.kind as string };
  });
  const completeRef = (r: { name: string; contact: string; kind: string }) => r.name.length >= 2 && r.contact.length >= 5 && REFERENCE_KINDS.includes(r.kind as never);
  const ref = refs[0] ?? { name: '', contact: '', kind: '' };
  const app = {
    name,
    placeId,
    description: longText(b.description, 600) || null,
    visitHours: text(b.visitHours, 120) || null,
    publicPhone,
    email,
    website: links([b.website])[0] ?? null,
    contactName,
    contactPhone,
    rnc: text(b.rnc, 40) || null,
    address: longText(b.address, 300),
    social: links(b.social),
    history: longText(b.history, 2000),
    referenceName: ref.name,
    referenceContact: ref.contact,
    referenceKind: ref.kind,
    moreReferences: refs.slice(1),
  };
  let error: string | null = null;
  if (name.length < 3) error = 'invalid_name';
  else if (!placeById(placeId)) error = 'invalid_place';
  else if (contactName.length < 2) error = 'invalid_contact';
  else if (!contactPhone) error = 'invalid_phone';
  else if (b.publicPhone && !publicPhone) error = 'invalid_public_phone';
  else if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) error = 'invalid_email';
  else if (app.address.length < 8) error = 'invalid_address';
  else if (app.history.length < 40) error = 'history_too_short';
  else if (!completeRef(ref)) error = 'invalid_reference';
  else if (!app.moreReferences.every(completeRef)) error = 'invalid_more_reference';
  else if (b.rules !== true) error = 'rules_required';
  return { app, error };
}

/** The donation form, validated. All blank means "remove it"; otherwise bank, type, number and holder are needed. */
export function readDonation(b: Record<string, unknown>) {
  const d = {
    bank: text(b.bank, 60),
    accountType: text(b.accountType, 20),
    account: text(b.account, 40),
    holder: text(b.holder, 100),
    holderId: text(b.holderId, 20) || null,
    note: longText(b.note, 300) || null,
  };
  if (!d.bank && !d.accountType && !d.account && !d.holder && !d.holderId && !d.note) return { donation: null, error: null };
  const digits = (s: string) => s.replace(/\D/g, '').length;
  let error: string | null = null;
  if (d.bank.length < 2) error = 'invalid_bank';
  else if (!['ahorros', 'corriente'].includes(d.accountType)) error = 'invalid_account_type';
  else if (!/^[\d\s-]+$/.test(d.account) || digits(d.account) < 6) error = 'invalid_account';
  else if (d.holder.length < 3) error = 'invalid_holder';
  // A cédula has 11 digits and an RNC 9.
  else if (d.holderId && (!/^[\d\s-]+$/.test(d.holderId) || ![9, 11].includes(digits(d.holderId)))) error = 'invalid_holder_id';
  return { donation: d, error };
}

export const portal = new Hono<AppContext>();

portal.use('*', async (c, next) => {
  if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401);
  await next();
});

// The person's shelters and where each stands.
portal.get('/shelters', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.slug, s.status, s.status_reason, s.place_id, s.kind, m.role, a.submitted_at,
            (SELECT count(*) FROM adoption_requests r JOIN pets d ON d.id = r.pet_id WHERE d.shelter_id = s.id AND r.status = 'sent') AS new_requests
       FROM shelter_members m JOIN shelters s ON s.id = m.shelter_id LEFT JOIN shelter_applications a ON a.shelter_id = s.id
      WHERE m.user_id = ? ORDER BY s.created_at`,
  )
    .bind(c.get('user')!.id)
    .all<{ id: string; name: string; slug: string; status: string; status_reason: string | null; place_id: string; kind: string; role: Role; submitted_at: string | null; new_requests: number }>();
  // For suspended ones, their latest request to lift it, so the card says where it stands.
  const suspended = JSON.stringify(results.filter((r) => r.status === 'suspended').map((r) => r.id));
  const { results: reviews } = await c.env.DB.prepare(
    `SELECT id, shelter_id, status, message, decision_note, created_at, decided_at FROM shelter_reviews
      WHERE shelter_id IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC`,
  )
    .bind(suspended)
    .all<ReviewRow>();
  const latest = new Map<string, ReviewRow>();
  for (const v of reviews) if (!latest.has(v.shelter_id)) latest.set(v.shelter_id, v); // newest first
  return c.json({
    shelters: results.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      kind: r.kind as 'shelter' | 'private',
      status: r.status,
      statusReason: r.status_reason,
      place: placeById(r.place_id) ?? null,
      role: r.role,
      submittedAt: r.submitted_at,
      newRequests: r.new_requests,
      review: latest.has(r.id) ? reviewView(latest.get(r.id)!) : null,
    })),
  });
});

// A suspended shelter's owner asks to lift the suspension: { message } explains why. An admin decides
// (admin.ts) and the owner is emailed.
portal.post('/shelters/:id/review', async (c) => {
  const id = c.req.param('id');
  if ((await roleIn(c, id)) !== 'owner') return c.json({ error: 'not_found' }, 404);
  const user = c.get('user')!;
  const db = c.env.DB;
  const shelter = await db.prepare('SELECT name, status FROM shelters WHERE id = ?').bind(id).first<{ name: string; status: string }>();
  if (!shelter) return c.json({ error: 'not_found' }, 404);
  if (shelter.status !== 'suspended') return c.json({ error: 'not_suspended' }, 409);
  const b = await c.req.json<{ message?: unknown }>().catch(() => ({}) as { message?: unknown });
  const message = typeof b.message === 'string' ? b.message.trim().slice(0, REVIEW_MAX) : '';
  if (message.length < REVIEW_MIN) return c.json({ error: 'message_too_short', min: REVIEW_MIN }, 400);
  const [pending, recent] = await db.batch<{ n: number }>([
    db.prepare("SELECT count(*) AS n FROM shelter_reviews WHERE shelter_id = ? AND status = 'pending'").bind(id),
    db.prepare('SELECT count(*) AS n FROM shelter_reviews WHERE shelter_id = ? AND created_at > ?').bind(id, isoIn(-90 * 24 * 60 * 60 * 1000)),
  ]);
  if (pending.results[0].n) return c.json({ error: 'already_pending' }, 409);
  if (recent.results[0].n >= REVIEWS_PER_90_DAYS) return c.json({ error: 'too_many_reviews' }, 429);

  const reviewId = crypto.randomUUID();
  await db.prepare('INSERT INTO shelter_reviews (id, shelter_id, user_id, message) VALUES (?, ?, ?, ?)').bind(reviewId, id, user.id, message).run();
  const sent = await db.prepare("SELECT count(*) AS n FROM email_log WHERE kind = 'review_admin' AND created_at > ?").bind(isoIn(-24 * 60 * 60 * 1000)).first<{ n: number }>();
  if ((sent?.n ?? 0) < REVIEW_ADMIN_EMAILS_PER_DAY && (await hasEmailBudget(db, 'review_admin'))) {
    const { results: admins } = await db.prepare('SELECT email FROM users WHERE is_admin = 1').all<{ email: string }>();
    for (const a of admins) {
      await sendReviewAdminEmail(c.env, a.email, { who: user.name ?? user.email, shelter: shelter.name, adminUrl: `${appOrigin(c)}/refugio/admin/refugios?estado=suspended` }).catch((err) =>
        console.error('review admin email failed', err),
      );
    }
  }
  const row = await db.prepare('SELECT id, shelter_id, status, message, decision_note, created_at, decided_at FROM shelter_reviews WHERE id = ?').bind(reviewId).first<ReviewRow>();
  return c.json({ review: reviewView(row!) }, 201);
});

// Register a shelter: it starts pending, with the person as its owner.
portal.post('/shelters', async (c) => {
  const user = c.get('user')!;
  // Only approved shelter owners (and admins) register shelters: others ask first (owners.ts), so the
  // review inbox isn't open to everyone and one shelter doesn't arrive in a hundred spellings.
  if (!user.is_admin && !user.shelter_owner_at) return c.json({ error: 'owner_approval_required' }, 403);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const { app, error } = readApplication(body);
  if (error) return c.json({ error }, 400);

  const db = c.env.DB;
  const owned = await db.prepare("SELECT count(*) AS n FROM shelter_members m JOIN shelters s ON s.id = m.shelter_id WHERE m.user_id = ? AND m.role = 'owner' AND s.kind = 'shelter'").bind(user.id).first<{ n: number }>();
  if ((owned?.n ?? 0) >= MAX_OWNED) return c.json({ error: 'too_many_shelters' }, 409);
  const [today, queue] = await db.batch<{ n: number }>([
    db.prepare("SELECT count(*) AS n FROM shelter_members WHERE user_id = ? AND role = 'owner' AND created_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day')").bind(user.id),
    db.prepare("SELECT count(*) AS n FROM shelters WHERE status = 'pending'"),
  ]);
  if ((today.results[0]?.n ?? 0) >= MAX_REGISTRATIONS_PER_DAY) return c.json({ error: 'too_many_today' }, 429);
  if ((queue.results[0]?.n ?? 0) >= MAX_PENDING_QUEUE) {
    console.error(`shelter review queue is full (${MAX_PENDING_QUEUE} pending): new registrations are refused until some are reviewed`);
    return c.json({ error: 'queue_full' }, 503);
  }

  const { id, slug } = await insertShelter(db, app, user.id, { status: 'pending' });
  return c.json({ shelter: { id, slug, name: app.name, status: 'pending' } }, 201);
});

/** Creates the shelter with its private application and the person as its owner. A registration starts
 *  pending; one an admin makes for someone, from details gathered by talking to them, is verified at once. */
export async function insertShelter(db: D1Database, app: ReturnType<typeof readApplication>['app'], ownerId: string, opts: { status: 'pending' | 'verified'; adminId?: string }) {
  // A readable, unique slug: "patitas-de-gazcue", then "patitas-de-gazcue-2", and so on.
  const base = slugify(app.name);
  const { results: taken } = await db.prepare("SELECT slug FROM shelters WHERE slug = ? OR slug LIKE ? || '-%'").bind(base, base).all<{ slug: string }>();
  const used = new Set(taken.map((t) => t.slug));
  let slug = base;
  for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;

  const id = crypto.randomUUID();
  const now = nowIso();
  const verified = opts.status === 'verified';
  await db.batch([
    db
      .prepare('INSERT INTO shelters (id, slug, name, description, place_id, phone, email, website, visit_hours, status, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, slug, app.name, app.description, app.placeId, app.publicPhone, app.email, app.website, app.visitHours, opts.status, verified ? now : null),
    db
      .prepare(
        `INSERT INTO shelter_applications (shelter_id, contact_name, contact_phone, rnc, address, social, history, reference_name, reference_contact, reference_kind, more_references, reviewed_at, reviewed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, app.contactName, app.contactPhone, app.rnc, app.address, JSON.stringify(app.social), app.history, app.referenceName, app.referenceContact, app.referenceKind, JSON.stringify(app.moreReferences), verified ? now : null, verified ? (opts.adminId ?? null) : null),
    db.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'owner')").bind(id, ownerId),
  ]);
  return { id, slug };
}

/** A private lister: one person, one row in shelters of kind 'private', verified because an admin approved them
 *  (owners.ts, admin.ts). The name is for admins only ("Particular · Ana"); adopters see "Particular" and the area. */
export async function insertPrivateLister(db: D1Database, user: { id: string; name: string | null; email: string }, o: { placeId: string; phone: string; adminId: string }) {
  const base = slugify(`particular ${user.name ?? user.email.split('@')[0]}`);
  const { results: taken } = await db.prepare("SELECT slug FROM shelters WHERE slug = ? OR slug LIKE ? || '-%'").bind(base, base).all<{ slug: string }>();
  const used = new Set(taken.map((t) => t.slug));
  let slug = base;
  for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
  const id = crypto.randomUUID();
  const now = nowIso();
  await db.batch([
    db
      .prepare("INSERT INTO shelters (id, slug, name, place_id, phone, status, verified_at, kind) VALUES (?, ?, ?, ?, ?, 'verified', ?, 'private')")
      .bind(id, slug, `Particular · ${user.name ?? user.email}`, o.placeId, o.phone, now),
    db.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'owner')").bind(id, user.id),
  ]);
  return { id, slug };
}

// One shelter, for its members. The private application is for owners only.
portal.get('/shelters/:id', async (c) => {
  const id = c.req.param('id');
  const role = await roleIn(c, id);
  if (!role) return c.json({ error: 'not_found' }, 404);
  const db = c.env.DB;
  const s = await db
    .prepare(`SELECT id, slug, name, description, place_id, phone, email, website, visit_hours, status, status_reason, verified_at, kind, ${DONATION_COLUMNS} FROM shelters WHERE id = ?`)
    .bind(id)
    .first<{ id: string; slug: string; name: string; description: string | null; place_id: string; phone: string | null; email: string | null; website: string | null; visit_hours: string | null; status: string; status_reason: string | null; verified_at: string | null; kind: string } & DonationRow>();
  if (!s) return c.json({ error: 'not_found' }, 404);
  const a =
    role === 'owner'
      ? await db.prepare('SELECT * FROM shelter_applications WHERE shelter_id = ?').bind(id).first<Record<string, string | null>>()
      : null;
  return c.json({
    shelter: {
      id: s.id,
      slug: s.slug,
      name: s.name,
      description: s.description,
      place: placeById(s.place_id) ?? null,
      publicPhone: s.phone,
      email: s.email,
      website: s.website,
      visitHours: s.visit_hours,
      status: s.status,
      statusReason: s.status_reason,
      verifiedAt: s.verified_at,
      kind: s.kind as 'shelter' | 'private',
      role,
      donation: donationView(s),
    },
    application: a
      ? {
          contactName: a.contact_name,
          contactPhone: a.contact_phone,
          rnc: a.rnc,
          address: a.address,
          social: JSON.parse(a.social ?? '[]') as string[],
          history: a.history,
          references: [{ name: a.reference_name, contact: a.reference_contact, kind: a.reference_kind }, ...(JSON.parse(a.more_references ?? '[]') as object[])],
          submittedAt: a.submitted_at,
        }
      : null,
  });
});

// Owners add, change or remove the bank account for donations, in any status: adopters only see it while the
// shelter is verified (its pets are only public then). Never part of registration. Private listers can't ask
// for money, so they have none.
portal.put('/shelters/:id/donation', async (c) => {
  const id = c.req.param('id');
  if ((await roleIn(c, id)) !== 'owner') return c.json({ error: 'not_found' }, 404);
  const db = c.env.DB;
  const current = await db.prepare('SELECT kind FROM shelters WHERE id = ?').bind(id).first<{ kind: string }>();
  if (!current) return c.json({ error: 'not_found' }, 404);
  if (current.kind === 'private') return c.json({ error: 'not_for_private' }, 409);
  const { donation: d, error } = readDonation(await c.req.json<Record<string, unknown>>().catch(() => ({})));
  if (error) return c.json({ error }, 400);
  await db
    .prepare(
      `UPDATE shelters SET donation_bank = ?, donation_account_type = ?, donation_account = ?, donation_holder = ?, donation_holder_id = ?, donation_note = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(d?.bank ?? null, d?.accountType ?? null, d?.account ?? null, d?.holder ?? null, d?.holderId ?? null, d?.note ?? null, nowIso(), id)
    .run();
  const row = await db.prepare(`SELECT ${DONATION_COLUMNS} FROM shelters WHERE id = ?`).bind(id).first<DonationRow>();
  return c.json({ donation: donationView(row!) });
});

// Owners correct and resend a rejected application, or update a pending one. Once verified, the name and
// area stay as verified (changing them means a new review); the rest of the public profile is editable later.
portal.put('/shelters/:id/application', async (c) => {
  const id = c.req.param('id');
  if ((await roleIn(c, id)) !== 'owner') return c.json({ error: 'not_found' }, 404);
  const db = c.env.DB;
  const current = await db.prepare('SELECT status FROM shelters WHERE id = ?').bind(id).first<{ status: string }>();
  if (!current || !['pending', 'rejected'].includes(current.status)) return c.json({ error: 'not_editable' }, 409);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const { app, error } = readApplication(body);
  if (error) return c.json({ error }, 400);
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `UPDATE shelters SET name = ?, description = ?, place_id = ?, phone = ?, email = ?, website = ?, visit_hours = ?,
           status = 'pending', status_reason = NULL, updated_at = ? WHERE id = ?`,
      )
      .bind(app.name, app.description, app.placeId, app.publicPhone, app.email, app.website, app.visitHours, now, id),
    db
      .prepare(
        `UPDATE shelter_applications SET contact_name = ?, contact_phone = ?, rnc = ?, address = ?, social = ?, history = ?,
           reference_name = ?, reference_contact = ?, reference_kind = ?, more_references = ?, submitted_at = ?, reviewed_at = NULL, reviewed_by = NULL
         WHERE shelter_id = ?`,
      )
      .bind(app.contactName, app.contactPhone, app.rnc, app.address, JSON.stringify(app.social), app.history, app.referenceName, app.referenceContact, app.referenceKind, JSON.stringify(app.moreReferences), now, id),
  ]);
  return c.json({ shelter: { id, status: 'pending' } });
});
