import { Hono, type Context } from 'hono';
import { nowIso } from './auth/crypto';
import type { AppContext } from './env';
import { placeById } from './places';
import { drPhone } from './requests';

// The shelter portal (/refugio): register a shelter, follow its verification, keep its public profile
// up to date. A shelter stays hidden from adopters until an admin verifies it (admin.ts). Members are
// owners (everything) or maintainers (pets and requests, later; not the shelter's settings).

type C = Context<AppContext>;
export type Role = 'owner' | 'maintainer';

/** Owners can register this many shelters; enough for a real network, too few for a mill of fronts. */
const MAX_OWNED = 3;
const REFERENCE_KINDS = ['veterinaria', 'refugio', 'otro'] as const;

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

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const longText = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
/** Links people paste: Instagram, Facebook, a website. Kept only if they're http(s) URLs. */
const links = (v: unknown) =>
  (Array.isArray(v) ? v : [])
    .map((l) => text(l, 200))
    .filter((l) => /^https?:\/\/[^\s]+\.[^\s]+$/i.test(l))
    .slice(0, 5);

/** The fields of a registration, validated; `error` names the first problem. */
function readApplication(b: Record<string, unknown>) {
  const name = text(b.name, 80);
  const placeId = text(b.placeId, 80);
  const contactName = text(b.contactName, 80);
  const contactPhone = drPhone(text(b.contactPhone, 30));
  const publicPhone = b.publicPhone ? drPhone(text(b.publicPhone, 30)) : null;
  const email = text(b.email, 120) || null;
  const ref = (b.reference ?? {}) as Record<string, unknown>;
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
    referenceName: text(ref.name, 80),
    referenceContact: text(ref.contact, 120),
    referenceKind: ref.kind,
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
  else if (app.referenceName.length < 2 || app.referenceContact.length < 5 || !REFERENCE_KINDS.includes(app.referenceKind as never)) error = 'invalid_reference';
  else if (b.rules !== true) error = 'rules_required';
  return { app, error };
}

export const portal = new Hono<AppContext>();

portal.use('*', async (c, next) => {
  if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401);
  await next();
});

// The person's shelters and where each stands.
portal.get('/shelters', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.slug, s.status, s.status_reason, s.place_id, m.role, a.submitted_at
       FROM shelter_members m JOIN shelters s ON s.id = m.shelter_id LEFT JOIN shelter_applications a ON a.shelter_id = s.id
      WHERE m.user_id = ? ORDER BY s.created_at`,
  )
    .bind(c.get('user')!.id)
    .all<{ id: string; name: string; slug: string; status: string; status_reason: string | null; place_id: string; role: Role; submitted_at: string | null }>();
  return c.json({
    shelters: results.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      status: r.status,
      statusReason: r.status_reason,
      place: placeById(r.place_id) ?? null,
      role: r.role,
      submittedAt: r.submitted_at,
    })),
  });
});

// Register a shelter: it starts pending, with the person as its owner.
portal.post('/shelters', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const { app, error } = readApplication(body);
  if (error) return c.json({ error }, 400);

  const db = c.env.DB;
  const owned = await db.prepare("SELECT count(*) AS n FROM shelter_members WHERE user_id = ? AND role = 'owner'").bind(user.id).first<{ n: number }>();
  if ((owned?.n ?? 0) >= MAX_OWNED) return c.json({ error: 'too_many_shelters' }, 409);

  // A readable, unique slug: "patitas-de-gazcue", then "patitas-de-gazcue-2", and so on.
  const base = slugify(app.name);
  const { results: taken } = await db.prepare("SELECT slug FROM shelters WHERE slug = ? OR slug LIKE ? || '-%'").bind(base, base).all<{ slug: string }>();
  const used = new Set(taken.map((t) => t.slug));
  let slug = base;
  for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;

  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare('INSERT INTO shelters (id, slug, name, description, place_id, phone, email, website, visit_hours, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, slug, app.name, app.description, app.placeId, app.publicPhone, app.email, app.website, app.visitHours, 'pending'),
    db
      .prepare(
        `INSERT INTO shelter_applications (shelter_id, contact_name, contact_phone, rnc, address, social, history, reference_name, reference_contact, reference_kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, app.contactName, app.contactPhone, app.rnc, app.address, JSON.stringify(app.social), app.history, app.referenceName, app.referenceContact, app.referenceKind),
    db.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'owner')").bind(id, user.id),
  ]);
  return c.json({ shelter: { id, slug, name: app.name, status: 'pending' } }, 201);
});

// One shelter, for its members. The private application is for owners only.
portal.get('/shelters/:id', async (c) => {
  const id = c.req.param('id');
  const role = await roleIn(c, id);
  if (!role) return c.json({ error: 'not_found' }, 404);
  const db = c.env.DB;
  const s = await db
    .prepare('SELECT id, slug, name, description, place_id, phone, email, website, visit_hours, status, status_reason, verified_at FROM shelters WHERE id = ?')
    .bind(id)
    .first<{ id: string; slug: string; name: string; description: string | null; place_id: string; phone: string | null; email: string | null; website: string | null; visit_hours: string | null; status: string; status_reason: string | null; verified_at: string | null }>();
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
      role,
    },
    application: a
      ? {
          contactName: a.contact_name,
          contactPhone: a.contact_phone,
          rnc: a.rnc,
          address: a.address,
          social: JSON.parse(a.social ?? '[]') as string[],
          history: a.history,
          reference: { name: a.reference_name, contact: a.reference_contact, kind: a.reference_kind },
          submittedAt: a.submitted_at,
        }
      : null,
  });
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
           reference_name = ?, reference_contact = ?, reference_kind = ?, submitted_at = ?, reviewed_at = NULL, reviewed_by = NULL
         WHERE shelter_id = ?`,
      )
      .bind(app.contactName, app.contactPhone, app.rnc, app.address, JSON.stringify(app.social), app.history, app.referenceName, app.referenceContact, app.referenceKind, now, id),
  ]);
  return c.json({ shelter: { id, status: 'pending' } });
});
