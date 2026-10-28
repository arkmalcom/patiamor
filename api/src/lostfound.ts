import { Hono, type Context } from 'hono';
import { nowIso } from './auth/crypto';
import { access, writeProblem, type Access } from './cases';
import { cachedJson, forgetCatalogVersion } from './cache';
import type { AppContext, Env } from './env';
import { photoUrl } from './pets';
import type { PhotoOwner } from './photos';
import { placeById } from './places';
import { contactNumbers } from '../../web/src/money';

// Lost and found (migration 0026, owner decision 2026-10-28): a verified shelter posts an animal someone lost,
// or one found in the street, so people nearby can recognise it. Only shelters post: whoever lost or found an
// animal goes through one, and people who respond call the shelter's public phone (required since the same
// day), so no owner's or finder's number is ever published, and a post's text can't carry one either. A
// shelter returning a found animal asks for proof it's theirs. Posts stay up 30 days unless renewed. The app
// shows them under the Rescate tab (/perdidos), nearest first; members and admins write them here.

type C = Context<AppContext>;

const KINDS = ['perdido', 'encontrado'] as const;
const SPECIES = ['perro', 'gato'] as const;
const SEXES = ['hembra', 'macho'] as const;
/** A post with no renewal for this long drops out of view: a lost animal is found or not within weeks. */
export const ACTIVE_DAYS = 30;
/** Drafts and open posts a shelter can have at once. */
const MAX_ACTIVE = 30;
const MIN_DESCRIPTION = 20;
/** How far back "when it was lost or seen" may go. */
const MAX_AGE_DAYS = 365;
/** All but the main photo go this long after a post ends, or after it was last active if it simply lapsed. */
const TRIM_AFTER_DAYS = 90;
const TRIM_BATCH = 200;

const SHELTER_OK = `s.status = 'verified' AND s.kind = 'shelter' AND s.phone IS NOT NULL`;
/** Who sees a post: open, published or renewed in the last 30 days, from a verified shelter with a phone. */
export const POST_VISIBLE = `l.status = 'open' AND l.active_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-${ACTIVE_DAYS} days') AND ${SHELTER_OK}`;

const COLUMNS = `l.id, l.kind, l.species, l.name, l.sex, l.seen_on, l.status, l.published_at, l.active_at, l.ended_at,
  s.id AS shelter_id, s.name AS shelter_name, p.id AS place_id, p.name AS place_name, p.municipality, p.province, p.lat, p.lng,
  (SELECT json_object('key', ph.r2_key, 'thumb', ph.thumb_key, 'focus', ph.focus) FROM lost_found_photos ph WHERE ph.post_id = l.id ORDER BY ph.position LIMIT 1) AS cover`;
const FROM = 'FROM lost_found l JOIN shelters s ON s.id = l.shelter_id JOIN places p ON p.id = l.place_id';

type Row = {
  id: string; kind: string; species: string; name: string | null; sex: string | null; seen_on: string; status: string;
  published_at: string | null; active_at: string | null; ended_at: string | null; shelter_id: string; shelter_name: string;
  place_id: string; place_name: string; municipality: string; province: string; lat: number; lng: number; cover: string | null;
};

function summary(r: Row) {
  const cover = r.cover ? (JSON.parse(r.cover) as { key: string; thumb: string | null; focus: string }) : null;
  return {
    id: r.id,
    kind: r.kind,
    species: r.species,
    name: r.name,
    sex: r.sex,
    seenOn: r.seen_on,
    // Where it was lost or seen: the phone measures how far that is from the person.
    place: { id: r.place_id, name: r.place_name, municipality: r.municipality, province: r.province, lat: r.lat, lng: r.lng },
    shelter: { id: r.shelter_id, name: r.shelter_name },
    photo: { url: photoUrl(cover?.key ?? null), thumb: photoUrl(cover?.thumb ?? null), focus: cover?.focus ?? '50% 40%' },
    publishedAt: r.published_at,
    activeAt: r.active_at,
  };
}

// ---------- What everyone sees ----------

export const lost = new Hono<AppContext>();

/** Every open post nationwide; the phone puts the nearest first. Shelters have at most 30 each. */
const LIST_CAP = 500;

lost.get('/', (c) =>
  cachedJson(c, '/lost', async () => {
    const { results } = await c.env.DB.prepare(`SELECT ${COLUMNS} ${FROM} WHERE ${POST_VISIBLE} ORDER BY l.active_at DESC LIMIT ?`).bind(LIST_CAP).all<Row>();
    return { body: { posts: results.map(summary) } };
  }),
);

lost.get('/:id', (c) => {
  const id = c.req.param('id');
  return cachedJson(c, `/lost/${encodeURIComponent(id)}`, () => detail(c.env.DB, id));
});

/** The same page (and the same cached copy), read by the link preview in share.ts. */
export async function cachedPost(c: C, id: string) {
  const res = await cachedJson(c, `/lost/${encodeURIComponent(id)}`, () => detail(c.env.DB, id));
  return res.json<{ post?: never; error?: string }>();
}

async function detail(db: D1Database, id: string): Promise<{ body: unknown; status?: 404 | 410 }> {
  const row = await db
    .prepare(`SELECT ${COLUMNS}, l.description, s.phone AS shelter_phone ${FROM} WHERE l.id = ? AND ${POST_VISIBLE}`)
    .bind(id)
    .first<Row & { description: string; shelter_phone: string }>();
  if (!row) return ended(db, id);
  const { results: photos } = await db.prepare('SELECT r2_key, focus FROM lost_found_photos WHERE post_id = ? ORDER BY position').bind(id).all<{ r2_key: string; focus: string }>();
  return {
    body: {
      post: {
        ...summary(row),
        description: row.description,
        photos: photos.map((p) => ({ url: photoUrl(p.r2_key), focus: p.focus })),
        shelter: { id: row.shelter_id, name: row.shelter_name, phone: row.shelter_phone },
      },
    },
  };
}

/** A post that was public and isn't now: the animal is home, the shelter closed it, or it lapsed. Old links
 *  say so, without the phone. */
async function ended(db: D1Database, id: string): Promise<{ body: unknown; status: 404 | 410 }> {
  const row = await db
    .prepare(`SELECT ${COLUMNS} ${FROM} WHERE l.id = ? AND l.published_at IS NOT NULL AND s.status = 'verified' AND s.kind = 'shelter'`)
    .bind(id)
    .first<Row>();
  if (!row) return { body: { error: 'not_found' }, status: 404 };
  const { kind, species, name, sex, photo, shelter, place } = summary(row);
  const status = row.status === 'open' ? 'expired' : row.status;
  return { body: { error: 'gone', post: { id, kind, species, name, sex, photo, shelter, place, status } }, status: 410 };
}

// ---------- The shelter's side (portal) ----------

type PostRow = {
  id: string; shelter_id: string; kind: string; species: string; name: string | null; sex: string | null; description: string; place_id: string;
  seen_on: string; status: string; published_at: string | null; active_at: string | null; ended_at: string | null; updated_at: string;
};

async function postFor(c: C, postId: string) {
  const row = await c.env.DB.prepare('SELECT * FROM lost_found WHERE id = ?').bind(postId).first<PostRow>();
  if (!row) return { error: 'not_found', status: 404 as const };
  const a = await access(c, row.shelter_id);
  return 'error' in a ? a : { row, ...a };
}

/** For photos.ts: the post, if this person can change its photos now. */
export async function editablePost(c: C, postId: string): Promise<{ owner: PhotoOwner } | { error: 'not_found' | 'shelter_suspended' | 'post_ended'; status: 404 | 409 }> {
  const found = await postFor(c, postId);
  if ('error' in found) return { error: 'not_found', status: 404 };
  if (writeProblem(found)) return { error: 'shelter_suspended', status: 409 };
  if (found.row.status === 'home' || found.row.status === 'closed') return { error: 'post_ended', status: 409 };
  return { owner: { id: found.row.id, table: 'lost_found_photos', column: 'post_id', prefix: 'lost', keepOne: found.row.status === 'open' } };
}

const oneOf = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => list.includes(v as T[number]);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

/** The form's fields, validated; `error` names the first problem (`numbers` with contact_in_text). */
function readPost(b: Record<string, unknown>) {
  const p = {
    kind: b.kind,
    species: b.species,
    name: text(b.name, 40).replace(/\s+/g, ' ') || null,
    sex: b.sex === null || b.sex === undefined || b.sex === '' ? null : b.sex,
    description: text(b.description, 1000),
    placeId: text(b.placeId, 80),
    seenOn: text(b.seenOn, 10),
  };
  let error: string | null = null;
  const numbers = contactNumbers(p.name, p.description);
  if (!oneOf(KINDS, p.kind)) error = 'invalid_kind';
  else if (!oneOf(SPECIES, p.species)) error = 'invalid_species';
  else if (p.sex !== null && !oneOf(SEXES, p.sex)) error = 'invalid_sex';
  else if (!placeById(p.placeId)) error = 'invalid_place';
  // Allow a day ahead: the phone's date may already be tomorrow in UTC.
  else if (!isDay(p.seenOn) || p.seenOn > day(1) || p.seenOn < day(-MAX_AGE_DAYS)) error = 'invalid_seen_on';
  else if (numbers.length) error = 'contact_in_text';
  return { p, error, numbers };
}

/** What a post needs before people can see it; null when it's ready. */
function publishProblem(a: Access, description: string, photos: number) {
  if (!a.shelter.phone) return 'no_public_phone';
  if (description.length < MIN_DESCRIPTION) return 'description_required';
  if (photos < 1) return 'photo_required';
  return null;
}

const badInput = (c: C, r: { error: string | null; numbers: string[] }) => c.json(r.error === 'contact_in_text' ? { error: r.error, numbers: r.numbers } : { error: r.error }, 400);

const portalPost = (r: PostRow) => ({
  id: r.id,
  kind: r.kind,
  species: r.species,
  name: r.name,
  sex: r.sex,
  description: r.description,
  place: placeById(r.place_id) ?? null,
  seenOn: r.seen_on,
  status: r.status,
  publishedAt: r.published_at,
  activeAt: r.active_at,
  endedAt: r.ended_at,
  updatedAt: r.updated_at,
  // Open, but hidden: 30 days without a renewal.
  expired: r.status === 'open' && !!r.active_at && Date.parse(r.active_at) < Date.now() - ACTIVE_DAYS * 86_400_000,
});

const shelterView = (a: Access) => ({ id: a.shelter.id, name: a.shelter.name, status: a.shelter.status, role: a.role, hasPhone: !!a.shelter.phone });

export const lostPortal = new Hono<AppContext>();

lostPortal.use('*', async (c, next) => {
  if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401);
  await next();
});

// The shelter's posts, every status.
lostPortal.get('/shelters/:id/lost', async (c) => {
  const a = await access(c, c.req.param('id'));
  if ('error' in a) return c.json({ error: a.error }, a.status);
  const db = c.env.DB;
  const [{ results: rows }, { results: covers }] = (await db.batch([
    db.prepare('SELECT * FROM lost_found WHERE shelter_id = ? ORDER BY updated_at DESC LIMIT 200').bind(a.shelter.id),
    db
      .prepare('SELECT ph.post_id, ph.r2_key, ph.thumb_key, ph.focus FROM lost_found_photos ph JOIN lost_found l ON l.id = ph.post_id WHERE l.shelter_id = ? AND ph.position = (SELECT min(position) FROM lost_found_photos WHERE post_id = ph.post_id)')
      .bind(a.shelter.id),
  ])) as [D1Result<PostRow>, D1Result<{ post_id: string; r2_key: string; thumb_key: string | null; focus: string }>];
  const cover = new Map(covers.map((p) => [p.post_id, { url: photoUrl(p.r2_key), thumb: photoUrl(p.thumb_key), focus: p.focus }]));
  return c.json({ shelter: shelterView(a), posts: rows.map((r) => ({ ...portalPost(r), photo: cover.get(r.id) ?? null })) });
});

// A new post: a draft first (photos are added to its id), then published with PUT.
lostPortal.post('/shelters/:id/lost', async (c) => {
  const a = await access(c, c.req.param('id'));
  if ('error' in a) return c.json({ error: a.error }, a.status);
  const problem = writeProblem(a);
  if (problem) return c.json({ error: problem }, 409);
  const r = readPost(await c.req.json<Record<string, unknown>>().catch(() => ({})));
  if (r.error) return badInput(c, r);
  const db = c.env.DB;
  const count = await db.prepare("SELECT count(*) AS n FROM lost_found WHERE shelter_id = ? AND status IN ('draft', 'open')").bind(a.shelter.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_ACTIVE) return c.json({ error: 'too_many_posts', max: MAX_ACTIVE }, 409);
  const id = crypto.randomUUID();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO lost_found (id, shelter_id, kind, species, name, sex, description, place_id, seen_on, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, a.shelter.id, r.p.kind, r.p.species, r.p.name, r.p.sex, r.p.description, r.p.placeId, r.p.seenOn, c.get('user')!.id, now, now)
    .run();
  return c.json({ post: { id, status: 'draft' } }, 201);
});

lostPortal.get('/lost/:id', async (c) => {
  const found = await postFor(c, c.req.param('id'));
  if ('error' in found) return c.json({ error: found.error }, found.status);
  const { results: photos } = await c.env.DB.prepare('SELECT id, r2_key, thumb_key, focus FROM lost_found_photos WHERE post_id = ? ORDER BY position')
    .bind(found.row.id)
    .all<{ id: string; r2_key: string; thumb_key: string | null; focus: string }>();
  return c.json({
    shelter: shelterView(found),
    post: { ...portalPost(found.row), photos: photos.map((p) => ({ id: p.id, url: photoUrl(p.r2_key), thumb: photoUrl(p.thumb_key), focus: p.focus })) },
  });
});

// Save changes; `publish: true` takes a draft live. An open post must keep meeting the publishing rules.
lostPortal.put('/lost/:id', async (c) => {
  const found = await postFor(c, c.req.param('id'));
  if ('error' in found) return c.json({ error: found.error }, found.status);
  const problem = writeProblem(found);
  if (problem) return c.json({ error: problem }, 409);
  const { row } = found;
  if (row.status === 'home' || row.status === 'closed') return c.json({ error: 'post_ended' }, 409);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const r = readPost(body);
  if (r.error) return badInput(c, r);
  const db = c.env.DB;
  const status = row.status === 'draft' && body.publish === true ? 'open' : row.status;
  if (status === 'open') {
    const photos = await db.prepare('SELECT count(*) AS n FROM lost_found_photos WHERE post_id = ?').bind(row.id).first<{ n: number }>();
    const unready = publishProblem(found, r.p.description, photos?.n ?? 0);
    if (unready) return c.json({ error: unready }, 409);
  }
  const now = nowIso();
  const publishing = status === 'open' && row.status === 'draft';
  await db
    .prepare(
      `UPDATE lost_found SET kind = ?, species = ?, name = ?, sex = ?, description = ?, place_id = ?, seen_on = ?, status = ?,
         published_at = coalesce(published_at, ?), active_at = CASE WHEN ? THEN ? ELSE active_at END, updated_at = ?
       WHERE id = ?`,
    )
    .bind(r.p.kind, r.p.species, r.p.name, r.p.sex, r.p.description, r.p.placeId, r.p.seenOn, status, publishing ? now : null, publishing ? 1 : 0, now, now, row.id)
    .run();
  if (status === 'open') forgetCatalogVersion();
  return c.json({ post: { id: row.id, status } });
});

// "Sigue perdido": another 30 days in view.
lostPortal.post('/lost/:id/renew', async (c) => {
  const found = await postFor(c, c.req.param('id'));
  if ('error' in found) return c.json({ error: found.error }, found.status);
  const problem = writeProblem(found);
  if (problem) return c.json({ error: problem }, 409);
  if (found.row.status !== 'open') return c.json({ error: 'not_open' }, 409);
  const now = nowIso();
  await c.env.DB.prepare('UPDATE lost_found SET active_at = ?, updated_at = ? WHERE id = ?').bind(now, now, found.row.id).run();
  forgetCatalogVersion();
  return c.json({ post: { id: found.row.id, activeAt: now } });
});

// Ending an open post: { status: 'home' } (it's back with its family) or 'closed' (anything else).
lostPortal.post('/lost/:id/end', async (c) => {
  const found = await postFor(c, c.req.param('id'));
  if ('error' in found) return c.json({ error: found.error }, found.status);
  const problem = writeProblem(found);
  if (problem) return c.json({ error: problem }, 409);
  if (found.row.status !== 'open') return c.json({ error: 'not_open' }, 409);
  const b = await c.req.json<{ status?: unknown }>().catch(() => ({}) as { status?: unknown });
  if (b.status !== 'home' && b.status !== 'closed') return c.json({ error: 'invalid_status' }, 400);
  const now = nowIso();
  await c.env.DB.prepare('UPDATE lost_found SET status = ?, ended_at = ?, updated_at = ? WHERE id = ?').bind(b.status, now, now, found.row.id).run();
  forgetCatalogVersion();
  return c.json({ post: { id: found.row.id, status: b.status } });
});

// A draft that won't be published: gone, with its photos.
lostPortal.delete('/lost/:id', async (c) => {
  const found = await postFor(c, c.req.param('id'));
  if ('error' in found) return c.json({ error: found.error }, found.status);
  if (found.row.status !== 'draft') return c.json({ error: 'not_draft' }, 409);
  const db = c.env.DB;
  const { results: photos } = await db.prepare('SELECT r2_key, thumb_key FROM lost_found_photos WHERE post_id = ?').bind(found.row.id).all<{ r2_key: string; thumb_key: string | null }>();
  await db.prepare('DELETE FROM lost_found WHERE id = ?').bind(found.row.id).run();
  const keys = photos.flatMap((p) => [p.r2_key, ...(p.thumb_key ? [p.thumb_key] : [])]).filter((k) => !k.startsWith('static:'));
  if (keys.length) await c.env.PHOTOS.delete(keys).catch((err) => console.error('deleting a draft post: R2 delete failed', keys.length, err));
  return c.json({ ok: true });
});

/** The morning job: 90 days after a post ends (or after it was last active, if it simply lapsed), every photo
 *  but the main one goes (from D1, then R2). */
export async function trimLostFoundPhotos(env: Env): Promise<{ photos: number }> {
  const db = env.DB;
  const { results } = await db
    .prepare(
      `SELECT ph.id, ph.r2_key, ph.thumb_key FROM lost_found_photos ph JOIN lost_found l ON l.id = ph.post_id
        WHERE ((l.status IN ('home', 'closed') AND l.ended_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-${TRIM_AFTER_DAYS} days'))
            OR (l.status = 'open' AND l.active_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-${ACTIVE_DAYS + TRIM_AFTER_DAYS} days')))
          AND ph.position > (SELECT min(position) FROM lost_found_photos WHERE post_id = l.id)
          AND ph.r2_key NOT LIKE 'static:%'
        LIMIT ${TRIM_BATCH}`,
    )
    .all<{ id: string; r2_key: string; thumb_key: string | null }>();
  if (!results.length) return { photos: 0 };
  await db.prepare('DELETE FROM lost_found_photos WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(results.map((r) => r.id))).run();
  const keys = results.flatMap((r) => [r.r2_key, ...(r.thumb_key ? [r.thumb_key] : [])]);
  await env.PHOTOS.delete(keys).catch((err) => console.error('trimming lost and found photos: R2 delete failed', keys.length, err));
  return { photos: results.length };
}
