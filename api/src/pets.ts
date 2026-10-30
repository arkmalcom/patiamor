import { Hono, type Context } from 'hono';
import { cachedJson } from './cache';
import { CASE_VISIBLE } from './cases';
import { donationFor } from './donations';
import type { AppContext } from './env';

// Who may see a pet publicly. One definition, used by search, profiles, siblings and adoption requests:
// available; from a verified shelter or a private lister; and at least 8 weeks old (anti puppy-mill rule).
const PUBLIC = `(d.shelter_id IS NULL OR s.status = 'verified')
  AND (d.birth_date IS NULL OR d.birth_date <= date('now', '-56 days'))`;
export const VISIBLE = `d.status = 'available' AND ${PUBLIC}`;
/** Browsing shows available pets; a profile (and saving) also works for one "en proceso" with a family. */
export const VIEWABLE = `d.status IN ('available', 'reserved') AND ${PUBLIC}`;

/** Requests pause on their own at this many open ones, so a viral pet can't flood a small rescue. */
export const REQUEST_CAP = 10;
/** From this many, adopters see a gentle "ya tiene varias solicitudes" (never an exact count). */
const BUSY_AT = 3;

// The pet list is cached per area square, not per visitor: the visitor's point snaps to a square of
// CELL degrees (~55 km), and everyone in that square shares one cached copy. The list holds the visible
// pets nearest to the square's centre, first to last, with no distance limit: while there are few shelters
// the animals can be far from a visitor (Punta Cana to Santo Domingo is 160 km), and the app's "Todo el
// país" shows them. The phone measures exact distances and filters locally.
const CELL = 0.5;
/** Past this many the farthest pets drop first; see PAT-28. */
const LIST_CAP = 1000;
// Squares outside the Dominican Republic all snap to its edge, so made-up points can't mint new copies.
const DR = { lat: [17.4, 20.0], lng: [-72.1, -68.2] } as const;
const clampTo = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

/** Sample photos ship with the web app ("static:" keys); real uploads will be served from R2. */
export const photoUrl = (key: string | null) => (!key ? null : key.startsWith('static:') ? key.slice(7) : `/api/photos/${encodeURIComponent(key)}`);

const KM_SQL = `6371 * acos(min(1, cos(radians(?1)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(?2)) + sin(radians(?1)) * sin(radians(p.lat))))`;

export const SUMMARY_COLUMNS = `d.id, d.species, d.name, d.sex, d.birth_date, d.birth_date_estimated, d.size, d.energy,
  d.good_with_kids, d.good_with_dogs, d.good_with_cats, d.vaccinated, d.sterilized, d.dewormed, d.litter_id, d.status,
  d.open_requests, d.requests_paused, d.fostered,
  p.id AS place_id, p.name AS place_name, p.municipality, p.province, p.lat, p.lng,
  s.id AS shelter_id, s.name AS shelter_name, s.kind AS shelter_kind,
  (SELECT json_object('key', ph.r2_key, 'thumb', ph.thumb_key, 'focus', ph.focus, 'count', (SELECT count(*) FROM pet_photos n WHERE n.pet_id = d.id))
     FROM pet_photos ph WHERE ph.pet_id = d.id ORDER BY ph.position LIMIT 1) AS cover`;
// One lookup for the cover photo, not one per column: D1 bills every row read, and this runs per pet. The
// count (at most 5 rows) lets cards show how many photos there are; the photos themselves come with the profile.

// A shelter's animals are at the shelter: its place wins over whatever place the listing carries.
export const PET_JOINS = `LEFT JOIN shelters s ON s.id = d.shelter_id JOIN places p ON p.id = COALESCE(s.place_id, d.place_id)`;
const FROM = `FROM pets d ${PET_JOINS}`;

type Bool = 0 | 1 | null;
export interface SummaryRow {
  id: string; species: string; name: string; sex: string; birth_date: string | null; birth_date_estimated: number; size: string; energy: string;
  good_with_kids: Bool; good_with_dogs: Bool; good_with_cats: Bool; vaccinated: number; sterilized: number; dewormed: number;
  litter_id: string | null; status: string; open_requests: number; requests_paused: number; fostered: number;
  place_id: string; place_name: string; municipality: string; province: string; lat: number; lng: number;
  shelter_id: string | null; shelter_name: string | null; shelter_kind: string | null; cover: string | null;
}

const bool = (v: Bool) => (v === null ? null : v === 1);

export function summary(r: SummaryRow) {
  const cover = r.cover ? (JSON.parse(r.cover) as { key: string; thumb: string | null; focus: string; count: number }) : null;
  return {
    id: r.id,
    species: r.species,
    name: r.name,
    sex: r.sex,
    birthDate: r.birth_date,
    birthDateEstimated: r.birth_date_estimated === 1,
    size: r.size,
    energy: r.energy,
    goodWith: { kids: bool(r.good_with_kids), dogs: bool(r.good_with_dogs), cats: bool(r.good_with_cats) },
    health: { vaccinated: r.vaccinated === 1, sterilized: r.sterilized === 1, dewormed: r.dewormed === 1 },
    litterId: r.litter_id,
    status: r.status,
    // Whether a new adoption request can be sent, and how gently to warn that there are others.
    requests:
      r.status === 'reserved'
        ? ('reserved' as const)
        : r.requests_paused || r.open_requests >= REQUEST_CAP
          ? ('paused' as const)
          : r.open_requests >= BUSY_AT
            ? ('busy' as const)
            : ('open' as const),
    // Living with a foster home ("En hogar temporal") while it waits for a family; still up for adoption.
    fostered: r.fostered === 1,
    place: { id: r.place_id, name: r.place_name, municipality: r.municipality, province: r.province, lat: r.lat, lng: r.lng },
    // Verified shelters show their name; a private lister (a one-person row in shelters) is "Particular",
    // never a person's name or id.
    lister: r.shelter_id && r.shelter_kind !== 'private' ? { type: 'shelter' as const, id: r.shelter_id, name: r.shelter_name } : { type: 'private' as const },
    // The thumbnail (about 480 px) is for small frames; sample photos have none, so lists fall back to the full one.
    photo: { url: photoUrl(cover?.key ?? null), thumb: photoUrl(cover?.thumb ?? null), focus: cover?.focus ?? '50% 40%', count: cover?.count ?? 0 },
  };
}

/** Coordinates arrive rounded to ~1 km by the client; round again so precise positions are never processed or logged. */
export function readPoint(lat?: string, lng?: string): { lat: number; lng: number } | null {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  return { lat: Math.round(la * 100) / 100, lng: Math.round(ln * 100) / 100 };
}

export const pets = new Hono<AppContext>();

// Every visible pet within reach of the visitor's area square, nearest first. The phone measures the
// exact distance from its chosen area and filters locally, so moving the slider or toggling a chip needs
// no new request; changing area only refetches when it lands in another square.
pets.get('/', async (c) => {
  const point = readPoint(c.req.query('lat'), c.req.query('lng'));
  if (!point) return c.json({ error: 'invalid_point' }, 400);
  const i = Math.floor(clampTo(point.lat, DR.lat) / CELL);
  const j = Math.floor(clampTo(point.lng, DR.lng) / CELL);
  return cachedJson(c, `/pets/area/${i}/${j}`, async () => {
    const lat = (i + 0.5) * CELL;
    const lng = (j + 0.5) * CELL;
    const { results } = await c.env.DB.prepare(`SELECT ${SUMMARY_COLUMNS}, ${KM_SQL} AS km ${FROM} WHERE ${VISIBLE} ORDER BY km LIMIT ?3`)
      .bind(lat, lng, LIST_CAP + 1)
      .all<SummaryRow>();
    if (results.length > LIST_CAP) console.error(`pet list for area ${i}/${j} over the ${LIST_CAP} cap; the farthest are dropped (PAT-28)`);
    else if (results.length > LIST_CAP * 0.8) console.warn(`pet list for area ${i}/${j} at ${results.length} of ${LIST_CAP} (PAT-28)`);
    return { body: { pets: results.slice(0, LIST_CAP).map(summary), truncated: results.length > LIST_CAP } };
  });
});

// Finding animals by name when the app's own list doesn't have them: the list is the nearest 1,000
// nationwide (it can't hold a whole country forever), and some animals aren't in it ("en proceso"). Adopted
// and withdrawn ones are never found. Names are looked up by their start, using two indexes (migration
// 0016), so a search reads about as many rows as it returns: public and unlimited in kind, it still can't
// scan the table, which would let a flood of searches spend the free plan's daily reads.
const FIND_LIMIT = 30;
const FIND_WORDS = 3;
/** Lowercase, no accents or punctuation, single spaces: the same folding as the name_key column. */
const fold = (s: string) => s.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** The name lookups run first, then each animal is fetched by key (CROSS JOIN fixes that order: left to
 *  the planner it would read every available animal). ?1 is the word, ?2 the first string past its prefix. */
export const FIND_SQL = `SELECT ${SUMMARY_COLUMNS}
  FROM (SELECT id FROM pets WHERE name_key >= ?1 AND name_key < ?2 UNION SELECT id FROM pets WHERE name_rest >= ?1 AND name_rest < ?2) AS m
  CROSS JOIN pets d ON d.id = m.id ${PET_JOINS}
  WHERE ${VIEWABLE}
  ORDER BY d.name_key LIMIT ${FIND_LIMIT}`;

// ?q=pancho gazcue: up to three words of at least three letters each are looked up by name; the app then
// keeps the animals matching every word (shelter and area words match nothing here, and are matched on
// the phone). Nearest-first ordering is the phone's job: it knows where the person is.
pets.get('/find', async (c) => {
  const words = [...new Set(fold(c.req.query('q') ?? '').split(' '))].filter((w) => w.length >= 3).slice(0, FIND_WORDS);
  if (!words.length) return c.json({ error: 'too_short' }, 400);
  if (c.env.WRITE_LIMIT) {
    // The same limiter as writes (per visitor, 30 a minute), under its own key: plenty for typing a name.
    const { success } = await c.env.WRITE_LIMIT.limit({ key: `find:${c.req.header('cf-connecting-ip') ?? 'local'}` });
    if (!success) return c.json({ error: 'rate_limited' }, 429);
  }
  const batches = await c.env.DB.batch<SummaryRow>(words.map((w) => c.env.DB.prepare(FIND_SQL).bind(w, `${w}\u{10FFFF}`)));
  const byId = new Map<string, SummaryRow>();
  for (const { results } of batches) for (const r of results) byId.set(r.id, r);
  c.header('Cache-Control', 'public, max-age=30');
  return c.json({ pets: [...byId.values()].map(summary) });
});

// A pet's profile, the same for everyone (the phone adds the distance), cached like the list.
pets.get('/:id', (c) => {
  const id = c.req.param('id');
  return cachedJson(c, `/pets/${encodeURIComponent(id)}`, () => profile(c.env.DB, id));
});

/** The same profile (and the same cached copy), read by the link preview in share.ts. */
export async function cachedProfile(c: Context<AppContext>, id: string) {
  const res = await cachedJson(c, `/pets/${encodeURIComponent(id)}`, () => profile(c.env.DB, id));
  return res.json<{ pet?: never; error?: string }>();
}

/** An animal that was public and has left, adopted or withdrawn: old links (Mi lista, shared ones) say
 *  how it ended instead of failing. Only its name, species and main photo. */
async function gone(db: D1Database, id: string): Promise<{ body: unknown; status: 404 | 410 }> {
  const row = await db
    .prepare(`SELECT ${SUMMARY_COLUMNS} ${FROM} WHERE d.id = ? AND d.status IN ('adopted', 'withdrawn') AND d.published_at IS NOT NULL AND ${PUBLIC}`)
    .bind(id)
    .first<SummaryRow>();
  if (!row) return { body: { error: 'not_found' }, status: 404 };
  const { name, species, status, photo } = summary(row);
  return { body: { error: 'gone', pet: { id, name, species, status, photo } }, status: 410 };
}

async function profile(db: D1Database, id: string): Promise<{ body: unknown; status?: 404 | 410 }> {
  const row = await db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS},
              d.story, d.needs, d.adoption_fee_dop, d.in_care_since, s.visit_hours, s.description AS shelter_description,
              sp.name AS shelter_place, sp.municipality AS shelter_municipality,
              s.donation_note
         ${FROM} LEFT JOIN places sp ON sp.id = s.place_id
        WHERE d.id = ? AND ${VIEWABLE}`,
    )
    .bind(id)
    .first<SummaryRow & { donation_note: string | null; story: string; needs: string; adoption_fee_dop: number | null; in_care_since: string | null; visit_hours: string | null; shelter_description: string | null; shelter_place: string | null; shelter_municipality: string | null }>();
  if (!row) return gone(db, id);

  const base = summary(row);
  const [{ results: photos }, { results: siblings }, donation, helpCase] = await Promise.all([
    db.prepare('SELECT r2_key, focus FROM pet_photos WHERE pet_id = ? ORDER BY position').bind(id).all<{ r2_key: string; focus: string }>(),
    row.litter_id
      ? db.prepare(`SELECT ${SUMMARY_COLUMNS} ${FROM} WHERE d.litter_id = ? AND d.id != ? AND ${VIEWABLE} ORDER BY d.name`).bind(row.litter_id, id).all<SummaryRow>()
      : Promise.resolve({ results: [] as SummaryRow[] }),
    base.lister.type === 'shelter' ? donationFor(db, row.shelter_id!, row.donation_note) : Promise.resolve(null),
    // The shelter's open help case for this same animal, if it has one (cases.ts).
    base.lister.type === 'shelter'
      ? db.prepare(`SELECT k.id, k.need FROM cases k JOIN shelters s ON s.id = k.shelter_id WHERE k.pet_id = ? AND ${CASE_VISIBLE} ORDER BY k.active_at DESC LIMIT 1`).bind(id).first<{ id: string; need: string }>()
      : Promise.resolve(null),
  ]);
  return {
    body: {
      pet: {
        ...base,
        story: row.story,
        needs: JSON.parse(row.needs || '[]') as string[],
        inCareSince: row.in_care_since,
        adoptionFeeDop: row.shelter_id && row.shelter_kind !== 'private' ? row.adoption_fee_dop : null,
        photos: photos.map((p) => ({ url: photoUrl(p.r2_key), focus: p.focus })),
        lister:
          base.lister.type === 'shelter'
            ? { ...base.lister, description: row.shelter_description, place: row.shelter_place, municipality: row.shelter_municipality, visitHours: row.visit_hours, donation }
            : base.lister,
        siblings: siblings.map(summary),
        helpCase: helpCase ? { id: helpCase.id, need: helpCase.need } : null,
      },
    },
  };
}
