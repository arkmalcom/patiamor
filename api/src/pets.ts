import { Hono } from 'hono';
import { cachedJson } from './cache';
import type { AppContext } from './env';

// Who may see a pet publicly. One definition, used by search, profiles, siblings and adoption requests:
// available; from a verified shelter or a private lister; and at least 8 weeks old (anti puppy-mill rule).
const PUBLIC = `(d.shelter_id IS NULL OR s.verified_at IS NOT NULL)
  AND (d.birth_date IS NULL OR d.birth_date <= date('now', '-56 days'))`;
export const VISIBLE = `d.status = 'available' AND ${PUBLIC}`;
/** Browsing shows available pets; a profile (and saving) also works for one "en proceso" with a family. */
export const VIEWABLE = `d.status IN ('available', 'reserved') AND ${PUBLIC}`;

/** Requests pause on their own at this many open ones, so a viral pet can't flood a small rescue. */
export const REQUEST_CAP = 10;
/** From this many, adopters see a gentle "ya tiene varias solicitudes" (never an exact count). */
const BUSY_AT = 3;

// The pet list is cached per area square, not per visitor: the visitor's point snaps to a square of
// CELL degrees (~55 km), and everyone in that square shares one cached copy. The list holds every
// visible pet within reach of anywhere in the square, nearest to its centre first.
const CELL = 0.5;
const RADIUS_MAX_KM = 150; // the app's furthest radius
const CELL_MARGIN_KM = 40; // half a square's diagonal, so the list covers any point inside it
/** Past this many the farthest pets drop first (the phone only shows up to 150 km anyway); see PAT-28. */
const LIST_CAP = 1000;
// Squares outside the Dominican Republic all snap to its edge, so made-up points can't mint new copies.
const DR = { lat: [17.4, 20.0], lng: [-72.1, -68.2] } as const;
const clampTo = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

/** Sample photos ship with the web app ("static:" keys); real uploads will be served from R2. */
export const photoUrl = (key: string | null) => (!key ? null : key.startsWith('static:') ? key.slice(7) : `/api/photos/${encodeURIComponent(key)}`);

const KM_SQL = `6371 * acos(min(1, cos(radians(?1)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(?2)) + sin(radians(?1)) * sin(radians(p.lat))))`;

export const SUMMARY_COLUMNS = `d.id, d.species, d.name, d.sex, d.birth_date, d.birth_date_estimated, d.size, d.energy,
  d.good_with_kids, d.good_with_dogs, d.good_with_cats, d.vaccinated, d.sterilized, d.dewormed, d.litter_id, d.status,
  d.open_requests, d.requests_paused,
  p.id AS place_id, p.name AS place_name, p.municipality, p.province, p.lat, p.lng,
  s.id AS shelter_id, s.name AS shelter_name,
  (SELECT json_object('key', ph.r2_key, 'focus', ph.focus) FROM pet_photos ph WHERE ph.pet_id = d.id ORDER BY ph.position LIMIT 1) AS cover`;
// One lookup for the cover photo, not one per column: D1 bills every row read, and this runs per pet.

// A shelter's animals are at the shelter: its place wins over whatever place the listing carries.
export const PET_JOINS = `LEFT JOIN shelters s ON s.id = d.shelter_id JOIN places p ON p.id = COALESCE(s.place_id, d.place_id)`;
const FROM = `FROM pets d ${PET_JOINS}`;

type Bool = 0 | 1 | null;
export interface SummaryRow {
  id: string; species: string; name: string; sex: string; birth_date: string | null; birth_date_estimated: number; size: string; energy: string;
  good_with_kids: Bool; good_with_dogs: Bool; good_with_cats: Bool; vaccinated: number; sterilized: number; dewormed: number;
  litter_id: string | null; status: string; open_requests: number; requests_paused: number;
  place_id: string; place_name: string; municipality: string; province: string; lat: number; lng: number;
  shelter_id: string | null; shelter_name: string | null; cover: string | null;
}

const bool = (v: Bool) => (v === null ? null : v === 1);

export function summary(r: SummaryRow) {
  const cover = r.cover ? (JSON.parse(r.cover) as { key: string; focus: string }) : null;
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
    place: { id: r.place_id, name: r.place_name, municipality: r.municipality, province: r.province, lat: r.lat, lng: r.lng },
    // Verified shelters show their name; everyone else is "Particular" (never a person's name).
    lister: r.shelter_id ? { type: 'shelter' as const, id: r.shelter_id, name: r.shelter_name } : { type: 'private' as const },
    photo: { url: photoUrl(cover?.key ?? null), focus: cover?.focus ?? '50% 40%' },
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
    const reach = RADIUS_MAX_KM + CELL_MARGIN_KM;
    const { results } = await c.env.DB.prepare(
      `SELECT ${SUMMARY_COLUMNS}, ${KM_SQL} AS km ${FROM}
        WHERE ${VISIBLE}
          AND p.lat BETWEEN ?1 - ?3 AND ?1 + ?3 AND p.lng BETWEEN ?2 - ?4 AND ?2 + ?4
          AND km <= ?5
        ORDER BY km LIMIT ?6`,
    )
      .bind(lat, lng, reach / 111, reach / (111 * Math.cos((lat * Math.PI) / 180)), reach, LIST_CAP + 1)
      .all<SummaryRow>();
    if (results.length > LIST_CAP) console.error(`pet list for area ${i}/${j} over the ${LIST_CAP} cap; the farthest are dropped (PAT-28)`);
    else if (results.length > LIST_CAP * 0.8) console.warn(`pet list for area ${i}/${j} at ${results.length} of ${LIST_CAP} (PAT-28)`);
    return { body: { pets: results.slice(0, LIST_CAP).map(summary), truncated: results.length > LIST_CAP } };
  });
});

// A pet's profile, the same for everyone (the phone adds the distance), cached like the list.
pets.get('/:id', (c) => {
  const id = c.req.param('id');
  return cachedJson(c, `/pets/${encodeURIComponent(id)}`, () => profile(c.env.DB, id));
});

async function profile(db: D1Database, id: string): Promise<{ body: unknown; status?: 404 }> {
  const row = await db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS},
              d.story, d.needs, d.adoption_fee_dop, d.in_care_since, s.visit_hours, s.description AS shelter_description,
              sp.name AS shelter_place, sp.municipality AS shelter_municipality
         ${FROM} LEFT JOIN places sp ON sp.id = s.place_id
        WHERE d.id = ? AND ${VIEWABLE}`,
    )
    .bind(id)
    .first<SummaryRow & { story: string; needs: string; adoption_fee_dop: number | null; in_care_since: string | null; visit_hours: string | null; shelter_description: string | null; shelter_place: string | null; shelter_municipality: string | null }>();
  if (!row) return { body: { error: 'not_found' }, status: 404 };

  const [{ results: photos }, { results: siblings }] = await Promise.all([
    db.prepare('SELECT r2_key, focus FROM pet_photos WHERE pet_id = ? ORDER BY position').bind(id).all<{ r2_key: string; focus: string }>(),
    row.litter_id
      ? db.prepare(`SELECT ${SUMMARY_COLUMNS} ${FROM} WHERE d.litter_id = ? AND d.id != ? AND ${VIEWABLE} ORDER BY d.name`).bind(row.litter_id, id).all<SummaryRow>()
      : Promise.resolve({ results: [] as SummaryRow[] }),
  ]);
  const base = summary(row);
  return {
    body: {
      pet: {
        ...base,
        story: row.story,
        needs: JSON.parse(row.needs || '[]') as string[],
        inCareSince: row.in_care_since,
        adoptionFeeDop: row.shelter_id ? row.adoption_fee_dop : null,
        photos: photos.map((p) => ({ url: photoUrl(p.r2_key), focus: p.focus })),
        lister:
          base.lister.type === 'shelter'
            ? { ...base.lister, description: row.shelter_description, place: row.shelter_place, municipality: row.shelter_municipality, visitHours: row.visit_hours }
            : base.lister,
        siblings: siblings.map(summary),
      },
    },
  };
}
