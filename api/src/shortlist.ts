import { Hono } from 'hono';
import { summary, VISIBLE, type SummaryRow } from './pets';
import type { AppContext } from './env';

// "Mi lista": three deliberate slots per account. The database trigger enforces the limit.

const ANSWERS = ['si', 'pensando'] as const;
type Answer = (typeof ANSWERS)[number];

export const shortlist = new Hono<AppContext>();

shortlist.use('*', async (c, next) => {
  if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401);
  await next();
});

shortlist.get('/', async (c) => {
  const user = c.get('user')!;
  // Saved pets stay listed even if they're later adopted or withdrawn; `status` tells the UI.
  const { results } = await c.env.DB.prepare(
    `SELECT d.id, d.species, d.name, d.sex, d.birth_date, d.birth_date_estimated, d.size, d.energy,
            d.good_with_kids, d.good_with_dogs, d.good_with_cats, d.vaccinated, d.sterilized, d.dewormed, d.litter_id, d.status,
            p.id AS place_id, p.name AS place_name, p.municipality, p.province, p.lat, p.lng,
            s.id AS shelter_id, s.name AS shelter_name,
            (SELECT r2_key FROM pet_photos ph WHERE ph.pet_id = d.id ORDER BY ph.position LIMIT 1) AS photo_key,
            (SELECT focus FROM pet_photos ph WHERE ph.pet_id = d.id ORDER BY ph.position LIMIT 1) AS photo_focus,
            sl.answer_space, sl.answer_time, sl.answer_cost, sl.saved_at
       FROM shortlist sl JOIN pets d ON d.id = sl.pet_id JOIN places p ON p.id = d.place_id LEFT JOIN shelters s ON s.id = d.shelter_id
      WHERE sl.user_id = ? ORDER BY sl.saved_at`,
  )
    .bind(user.id)
    .all<SummaryRow & { answer_space: Answer; answer_time: Answer; answer_cost: Answer; saved_at: string }>();
  return c.json({
    items: results.map((r) => ({
      pet: summary(r),
      answers: { space: r.answer_space, time: r.answer_time, cost: r.answer_cost },
      savedAt: r.saved_at,
    })),
  });
});

shortlist.post('/', async (c) => {
  const user = c.get('user')!;
  const body = await c.req
    .json<{ petId?: string; answers?: Record<string, string> }>()
    .catch(() => ({}) as { petId?: string; answers?: Record<string, string> });
  const a = body.answers ?? {};
  const valid = (v: unknown): v is Answer => ANSWERS.includes(v as Answer);
  if (!body.petId || !valid(a.space) || !valid(a.time) || !valid(a.cost)) return c.json({ error: 'invalid_request' }, 400);

  const db = c.env.DB;
  const existing = await db.prepare('SELECT 1 FROM shortlist WHERE user_id = ? AND pet_id = ?').bind(user.id, body.petId).first();
  if (existing) return c.json({ ok: true });
  const pet = await db
    .prepare(`SELECT d.id FROM pets d LEFT JOIN shelters s ON s.id = d.shelter_id WHERE d.id = ? AND ${VISIBLE}`)
    .bind(body.petId)
    .first();
  if (!pet) return c.json({ error: 'not_found' }, 404);
  try {
    await db
      .prepare('INSERT INTO shortlist (user_id, pet_id, answer_space, answer_time, answer_cost) VALUES (?, ?, ?, ?, ?)')
      .bind(user.id, body.petId, a.space, a.time, a.cost)
      .run();
  } catch (err) {
    if (String(err).includes('shortlist_full')) return c.json({ error: 'shortlist_full' }, 409);
    throw err;
  }
  return c.json({ ok: true }, 201);
});

shortlist.delete('/:petId', async (c) => {
  const user = c.get('user')!;
  await c.env.DB.prepare('DELETE FROM shortlist WHERE user_id = ? AND pet_id = ?').bind(user.id, c.req.param('petId')).run();
  return c.json({ ok: true });
});
