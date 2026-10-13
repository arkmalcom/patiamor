import { Hono } from 'hono';
import type { AppContext } from './env';

// Who may see a pet publicly. One definition, used by search, profiles, siblings and shortlist saves:
// available; from a verified shelter or a private lister; and at least 8 weeks old (anti puppy-mill rule).
export const VISIBLE = `d.status = 'available'
  AND (d.shelter_id IS NULL OR s.verified_at IS NOT NULL)
  AND (d.birth_date IS NULL OR d.birth_date <= date('now', '-56 days'))`;

const MAX_RADIUS_KM = 150;

/** Sample photos ship with the web app ("static:" keys); real uploads will be served from R2. */
export const photoUrl = (key: string | null) => (!key ? null : key.startsWith('static:') ? key.slice(7) : `/api/photos/${encodeURIComponent(key)}`);

const KM_SQL = `6371 * acos(min(1, cos(radians(?1)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(?2)) + sin(radians(?1)) * sin(radians(p.lat))))`;

const SUMMARY_COLUMNS = `d.id, d.species, d.name, d.sex, d.birth_date, d.birth_date_estimated, d.size, d.energy,
  d.good_with_kids, d.good_with_dogs, d.good_with_cats, d.vaccinated, d.sterilized, d.dewormed, d.litter_id, d.status,
  p.id AS place_id, p.name AS place_name, p.municipality, p.province, p.lat, p.lng,
  s.id AS shelter_id, s.name AS shelter_name,
  (SELECT r2_key FROM pet_photos ph WHERE ph.pet_id = d.id ORDER BY ph.position LIMIT 1) AS photo_key,
  (SELECT focus FROM pet_photos ph WHERE ph.pet_id = d.id ORDER BY ph.position LIMIT 1) AS photo_focus`;

const FROM = `FROM pets d JOIN places p ON p.id = d.place_id LEFT JOIN shelters s ON s.id = d.shelter_id`;

type Bool = 0 | 1 | null;
export interface SummaryRow {
  id: string; species: string; name: string; sex: string; birth_date: string | null; birth_date_estimated: number; size: string; energy: string;
  good_with_kids: Bool; good_with_dogs: Bool; good_with_cats: Bool; vaccinated: number; sterilized: number; dewormed: number;
  litter_id: string | null; status: string;
  place_id: string; place_name: string; municipality: string; province: string; lat: number; lng: number;
  shelter_id: string | null; shelter_name: string | null; photo_key: string | null; photo_focus: string | null; km?: number;
}

const bool = (v: Bool) => (v === null ? null : v === 1);

export function summary(r: SummaryRow) {
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
    place: { id: r.place_id, name: r.place_name, municipality: r.municipality, province: r.province, lat: r.lat, lng: r.lng },
    // Verified shelters show their name; everyone else is "Particular" (never a person's name).
    lister: r.shelter_id ? { type: 'shelter' as const, id: r.shelter_id, name: r.shelter_name } : { type: 'private' as const },
    photo: { url: photoUrl(r.photo_key), focus: r.photo_focus ?? '50% 40%' },
    km: r.km === undefined ? undefined : Math.round(r.km * 10) / 10,
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

// Every visible pet within the radius, nearest first. The client filters by size/age/etc. locally,
// so moving the slider or toggling a chip needs no new request.
pets.get('/', async (c) => {
  const point = readPoint(c.req.query('lat'), c.req.query('lng'));
  if (!point) return c.json({ error: 'invalid_point' }, 400);
  const radius = Math.min(MAX_RADIUS_KM, Math.max(1, Number(c.req.query('radius')) || MAX_RADIUS_KM));
  const dLat = radius / 111;
  const dLng = radius / (111 * Math.cos((point.lat * Math.PI) / 180));
  const { results } = await c.env.DB.prepare(
    `SELECT ${SUMMARY_COLUMNS}, ${KM_SQL} AS km ${FROM}
      WHERE ${VISIBLE}
        AND p.lat BETWEEN ?1 - ?3 AND ?1 + ?3 AND p.lng BETWEEN ?2 - ?4 AND ?2 + ?4
        AND km <= ?5
      ORDER BY km LIMIT 500`,
  )
    .bind(point.lat, point.lng, dLat, dLng, radius)
    .all<SummaryRow>();
  c.header('Cache-Control', 'private, max-age=60');
  return c.json({ pets: results.map(summary), radiusKm: radius });
});

pets.get('/:id', async (c) => {
  const id = c.req.param('id');
  const point = readPoint(c.req.query('lat'), c.req.query('lng'));
  const db = c.env.DB;
  const row = await db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS}, ${point ? KM_SQL : 'NULL'} AS km,
              d.story, d.needs, d.adoption_fee_dop, d.in_care_since, s.visit_hours, s.description AS shelter_description,
              sp.name AS shelter_place, sp.municipality AS shelter_municipality
         ${FROM} LEFT JOIN places sp ON sp.id = s.place_id
        WHERE d.id = ?3 AND ${VISIBLE}`,
    )
    .bind(point?.lat ?? 0, point?.lng ?? 0, id)
    .first<SummaryRow & { story: string; needs: string; adoption_fee_dop: number | null; in_care_since: string | null; visit_hours: string | null; shelter_description: string | null; shelter_place: string | null; shelter_municipality: string | null }>();
  if (!row) return c.json({ error: 'not_found' }, 404);

  const [{ results: photos }, { results: siblings }] = await Promise.all([
    db.prepare('SELECT r2_key, focus FROM pet_photos WHERE pet_id = ? ORDER BY position').bind(id).all<{ r2_key: string; focus: string }>(),
    row.litter_id
      ? db.prepare(`SELECT ${SUMMARY_COLUMNS} ${FROM} WHERE d.litter_id = ? AND d.id != ? AND ${VISIBLE} ORDER BY d.name`).bind(row.litter_id, id).all<SummaryRow>()
      : Promise.resolve({ results: [] as SummaryRow[] }),
  ]);
  const base = summary({ ...row, km: point ? row.km : undefined });
  return c.json({
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
  });
});
