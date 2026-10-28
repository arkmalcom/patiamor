import { Hono, type Context } from 'hono';
import { nowIso } from './auth/crypto';
import { cachedJson, forgetCatalogVersion } from './cache';
import { donationFor } from './donations';
import type { AppContext, Env } from './env';
import { photoUrl, VIEWABLE } from './pets';
import type { PhotoOwner } from './photos';
import { roleIn, type Role } from './portal';
import { contactNumbers } from '../../web/src/money';

// Help cases (migration 0025, owner decision 2026-10-28): a shelter asks for help with an animal's surgery,
// treatment, exams or recovery, apart from adoption. Donors give straight to the shelter's own accounts
// (donations.ts): Patiamor never handles the money, and a case's text can't carry a phone or account number
// to send it elsewhere. Only verified shelters publish (never private listers, who can't ask for money), and
// only while they have accounts to give to; an admin may publish one for a shelter. Trust comes from the
// shelters themselves, which an admin knows, so there's no review queue. Members and admins write here; the
// app shows open cases at /ayudar. Photos are managed in photos.ts.
//
// Code here uses pets.ts (which also uses this module) only inside functions, so the import cycle is safe.

type C = Context<AppContext>;

const SPECIES = ['perro', 'gato'] as const;
export const NEEDS = ['cirugia', 'tratamiento', 'examenes', 'medicinas', 'recuperacion', 'otro'] as const;
/** A case with no news for this long drops out of view until the shelter posts some. */
export const STALE_DAYS = 60;
/** Drafts and open cases a shelter can have at once. */
const MAX_ACTIVE = 10;
const MAX_UPDATES = 60;
const MIN_STORY = 40;
const MIN_UPDATE = 10;
const MIN_OUTCOME = 20;
export const MAX_COST_DOP = 2_000_000;
/** Like adopted animals' photos (lifecycle.ts): all but the main one go this long after a case ends. */
const TRIM_AFTER_DAYS = 90;
const TRIM_BATCH = 200;

const FRESH = `k.active_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-${STALE_DAYS} days')`;
/** A shelter whose cases donors may see: verified, a real shelter, with somewhere to give. */
const SHELTER_OK = `s.status = 'verified' AND s.kind = 'shelter' AND EXISTS (SELECT 1 FROM shelter_donation_accounts a WHERE a.shelter_id = s.id)`;
/** Who sees a case: open, with news in the last 60 days, from a shelter as above. `k` is cases, `s` shelters. */
export const CASE_VISIBLE = `k.status = 'open' AND ${FRESH} AND ${SHELTER_OK}`;

const COLUMNS = `k.id, k.species, k.name, k.need, k.cost_dop, k.status, k.pet_id, k.published_at, k.active_at, k.ended_at, k.outcome,
  s.id AS shelter_id, s.name AS shelter_name, p.name AS place_name, p.municipality,
  (SELECT json_object('key', ph.r2_key, 'thumb', ph.thumb_key, 'focus', ph.focus) FROM case_photos ph WHERE ph.case_id = k.id ORDER BY ph.position LIMIT 1) AS cover`;
const FROM = 'FROM cases k JOIN shelters s ON s.id = k.shelter_id JOIN places p ON p.id = s.place_id';

type Row = {
  id: string; species: string; name: string; need: string; cost_dop: number | null; status: string; pet_id: string | null;
  published_at: string | null; active_at: string | null; ended_at: string | null; outcome: string | null;
  shelter_id: string; shelter_name: string; place_name: string; municipality: string; cover: string | null;
};

function summary(r: Row) {
  const cover = r.cover ? (JSON.parse(r.cover) as { key: string; thumb: string | null; focus: string }) : null;
  return {
    id: r.id,
    species: r.species,
    name: r.name,
    need: r.need,
    costDop: r.cost_dop,
    shelter: { id: r.shelter_id, name: r.shelter_name },
    place: { name: r.place_name, municipality: r.municipality },
    photo: { url: photoUrl(cover?.key ?? null), thumb: photoUrl(cover?.thumb ?? null), focus: cover?.focus ?? '50% 40%' },
    publishedAt: r.published_at,
    activeAt: r.active_at,
  };
}

// ---------- What donors see ----------

export const cases = new Hono<AppContext>();

/** Few shelters publish cases, and each has at most 10 open: this is every open case, newest news first. */
const LIST_CAP = 200;

cases.get('/', (c) =>
  cachedJson(c, '/cases', async () => {
    const { results } = await c.env.DB.prepare(`SELECT ${COLUMNS} ${FROM} WHERE ${CASE_VISIBLE} ORDER BY k.active_at DESC LIMIT ?`).bind(LIST_CAP).all<Row>();
    return { body: { cases: results.map(summary) } };
  }),
);

cases.get('/:id', (c) => {
  const id = c.req.param('id');
  return cachedJson(c, `/cases/${encodeURIComponent(id)}`, () => detail(c.env.DB, id));
});

/** The same page (and the same cached copy), read by the link preview in share.ts. */
export async function cachedCase(c: C, id: string) {
  const res = await cachedJson(c, `/cases/${encodeURIComponent(id)}`, () => detail(c.env.DB, id));
  return res.json<{ case?: never; error?: string }>();
}

async function detail(db: D1Database, id: string): Promise<{ body: unknown; status?: 404 | 410 }> {
  const row = await db
    .prepare(`SELECT ${COLUMNS}, k.story, k.also_needed, s.description AS shelter_description, s.donation_note ${FROM} WHERE k.id = ? AND ${CASE_VISIBLE}`)
    .bind(id)
    .first<Row & { story: string; also_needed: string | null; shelter_description: string | null; donation_note: string | null }>();
  if (!row) return ended(db, id);
  const [{ results: photos }, { results: updates }, donation, pet] = await Promise.all([
    db.prepare('SELECT r2_key, focus FROM case_photos WHERE case_id = ? ORDER BY position').bind(id).all<{ r2_key: string; focus: string }>(),
    db.prepare('SELECT id, body, created_at FROM case_updates WHERE case_id = ? ORDER BY created_at DESC LIMIT ?').bind(id, MAX_UPDATES).all<{ id: string; body: string; created_at: string }>(),
    donationFor(db, row.shelter_id, row.donation_note),
    // The same animal looking for a family, while adopters can see it.
    row.pet_id
      ? db.prepare(`SELECT d.id, d.name FROM pets d LEFT JOIN shelters s ON s.id = d.shelter_id WHERE d.id = ? AND ${VIEWABLE}`).bind(row.pet_id).first<{ id: string; name: string }>()
      : Promise.resolve(null),
  ]);
  return {
    body: {
      case: {
        ...summary(row),
        story: row.story,
        alsoNeeded: row.also_needed,
        photos: photos.map((p) => ({ url: photoUrl(p.r2_key), focus: p.focus })),
        updates: updates.map((u) => ({ id: u.id, body: u.body, at: u.created_at })),
        shelter: { id: row.shelter_id, name: row.shelter_name, description: row.shelter_description, donation },
        pet: pet ? { id: pet.id, name: pet.name } : null,
      },
    },
  };
}

/** A case that was public and isn't now: it ended (with what happened), or it's paused (no news in 60 days,
 *  or the shelter has no accounts). Old links say so, never showing accounts. */
async function ended(db: D1Database, id: string): Promise<{ body: unknown; status: 404 | 410 }> {
  const row = await db
    .prepare(`SELECT ${COLUMNS} ${FROM} WHERE k.id = ? AND k.published_at IS NOT NULL AND s.status = 'verified' AND s.kind = 'shelter'`)
    .bind(id)
    .first<Row>();
  if (!row) return { body: { error: 'not_found' }, status: 404 };
  const { name, species, photo, shelter } = summary(row);
  const status = row.status === 'open' ? 'paused' : row.status;
  return { body: { error: 'gone', case: { id, name, species, photo, shelter, status, outcome: row.status === 'open' ? null : row.outcome, endedAt: row.ended_at } }, status: 410 };
}

// ---------- The shelter's side (portal) ----------

type Access = { role: Role | 'admin'; shelter: { id: string; name: string; status: string; kind: string; accounts: number } };

/** Members of the shelter, or an admin publishing for it. Private listers have no cases (they can't ask for money). */
async function access(c: C, shelterId: string): Promise<Access | { error: string; status: 403 | 404 }> {
  const role = (await roleIn(c, shelterId)) ?? (c.get('user')?.is_admin ? ('admin' as const) : null);
  if (!role) return { error: 'not_found', status: 404 };
  const shelter = await c.env.DB.prepare(
    'SELECT id, name, status, kind, (SELECT count(*) FROM shelter_donation_accounts a WHERE a.shelter_id = shelters.id) AS accounts FROM shelters WHERE id = ?',
  )
    .bind(shelterId)
    .first<Access['shelter']>();
  if (!shelter) return { error: 'not_found', status: 404 };
  if (shelter.kind !== 'shelter') return { error: 'not_for_private', status: 403 };
  return { role, shelter };
}

/** Changes need a verified shelter: cases are never drafted by one still in review, or a suspended one. */
const writeProblem = (a: Access) => (a.shelter.status === 'verified' ? null : a.shelter.status === 'suspended' ? 'shelter_suspended' : 'shelter_not_verified');

type CaseRow = {
  id: string; shelter_id: string; pet_id: string | null; species: string; name: string; need: string; story: string; cost_dop: number | null;
  also_needed: string | null; status: string; outcome: string | null; published_at: string | null; active_at: string | null; ended_at: string | null; updated_at: string;
};

/** The case and the person's access to its shelter. */
async function caseFor(c: C, caseId: string) {
  const row = await c.env.DB.prepare('SELECT * FROM cases WHERE id = ?').bind(caseId).first<CaseRow>();
  if (!row) return { error: 'not_found', status: 404 as const };
  const a = await access(c, row.shelter_id);
  return 'error' in a ? a : { row, ...a };
}

/** For photos.ts: the case, if this person can change its photos now. */
export async function editableCase(c: C, caseId: string): Promise<{ owner: PhotoOwner } | { error: 'not_found' | 'shelter_suspended' | 'case_ended'; status: 404 | 409 }> {
  const found = await caseFor(c, caseId);
  if ('error' in found) return { error: 'not_found', status: 404 };
  if (writeProblem(found)) return { error: 'shelter_suspended', status: 409 };
  if (found.row.status === 'resolved' || found.row.status === 'closed') return { error: 'case_ended', status: 409 };
  return { owner: { id: found.row.id, table: 'case_photos', column: 'case_id', prefix: 'cases', keepOne: found.row.status === 'open' } };
}

const oneOf = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => list.includes(v as T[number]);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** The form's fields, validated; `error` names the first problem (`numbers` with contact_in_text). */
function readCase(b: Record<string, unknown>) {
  const cost = b.costDop === null || b.costDop === undefined || b.costDop === '' ? null : Number(b.costDop);
  const k = {
    species: b.species,
    name: text(b.name, 40).replace(/\s+/g, ' '),
    need: b.need,
    story: text(b.story, 2000),
    cost,
    alsoNeeded: text(b.alsoNeeded, 300) || null,
    petId: text(b.petId, 64) || null,
  };
  let error: string | null = null;
  const numbers = contactNumbers(k.name, k.story, k.alsoNeeded);
  if (!oneOf(SPECIES, k.species)) error = 'invalid_species';
  else if (!k.name) error = 'invalid_name';
  else if (!oneOf(NEEDS, k.need)) error = 'invalid_need';
  else if (cost !== null && !(Number.isInteger(cost) && cost >= 1 && cost <= MAX_COST_DOP)) error = 'invalid_cost';
  else if (numbers.length) error = 'contact_in_text';
  return { k, error, numbers };
}

/** What a case needs before donors can see it; null when it's ready. */
function publishProblem(a: Access, story: string, photos: number) {
  if (a.shelter.accounts < 1) return 'no_donation_accounts';
  if (story.length < MIN_STORY) return 'story_required';
  if (photos < 1) return 'photo_required';
  return null;
}

const badInput = (c: C, r: { error: string | null; numbers: string[] }) => c.json(r.error === 'contact_in_text' ? { error: r.error, numbers: r.numbers } : { error: r.error }, 400);

/** A pet linked to a case must be one of this shelter's animals still with it. */
async function petOk(db: D1Database, shelterId: string, petId: string | null) {
  if (!petId) return true;
  return !!(await db.prepare("SELECT 1 FROM pets WHERE id = ? AND shelter_id = ? AND status NOT IN ('adopted', 'withdrawn')").bind(petId, shelterId).first());
}

const portalCase = (r: CaseRow) => ({
  id: r.id,
  species: r.species,
  name: r.name,
  need: r.need,
  story: r.story,
  costDop: r.cost_dop,
  alsoNeeded: r.also_needed,
  petId: r.pet_id,
  status: r.status,
  outcome: r.outcome,
  publishedAt: r.published_at,
  activeAt: r.active_at,
  endedAt: r.ended_at,
  updatedAt: r.updated_at,
  // Open, but hidden for want of news.
  stale: r.status === 'open' && !!r.active_at && Date.parse(r.active_at) < Date.now() - STALE_DAYS * 86_400_000,
});

const shelterView = (a: Access) => ({ id: a.shelter.id, name: a.shelter.name, status: a.shelter.status, role: a.role, hasDonation: a.shelter.accounts > 0 });

export const casePortal = new Hono<AppContext>();

casePortal.use('*', async (c, next) => {
  if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401);
  await next();
});

// The shelter's cases, every status, and the animals a case can be linked to.
casePortal.get('/shelters/:id/cases', async (c) => {
  const a = await access(c, c.req.param('id'));
  if ('error' in a) return c.json({ error: a.error }, a.status);
  const db = c.env.DB;
  const [{ results: rows }, { results: covers }, { results: pets }] = await db.batch([
    db.prepare('SELECT * FROM cases WHERE shelter_id = ? ORDER BY updated_at DESC LIMIT 200').bind(a.shelter.id),
    db.prepare('SELECT ph.case_id, ph.r2_key, ph.thumb_key, ph.focus FROM case_photos ph JOIN cases k ON k.id = ph.case_id WHERE k.shelter_id = ? AND ph.position = (SELECT min(position) FROM case_photos WHERE case_id = ph.case_id)').bind(a.shelter.id),
    db.prepare("SELECT id, name, species FROM pets WHERE shelter_id = ? AND status NOT IN ('adopted', 'withdrawn') ORDER BY name LIMIT 300").bind(a.shelter.id),
  ]) as [D1Result<CaseRow>, D1Result<{ case_id: string; r2_key: string; thumb_key: string | null; focus: string }>, D1Result<{ id: string; name: string; species: string }>];
  const cover = new Map(covers.map((p) => [p.case_id, { url: photoUrl(p.r2_key), thumb: photoUrl(p.thumb_key), focus: p.focus }]));
  return c.json({
    shelter: shelterView(a),
    cases: rows.map((r) => ({ ...portalCase(r), photo: cover.get(r.id) ?? null })),
    pets,
  });
});

// A new case: always a draft first (photos are added to its id), then published with PUT.
casePortal.post('/shelters/:id/cases', async (c) => {
  const a = await access(c, c.req.param('id'));
  if ('error' in a) return c.json({ error: a.error }, a.status);
  const problem = writeProblem(a);
  if (problem) return c.json({ error: problem }, 409);
  const r = readCase(await c.req.json<Record<string, unknown>>().catch(() => ({})));
  if (r.error) return badInput(c, r);
  const db = c.env.DB;
  if (!(await petOk(db, a.shelter.id, r.k.petId))) return c.json({ error: 'invalid_pet' }, 400);
  const count = await db.prepare("SELECT count(*) AS n FROM cases WHERE shelter_id = ? AND status IN ('draft', 'open')").bind(a.shelter.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_ACTIVE) return c.json({ error: 'too_many_cases', max: MAX_ACTIVE }, 409);
  const id = crypto.randomUUID();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO cases (id, shelter_id, pet_id, species, name, need, story, cost_dop, also_needed, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, a.shelter.id, r.k.petId, r.k.species, r.k.name, r.k.need, r.k.story, r.k.cost, r.k.alsoNeeded, c.get('user')!.id, now, now)
    .run();
  return c.json({ case: { id, status: 'draft' } }, 201);
});

// One case, everything its page in the portal needs.
casePortal.get('/cases/:id', async (c) => {
  const found = await caseFor(c, c.req.param('id'));
  if ('error' in found) return c.json({ error: found.error }, found.status);
  const db = c.env.DB;
  const [{ results: photos }, { results: updates }, { results: pets }] = await db.batch([
    db.prepare('SELECT id, r2_key, thumb_key, focus FROM case_photos WHERE case_id = ? ORDER BY position').bind(found.row.id),
    db.prepare('SELECT id, body, created_at FROM case_updates WHERE case_id = ? ORDER BY created_at DESC').bind(found.row.id),
    db.prepare("SELECT id, name, species FROM pets WHERE shelter_id = ? AND status NOT IN ('adopted', 'withdrawn') ORDER BY name LIMIT 300").bind(found.row.shelter_id),
  ]) as [D1Result<{ id: string; r2_key: string; thumb_key: string | null; focus: string }>, D1Result<{ id: string; body: string; created_at: string }>, D1Result<{ id: string; name: string; species: string }>];
  return c.json({
    shelter: shelterView(found),
    case: {
      ...portalCase(found.row),
      photos: photos.map((p) => ({ id: p.id, url: photoUrl(p.r2_key), thumb: photoUrl(p.thumb_key), focus: p.focus })),
      updates: updates.map((u) => ({ id: u.id, body: u.body, at: u.created_at })),
    },
    pets,
  });
});

// Save changes; `publish: true` takes a draft live. An open case must keep meeting the publishing rules.
casePortal.put('/cases/:id', async (c) => {
  const found = await caseFor(c, c.req.param('id'));
  if ('error' in found) return c.json({ error: found.error }, found.status);
  const problem = writeProblem(found);
  if (problem) return c.json({ error: problem }, 409);
  const { row } = found;
  if (row.status === 'resolved' || row.status === 'closed') return c.json({ error: 'case_ended' }, 409);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const r = readCase(body);
  if (r.error) return badInput(c, r);
  const db = c.env.DB;
  if (r.k.petId !== row.pet_id && !(await petOk(db, row.shelter_id, r.k.petId))) return c.json({ error: 'invalid_pet' }, 400);
  const status = row.status === 'draft' && body.publish === true ? 'open' : row.status;
  if (status === 'open') {
    const photos = await db.prepare('SELECT count(*) AS n FROM case_photos WHERE case_id = ?').bind(row.id).first<{ n: number }>();
    const unready = publishProblem(found, r.k.story, photos?.n ?? 0);
    if (unready) return c.json({ error: unready }, 409);
  }
  const now = nowIso();
  const publishing = status === 'open' && row.status === 'draft';
  await db
    .prepare(
      `UPDATE cases SET pet_id = ?, species = ?, name = ?, need = ?, story = ?, cost_dop = ?, also_needed = ?, status = ?,
         published_at = coalesce(published_at, ?), active_at = CASE WHEN ? THEN ? ELSE active_at END, updated_at = ?
       WHERE id = ?`,
    )
    .bind(r.k.petId, r.k.species, r.k.name, r.k.need, r.k.story, r.k.cost, r.k.alsoNeeded, status, publishing ? now : null, publishing ? 1 : 0, now, now, row.id)
    .run();
  if (status === 'open') forgetCatalogVersion();
  return c.json({ case: { id: row.id, status } });
});

// A draft that won't be published: gone, with its photos.
casePortal.delete('/cases/:id', async (c) => {
  const found = await caseFor(c, c.req.param('id'));
  if ('error' in found) return c.json({ error: found.error }, found.status);
  if (found.row.status !== 'draft') return c.json({ error: 'not_draft' }, 409);
  const db = c.env.DB;
  const { results: photos } = await db.prepare('SELECT r2_key, thumb_key FROM case_photos WHERE case_id = ?').bind(found.row.id).all<{ r2_key: string; thumb_key: string | null }>();
  await db.prepare('DELETE FROM cases WHERE id = ?').bind(found.row.id).run();
  const keys = photos.flatMap((p) => [p.r2_key, ...(p.thumb_key ? [p.thumb_key] : [])]).filter((k) => !k.startsWith('static:'));
  if (keys.length) await c.env.PHOTOS.delete(keys).catch((err) => console.error('deleting a draft case: R2 delete failed', keys.length, err));
  return c.json({ ok: true });
});

// News on an open case: { body }. It also brings a case hidden for want of news back into view.
casePortal.post('/cases/:id/updates', async (c) => {
  const found = await caseFor(c, c.req.param('id'));
  if ('error' in found) return c.json({ error: found.error }, found.status);
  const problem = writeProblem(found);
  if (problem) return c.json({ error: problem }, 409);
  if (found.row.status !== 'open') return c.json({ error: 'not_open' }, 409);
  const b = await c.req.json<{ body?: unknown }>().catch(() => ({}) as { body?: unknown });
  const body = text(b.body, 1000);
  if (body.length < MIN_UPDATE) return c.json({ error: 'update_too_short', min: MIN_UPDATE }, 400);
  const numbers = contactNumbers(body);
  if (numbers.length) return c.json({ error: 'contact_in_text', numbers }, 400);
  const db = c.env.DB;
  const count = await db.prepare('SELECT count(*) AS n FROM case_updates WHERE case_id = ?').bind(found.row.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_UPDATES) return c.json({ error: 'too_many_updates', max: MAX_UPDATES }, 409);
  const id = crypto.randomUUID();
  const now = nowIso();
  await db.batch([
    db.prepare('INSERT INTO case_updates (id, case_id, body, created_by, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, found.row.id, body, c.get('user')!.id, now),
    db.prepare('UPDATE cases SET active_at = ?, updated_at = ? WHERE id = ?').bind(now, now, found.row.id),
  ]);
  forgetCatalogVersion();
  return c.json({ update: { id, body, at: now } }, 201);
});

// Taking back news posted by mistake. The case stays as fresh as it was.
casePortal.delete('/cases/:id/updates/:updateId', async (c) => {
  const found = await caseFor(c, c.req.param('id'));
  if ('error' in found) return c.json({ error: found.error }, found.status);
  const problem = writeProblem(found);
  if (problem) return c.json({ error: problem }, 409);
  const gone = await c.env.DB.prepare('DELETE FROM case_updates WHERE id = ? AND case_id = ? RETURNING id').bind(c.req.param('updateId'), found.row.id).all();
  if (!gone.results.length) return c.json({ error: 'not_found' }, 404);
  forgetCatalogVersion();
  return c.json({ ok: true });
});

// Ending an open case: { status: 'resolved' | 'closed', outcome } says what happened, for everyone who helped.
casePortal.post('/cases/:id/end', async (c) => {
  const found = await caseFor(c, c.req.param('id'));
  if ('error' in found) return c.json({ error: found.error }, found.status);
  const problem = writeProblem(found);
  if (problem) return c.json({ error: problem }, 409);
  if (found.row.status !== 'open') return c.json({ error: 'not_open' }, 409);
  const b = await c.req.json<{ status?: unknown; outcome?: unknown }>().catch(() => ({}) as { status?: unknown; outcome?: unknown });
  if (b.status !== 'resolved' && b.status !== 'closed') return c.json({ error: 'invalid_status' }, 400);
  const outcome = text(b.outcome, 1000);
  if (outcome.length < MIN_OUTCOME) return c.json({ error: 'outcome_too_short', min: MIN_OUTCOME }, 400);
  const numbers = contactNumbers(outcome);
  if (numbers.length) return c.json({ error: 'contact_in_text', numbers }, 400);
  const now = nowIso();
  await c.env.DB.prepare('UPDATE cases SET status = ?, outcome = ?, ended_at = ?, updated_at = ? WHERE id = ?').bind(b.status, outcome, now, now, found.row.id).run();
  forgetCatalogVersion();
  return c.json({ case: { id: found.row.id, status: b.status } });
});

/** The morning job: 90 days after a case ends, every photo but the main one goes (from D1, then R2). */
export async function trimEndedCasePhotos(env: Env): Promise<{ photos: number }> {
  const db = env.DB;
  const { results } = await db
    .prepare(
      `SELECT ph.id, ph.r2_key, ph.thumb_key FROM case_photos ph JOIN cases k ON k.id = ph.case_id
        WHERE k.status IN ('resolved', 'closed') AND k.ended_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-${TRIM_AFTER_DAYS} days')
          AND ph.position > (SELECT min(position) FROM case_photos WHERE case_id = k.id)
          AND ph.r2_key NOT LIKE 'static:%'
        LIMIT ${TRIM_BATCH}`,
    )
    .all<{ id: string; r2_key: string; thumb_key: string | null }>();
  if (!results.length) return { photos: 0 };
  await db.prepare('DELETE FROM case_photos WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(results.map((r) => r.id))).run();
  const keys = results.flatMap((r) => [r.r2_key, ...(r.thumb_key ? [r.thumb_key] : [])]);
  await env.PHOTOS.delete(keys).catch((err) => console.error('trimming ended cases\' photos: R2 delete failed', keys.length, err));
  return { photos: results.length };
}
