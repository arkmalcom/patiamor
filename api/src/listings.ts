import { Hono, type Context } from 'hono';
import { nowIso } from './auth/crypto';
import { forgetCatalogVersion } from './cache';
import type { AppContext } from './env';
import { PET_JOINS, photoUrl, SUMMARY_COLUMNS, summary, type SummaryRow } from './pets';
import { placeById } from './places';
import { roleIn } from './portal';

// Shelter listings (PAT-8): members (owners and maintainers) create and edit their shelter's animals.
// Any shelter that isn't suspended can prepare drafts; only a verified one can publish, and a published
// animal goes live at once (the catalogue triggers clear cached pages). A shelter's animals are at the
// shelter, so listings never ask for an area. Photos are managed in photos.ts. Private listers (and their
// first-listing review) come later.

type C = Context<AppContext>;

const SPECIES = ['perro', 'gato'] as const;
const SEXES = ['hembra', 'macho'] as const;
const SIZES = ['pequeno', 'mediano', 'grande'] as const;
const ENERGIES = ['tranquila', 'media', 'alta'] as const;
/** Adopters only ever see animals at least this old (the same rule as PUBLIC in pets.ts). */
const MIN_AGE_DAYS = 56;
const MAX_FEE_DOP = 50_000;
const MIN_STORY = 20;

const oneOf = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => list.includes(v as T[number]);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const tri = (v: unknown) => (v === true ? 1 : v === false ? 0 : null);
const flag = (v: unknown) => (v === true ? 1 : 0);
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
/** A real calendar date (YYYY-MM-DD) between `min` and today. */
const isDate = (v: string, min: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v) && v >= min && v <= today();

/** The fields of a listing, validated; `error` names the first problem. */
function readPet(b: Record<string, unknown>) {
  const goodWith = (b.goodWith ?? {}) as Record<string, unknown>;
  const health = (b.health ?? {}) as Record<string, unknown>;
  const fee = b.adoptionFeeDop === null || b.adoptionFeeDop === undefined || b.adoptionFeeDop === '' ? null : Number(b.adoptionFeeDop);
  const pet = {
    species: b.species,
    name: text(b.name, 40).replace(/\s+/g, ' '),
    sex: b.sex,
    birthDate: text(b.birthDate, 10),
    birthDateEstimated: flag(b.birthDateEstimated),
    size: b.size,
    energy: b.energy,
    kids: tri(goodWith.kids),
    dogs: tri(goodWith.dogs),
    cats: tri(goodWith.cats),
    vaccinated: flag(health.vaccinated),
    sterilized: flag(health.sterilized),
    dewormed: flag(health.dewormed),
    story: text(b.story, 2000),
    needs: (Array.isArray(b.needs) ? b.needs : []).map((n) => text(n, 80).replace(/\s+/g, ' ')).filter(Boolean).slice(0, 5),
    fee,
    inCareSince: text(b.inCareSince, 10) || null,
  };
  let error: string | null = null;
  if (!oneOf(SPECIES, pet.species)) error = 'invalid_species';
  else if (pet.name.length < 1) error = 'invalid_name';
  else if (!oneOf(SEXES, pet.sex)) error = 'invalid_sex';
  else if (!isDate(pet.birthDate, daysAgo(30 * 366))) error = 'invalid_birth_date';
  else if (!oneOf(SIZES, pet.size)) error = 'invalid_size';
  else if (!oneOf(ENERGIES, pet.energy)) error = 'invalid_energy';
  else if (fee !== null && !(Number.isInteger(fee) && fee >= 0 && fee <= MAX_FEE_DOP)) error = 'invalid_fee';
  else if (pet.inCareSince && !isDate(pet.inCareSince, pet.birthDate)) error = 'invalid_in_care_since';
  return { pet, error };
}

/** What a listing needs before adopters can see it; null when it's ready. */
function publishProblem(shelterStatus: string, pet: { birthDate: string; story: string }, photos: number) {
  if (shelterStatus !== 'verified') return 'shelter_not_verified';
  if (pet.birthDate > daysAgo(MIN_AGE_DAYS)) return 'too_young';
  if (pet.story.length < MIN_STORY) return 'story_required';
  if (photos < 1) return 'photo_required';
  return null;
}

/** The shelter, if this person is one of its members and it can take changes. */
async function writableShelter(c: C, shelterId: string) {
  const role = await roleIn(c, shelterId);
  if (!role) return { error: 'not_found' as const, status: 404 as const };
  const s = await c.env.DB.prepare('SELECT id, name, status, place_id FROM shelters WHERE id = ?').bind(shelterId).first<{ id: string; name: string; status: string; place_id: string }>();
  if (!s) return { error: 'not_found' as const, status: 404 as const };
  if (s.status === 'suspended') return { error: 'shelter_suspended' as const, status: 409 as const };
  return { shelter: s, role };
}

export const listings = new Hono<AppContext>();

listings.use('*', async (c, next) => {
  if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401);
  await next();
});

// The shelter's animals, every status, newest changes first.
listings.get('/shelters/:id/pets', async (c) => {
  const id = c.req.param('id');
  const role = await roleIn(c, id);
  if (!role) return c.json({ error: 'not_found' }, 404);
  const db = c.env.DB;
  const s = await db.prepare('SELECT id, name, status, place_id FROM shelters WHERE id = ?').bind(id).first<{ id: string; name: string; status: string; place_id: string }>();
  if (!s) return c.json({ error: 'not_found' }, 404);
  const { results } = await db
    .prepare(`SELECT ${SUMMARY_COLUMNS}, d.updated_at FROM pets d ${PET_JOINS} WHERE d.shelter_id = ? ORDER BY d.updated_at DESC LIMIT 500`)
    .bind(id)
    .all<SummaryRow & { updated_at: string }>();
  return c.json({
    shelter: { id: s.id, name: s.name, status: s.status, place: placeById(s.place_id) ?? null, role },
    pets: results.map((r) => ({ ...summary(r), openRequests: r.open_requests, updatedAt: r.updated_at })),
  });
});

// A new listing: a draft, or published at once (`publish: true`) when the shelter is verified.
listings.post('/shelters/:id/pets', async (c) => {
  const user = c.get('user')!;
  const w = await writableShelter(c, c.req.param('id'));
  if ('error' in w) return c.json({ error: w.error }, w.status);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const { pet, error } = readPet(body);
  if (error) return c.json({ error }, 400);
  const publish = body.publish === true;
  // A new listing has no photos yet (they're added to its id), so it always starts as a draft in practice.
  const problem = publish ? publishProblem(w.shelter.status, pet, 0) : null;
  if (problem) return c.json({ error: problem }, 409);

  const id = crypto.randomUUID();
  const now = nowIso();
  const status = publish ? 'available' : 'draft';
  await c.env.DB.prepare(
    `INSERT INTO pets (id, listed_by, shelter_id, place_id, species, name, sex, birth_date, birth_date_estimated, size, energy,
       good_with_kids, good_with_dogs, good_with_cats, vaccinated, sterilized, dewormed, story, needs, adoption_fee_dop, in_care_since,
       status, published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, user.id, w.shelter.id, w.shelter.place_id, pet.species, pet.name, pet.sex, pet.birthDate, pet.birthDateEstimated, pet.size, pet.energy,
      pet.kids, pet.dogs, pet.cats, pet.vaccinated, pet.sterilized, pet.dewormed, pet.story, JSON.stringify(pet.needs), pet.fee, pet.inCareSince,
      status, publish ? now : null, now, now,
    )
    .run();
  if (publish) forgetCatalogVersion();
  return c.json({ pet: { id, status } }, 201);
});

type PetRow = {
  id: string; shelter_id: string | null; species: string; name: string; sex: string; birth_date: string | null; birth_date_estimated: number;
  size: string; energy: string; good_with_kids: number | null; good_with_dogs: number | null; good_with_cats: number | null;
  vaccinated: number; sterilized: number; dewormed: number; story: string; needs: string; adoption_fee_dop: number | null;
  in_care_since: string | null; status: string; published_at: string | null; open_requests: number; requests_paused: number; updated_at: string;
};
const triOut = (v: number | null) => (v === null ? null : v === 1);

async function petForMember(c: C, petId: string) {
  const row = await c.env.DB.prepare('SELECT * FROM pets WHERE id = ?').bind(petId).first<PetRow>();
  if (!row?.shelter_id) return null;
  const role = await roleIn(c, row.shelter_id);
  return role ? { row, role } : null;
}

// One listing, everything the form needs.
listings.get('/pets/:id', async (c) => {
  const found = await petForMember(c, c.req.param('id'));
  if (!found) return c.json({ error: 'not_found' }, 404);
  const { row: r } = found;
  const s = await c.env.DB.prepare('SELECT id, name, status, place_id FROM shelters WHERE id = ?').bind(r.shelter_id).first<{ id: string; name: string; status: string; place_id: string }>();
  const { results: photos } = await c.env.DB.prepare('SELECT id, r2_key, thumb_key, focus FROM pet_photos WHERE pet_id = ? ORDER BY position')
    .bind(r.id)
    .all<{ id: string; r2_key: string; thumb_key: string | null; focus: string }>();
  return c.json({
    shelter: { id: s!.id, name: s!.name, status: s!.status, place: placeById(s!.place_id) ?? null, role: found.role },
    pet: {
      id: r.id,
      species: r.species,
      name: r.name,
      sex: r.sex,
      birthDate: r.birth_date,
      birthDateEstimated: r.birth_date_estimated === 1,
      size: r.size,
      energy: r.energy,
      goodWith: { kids: triOut(r.good_with_kids), dogs: triOut(r.good_with_dogs), cats: triOut(r.good_with_cats) },
      health: { vaccinated: r.vaccinated === 1, sterilized: r.sterilized === 1, dewormed: r.dewormed === 1 },
      story: r.story,
      needs: JSON.parse(r.needs || '[]') as string[],
      adoptionFeeDop: r.adoption_fee_dop,
      inCareSince: r.in_care_since,
      status: r.status,
      requestsPaused: r.requests_paused === 1,
      openRequests: r.open_requests,
      updatedAt: r.updated_at,
      photos: photos.map((p) => ({ id: p.id, url: photoUrl(p.r2_key), thumb: photoUrl(p.thumb_key), focus: p.focus })),
    },
  });
});

// Save changes; `publish: true` also takes a draft live. A listing adopters can already see stays
// live, so it must keep meeting the publishing rules.
listings.put('/pets/:id', async (c) => {
  const found = await petForMember(c, c.req.param('id'));
  if (!found) return c.json({ error: 'not_found' }, 404);
  const w = await writableShelter(c, found.row.shelter_id!);
  if ('error' in w) return c.json({ error: w.error }, w.status);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const { pet, error } = readPet(body);
  if (error) return c.json({ error }, 400);

  const current = found.row.status;
  const status = current === 'draft' && body.publish === true ? 'available' : current;
  if (status !== 'draft' && status !== 'withdrawn') {
    const photos = await c.env.DB.prepare('SELECT count(*) AS n FROM pet_photos WHERE pet_id = ?').bind(found.row.id).first<{ n: number }>();
    const problem = publishProblem(w.shelter.status, pet, photos?.n ?? 0);
    if (problem) return c.json({ error: problem }, 409);
  }
  const now = nowIso();
  await c.env.DB.prepare(
    `UPDATE pets SET species = ?, name = ?, sex = ?, birth_date = ?, birth_date_estimated = ?, size = ?, energy = ?,
       good_with_kids = ?, good_with_dogs = ?, good_with_cats = ?, vaccinated = ?, sterilized = ?, dewormed = ?,
       story = ?, needs = ?, adoption_fee_dop = ?, in_care_since = ?, status = ?, published_at = coalesce(published_at, ?), updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      pet.species, pet.name, pet.sex, pet.birthDate, pet.birthDateEstimated, pet.size, pet.energy,
      pet.kids, pet.dogs, pet.cats, pet.vaccinated, pet.sterilized, pet.dewormed,
      pet.story, JSON.stringify(pet.needs), pet.fee, pet.inCareSince, status, status === 'available' ? now : null, now, found.row.id,
    )
    .run();
  if (status !== 'draft') forgetCatalogVersion();
  return c.json({ pet: { id: found.row.id, status } });
});
