import { Hono, type Context } from 'hono';
import { nowIso } from './auth/crypto';
import { forgetCatalogVersion } from './cache';
import type { AppContext, Env } from './env';
import { publishProblem } from './listings';
import { roleIn } from './portal';
import { OPEN_STATUSES } from './requests';

// How an animal's time on Patiamor ends (PAT-11). "Se fue a casa" marks it adopted, with the request it
// came from when there is one; "Retirar" takes it down for another reason. Both close its open requests
// at once, so those adopters' slots free up and Mi lista tells them how it ended. "Volver a publicar"
// undoes either. Old links show "¡Ya encontró hogar!" or "Ya no está disponible" (pets.ts).

type C = Context<AppContext>;

const WITHDRAW_REASONS = ['familia_original', 'salud', 'fallecio', 'otro'] as const;
/** Reasons the system records when it closes a request itself (shelters pick from inbox.ts's list). */
const AUTO = { adopted: 'adoptado', withdrawn: 'retirado', returned: 'devuelto' } as const;

/** After this long, an adopted animal keeps only its main photo (the R2 cost plan). */
export const TRIM_AFTER_DAYS = 90;
/** Photos removed per morning run: a bounded amount of work, and well under R2's 1,000 keys per delete. */
const TRIM_BATCH = 200;

type PetRow = { id: string; status: string; shelter_id: string; shelter_status: string; birth_date: string; story: string; adopted_request_id: string | null };

/** The animal, if this person is a member of its shelter and the shelter can take changes. */
async function petForChange(c: C): Promise<PetRow | Response> {
  const pet = await c.env.DB.prepare(
    `SELECT d.id, d.status, d.shelter_id, s.status AS shelter_status, d.birth_date, d.story, d.adopted_request_id
       FROM pets d JOIN shelters s ON s.id = d.shelter_id WHERE d.id = ?`,
  )
    .bind(c.req.param('id'))
    .first<PetRow>();
  if (!pet || !(await roleIn(c, pet.shelter_id))) return c.json({ error: 'not_found' }, 404);
  if (pet.shelter_status === 'suspended') return c.json({ error: 'shelter_suspended' }, 409);
  return pet;
}

const live = (status: string) => status === 'available' || status === 'reserved';

/** `closed`: how many open requests ended (counted with RETURNING: D1's change count includes trigger writes). */
async function result(c: C, id: string, closed: number) {
  forgetCatalogVersion();
  const now = await c.env.DB.prepare('SELECT status, requests_paused FROM pets WHERE id = ?').bind(id).first<{ status: string; requests_paused: number }>();
  return c.json({ pet: { id, status: now!.status, requestsPaused: now!.requests_paused === 1 }, closed });
}

export const lifecycle = new Hono<AppContext>();

lifecycle.use('*', async (c, next) => {
  if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401);
  await next();
});

// "Se fue a casa": { requestId? } names the family's request; without it, the family came from elsewhere.
lifecycle.post('/pets/:id/adopted', async (c) => {
  const pet = await petForChange(c);
  if (pet instanceof Response) return pet;
  if (!live(pet.status)) return c.json({ error: 'invalid_transition' }, 409);
  const b = await c.req.json<{ requestId?: unknown }>().catch(() => ({}) as { requestId?: unknown });
  const requestId = b.requestId ?? null;
  const db = c.env.DB;
  if (requestId !== null) {
    const req = await db.prepare(`SELECT 1 FROM adoption_requests WHERE id = ? AND pet_id = ? AND status IN ${OPEN_STATUSES}`).bind(requestId, pet.id).first();
    if (!req) return c.json({ error: 'invalid_request' }, 400);
  }
  const now = nowIso();
  const [, closed] = await db.batch([
    db.prepare("UPDATE adoption_requests SET status = 'adopted', updated_at = ? WHERE id = ?").bind(now, requestId),
    db.prepare(`UPDATE adoption_requests SET status = 'closed', closed_reason = ?, updated_at = ? WHERE pet_id = ? AND status IN ${OPEN_STATUSES} RETURNING id`).bind(AUTO.adopted, now, pet.id),
    db.prepare("UPDATE pets SET status = 'adopted', adopted_at = ?, adopted_request_id = ?, updated_at = ? WHERE id = ?").bind(now, requestId, now, pet.id),
  ]);
  return result(c, pet.id, closed.results.length);
});

// "Retirar": { reason } is for the shelter's records; adopters only see "Ya no está disponible".
lifecycle.post('/pets/:id/withdraw', async (c) => {
  const pet = await petForChange(c);
  if (pet instanceof Response) return pet;
  if (!live(pet.status)) return c.json({ error: 'invalid_transition' }, 409);
  const b = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  if (!WITHDRAW_REASONS.includes(b.reason as never)) return c.json({ error: 'reason_required' }, 400);
  const db = c.env.DB;
  const now = nowIso();
  const [closed] = await db.batch([
    db.prepare(`UPDATE adoption_requests SET status = 'closed', closed_reason = ?, updated_at = ? WHERE pet_id = ? AND status IN ${OPEN_STATUSES} RETURNING id`).bind(AUTO.withdrawn, now, pet.id),
    db.prepare("UPDATE pets SET status = 'withdrawn', withdrawn_at = ?, withdrawn_reason = ?, updated_at = ? WHERE id = ?").bind(now, b.reason, now, pet.id),
  ]);
  return result(c, pet.id, closed.results.length);
});

// "Volver a publicar": back to available, under the same rules as publishing. An adoption that didn't
// work out also ends the family's request ("devuelto"), so it no longer reads as a home in Mi lista.
lifecycle.post('/pets/:id/relist', async (c) => {
  const pet = await petForChange(c);
  if (pet instanceof Response) return pet;
  if (pet.status !== 'adopted' && pet.status !== 'withdrawn') return c.json({ error: 'invalid_transition' }, 409);
  const db = c.env.DB;
  const photos = await db.prepare('SELECT count(*) AS n FROM pet_photos WHERE pet_id = ?').bind(pet.id).first<{ n: number }>();
  const problem = publishProblem(pet.shelter_status, { birthDate: pet.birth_date, story: pet.story }, photos?.n ?? 0);
  if (problem) return c.json({ error: problem }, 409);
  const now = nowIso();
  await db.batch([
    db.prepare("UPDATE adoption_requests SET status = 'closed', closed_reason = ?, updated_at = ? WHERE id = ? AND status = 'adopted'").bind(AUTO.returned, now, pet.adopted_request_id),
    db.prepare(
      `UPDATE pets SET status = 'available', adopted_at = NULL, adopted_request_id = NULL, withdrawn_at = NULL, withdrawn_reason = NULL,
         published_at = coalesce(published_at, ?), updated_at = ? WHERE id = ?`,
    ).bind(now, now, pet.id),
  ]);
  return result(c, pet.id, 0);
});

// ---------- Several at once (PAT-33) ----------

/** At most this many animals per change: a litter, or a morning's clean-up. */
export const BULK_MAX = 100;
const BULK_ACTIONS = ['reserved', 'available', 'adopted', 'withdrawn', 'health'] as const;
type BulkAction = (typeof BULK_ACTIONS)[number];
const HEALTH = ['vaccinated', 'sterilized', 'dewormed'] as const;

type BulkPet = { id: string; status: string; open_requests: number };

/** Why an animal can't take this change, or null when it can. */
function bulkProblem(action: BulkAction, p: BulkPet): string | null {
  if (action === 'health') return null;
  if (!live(p.status)) return 'not_live';
  if (action === 'reserved' && p.status === 'reserved') return 'already';
  if (action === 'available' && p.status === 'available') return 'already';
  // Its family may have come through Patiamor: marking it here would tell them another family took it.
  // One at a time, the shelter picks the request.
  if (action === 'adopted' && p.open_requests > 0) return 'has_requests';
  return null;
}

// { ids, action: 'reserved' | 'available' | 'adopted' | 'withdrawn' | 'health', reason?, health? }: the same
// changes as one at a time, for many of the shelter's animals in one request. Those that can't take it
// come back in `skipped` with why; the rest change together.
lifecycle.post('/shelters/:id/pets/bulk', async (c) => {
  const shelterId = c.req.param('id');
  if (!(await roleIn(c, shelterId))) return c.json({ error: 'not_found' }, 404);
  const db = c.env.DB;
  const shelter = await db.prepare('SELECT status FROM shelters WHERE id = ?').bind(shelterId).first<{ status: string }>();
  if (!shelter) return c.json({ error: 'not_found' }, 404);
  if (shelter.status === 'suspended') return c.json({ error: 'shelter_suspended' }, 409);

  const b = await c.req.json<{ ids?: unknown; action?: string; reason?: string; health?: Record<string, unknown> }>().catch(() => ({}) as { ids?: unknown; action?: string; reason?: string; health?: Record<string, unknown> });
  const action = BULK_ACTIONS.find((a) => a === b.action);
  if (!action) return c.json({ error: 'invalid_action' }, 400);
  const ids = Array.isArray(b.ids) ? [...new Set(b.ids.filter((x): x is string => typeof x === 'string'))] : [];
  if (!ids.length || ids.length > BULK_MAX) return c.json({ error: 'invalid_ids', max: BULK_MAX }, 400);
  if (action === 'withdrawn' && !WITHDRAW_REASONS.includes(b.reason as never)) return c.json({ error: 'reason_required' }, 400);
  // Health only marks what's been done: undoing one is rare enough to do in the animal's form.
  const health = HEALTH.filter((k) => b.health?.[k] === true);
  if (action === 'health' && !health.length) return c.json({ error: 'invalid_health' }, 400);

  const { results: pets } = await db
    .prepare('SELECT id, status, open_requests FROM pets WHERE shelter_id = ? AND id IN (SELECT value FROM json_each(?))')
    .bind(shelterId, JSON.stringify(ids))
    .all<BulkPet>();
  const skipped = [
    ...ids.filter((id) => !pets.some((p) => p.id === id)).map((id) => ({ id, why: 'not_found' })),
    ...pets.flatMap((p) => {
      const why = bulkProblem(action, p);
      return why ? [{ id: p.id, why }] : [];
    }),
  ];
  const changed = pets.filter((p) => !bulkProblem(action, p)).map((p) => p.id);
  if (!changed.length) return c.json({ changed, skipped, closed: 0 });

  const these = JSON.stringify(changed);
  const now = nowIso();
  let closed = 0;
  if (action === 'reserved' || action === 'available') {
    await db.prepare('UPDATE pets SET status = ?, updated_at = ? WHERE id IN (SELECT value FROM json_each(?))').bind(action, now, these).run();
  } else if (action === 'adopted') {
    // None has open requests (see bulkProblem), so there are none to close.
    await db
      .prepare("UPDATE pets SET status = 'adopted', adopted_at = ?, adopted_request_id = NULL, updated_at = ? WHERE id IN (SELECT value FROM json_each(?))")
      .bind(now, now, these)
      .run();
  } else if (action === 'withdrawn') {
    const [ended] = await db.batch([
      db
        .prepare(`UPDATE adoption_requests SET status = 'closed', closed_reason = ?, updated_at = ? WHERE pet_id IN (SELECT value FROM json_each(?)) AND status IN ${OPEN_STATUSES} RETURNING id`)
        .bind(AUTO.withdrawn, now, these),
      db
        .prepare("UPDATE pets SET status = 'withdrawn', withdrawn_at = ?, withdrawn_reason = ?, updated_at = ? WHERE id IN (SELECT value FROM json_each(?))")
        .bind(now, b.reason, now, these),
    ]);
    closed = ended.results.length;
  } else {
    await db
      .prepare(`UPDATE pets SET ${health.map((k) => `${k} = 1`).join(', ')}, updated_at = ? WHERE id IN (SELECT value FROM json_each(?))`)
      .bind(now, these)
      .run();
  }
  forgetCatalogVersion();
  return c.json({ changed, skipped, closed });
});

/** Part of the morning job: 90 days after an adoption, every photo but the main one leaves R2. The
 *  main one stays for the shelter's records and the "¡Ya encontró hogar!" page. Sample photos that
 *  ship with the app ("static:" keys) aren't in R2 and are left alone. */
export async function trimAdoptedPhotos(env: Env): Promise<{ photos: number }> {
  const db = env.DB;
  const { results } = await db
    .prepare(
      `SELECT ph.id, ph.r2_key, ph.thumb_key FROM pet_photos ph JOIN pets d ON d.id = ph.pet_id
        WHERE d.status = 'adopted' AND d.adopted_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-${TRIM_AFTER_DAYS} days')
          AND ph.position > (SELECT min(position) FROM pet_photos WHERE pet_id = d.id)
          AND ph.r2_key NOT LIKE 'static:%'
        LIMIT ${TRIM_BATCH}`,
    )
    .all<{ id: string; r2_key: string; thumb_key: string | null }>();
  if (!results.length) return { photos: 0 };
  // The rows go first: a failed R2 delete leaves unused objects (logged), never a profile pointing at a missing photo.
  await db.prepare('DELETE FROM pet_photos WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(results.map((r) => r.id))).run();
  const keys = results.flatMap((r) => [r.r2_key, ...(r.thumb_key ? [r.thumb_key] : [])]);
  await env.PHOTOS.delete(keys).catch((err) => console.error('trimming adopted photos: R2 delete failed', keys.length, err));
  return { photos: results.length };
}
