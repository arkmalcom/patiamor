import { Hono, type Context } from 'hono';
import { nowIso } from './auth/crypto';
import { forgetCatalogVersion } from './cache';
import type { AppContext } from './env';
import { photoUrl } from './pets';
import { roleIn } from './portal';
import { OPEN_STATUSES } from './requests';

// The shelter's request inbox (PAT-5). Members see every request for their animals, move it along
// (seen → contacted → visit) or close it with a reason; each step shows to the adopter in Mi lista.
// Contact details are only shown while a request is open: once it's closed or withdrawn, the shelter
// keeps the answers and the reason but not the phone or email. Shelters reach adopters through their own
// WhatsApp, phone or email (links built in the app); Patiamor sends no message on their behalf.

type C = Context<AppContext>;

/** Ended requests stay in the inbox this long. */
const ENDED_DAYS = 90;
const CLOSE_REASONS = ['otra_familia', 'no_encaja', 'sin_respuesta', 'otro'] as const;
/** Where a shelter may move a request, from each status. "Se fue a casa" is in lifecycle.ts: it ends the animal's other requests too. */
const MOVES: Record<string, readonly string[]> = {
  seen: ['sent'],
  contacted: ['sent', 'seen', 'visit'],
  visit: ['sent', 'seen', 'contacted'],
  closed: ['sent', 'seen', 'contacted', 'visit'],
};

type Row = {
  id: string; status: string; created_at: string; updated_at: string; seen_at: string | null; closed_reason: string | null;
  answer_space: string; answer_time: string; answer_cost: string; home: string | null; other_pets: string; kids: string | null;
  experience: string | null; visit: string | null; message: string | null; distance_km: number | null; travel: string | null;
  contact_name: string; contact_email: string; contact_phone: string | null; contact_pref: string;
  pet_id: string; pet_name: string; pet_species: string; pet_status: string; requests_paused: number; open_requests: number;
  cover: string | null; thumb: string | null; focus: string | null;
};

const isOpen = (status: string) => ['sent', 'seen', 'contacted', 'visit'].includes(status);

function view(r: Row) {
  const open = isOpen(r.status);
  return {
    id: r.id,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    seenAt: r.seen_at,
    closedReason: r.closed_reason,
    answers: { space: r.answer_space, time: r.answer_time, cost: r.answer_cost },
    about: { home: r.home, otherPets: JSON.parse(r.other_pets || '[]') as string[], kids: r.kids, experience: r.experience, visit: r.visit, distanceKm: r.distance_km, travel: r.travel },
    message: r.message,
    // The adopter agreed to share these with this shelter for this request, while it's open.
    contact: open ? { name: r.contact_name, email: r.contact_email, phone: r.contact_phone, pref: r.contact_pref } : { name: r.contact_name },
    pet: {
      id: r.pet_id,
      name: r.pet_name,
      species: r.pet_species,
      status: r.pet_status,
      requestsPaused: r.requests_paused === 1,
      openRequests: r.open_requests,
      photo: { url: photoUrl(r.cover), thumb: photoUrl(r.thumb), focus: r.focus ?? '50% 40%' },
    },
  };
}

const SELECT = `SELECT r.id, r.status, r.created_at, r.updated_at, r.seen_at, r.closed_reason,
    r.answer_space, r.answer_time, r.answer_cost, r.home, r.other_pets, r.kids, r.experience, r.visit, r.message, r.distance_km, r.travel,
    r.contact_name, r.contact_email, r.contact_phone, r.contact_pref,
    d.id AS pet_id, d.name AS pet_name, d.species AS pet_species, d.status AS pet_status, d.requests_paused, d.open_requests,
    ph.r2_key AS cover, ph.thumb_key AS thumb, ph.focus
  FROM adoption_requests r
  JOIN pets d ON d.id = r.pet_id
  LEFT JOIN pet_photos ph ON ph.pet_id = d.id AND ph.position = (SELECT min(position) FROM pet_photos WHERE pet_id = d.id)`;

/** The request, if this person is a member of the shelter whose animal it's for. */
async function requestForMember(c: C, id: string) {
  const row = await c.env.DB.prepare(`${SELECT} WHERE r.id = ?`).bind(id).first<Row>();
  if (!row) return null;
  const pet = await c.env.DB.prepare('SELECT shelter_id FROM pets WHERE id = ?').bind(row.pet_id).first<{ shelter_id: string | null }>();
  if (!pet?.shelter_id || !(await roleIn(c, pet.shelter_id))) return null;
  return row;
}

export const inbox = new Hono<AppContext>();

inbox.use('*', async (c, next) => {
  if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401);
  await next();
});

// Every open request for the shelter's animals, and those that ended in the last 90 days, newest first.
inbox.get('/shelters/:id/requests', async (c) => {
  const id = c.req.param('id');
  if (!(await roleIn(c, id))) return c.json({ error: 'not_found' }, 404);
  const { results } = await c.env.DB.prepare(
    `${SELECT} WHERE d.shelter_id = ?
       AND (r.status IN ${OPEN_STATUSES} OR r.updated_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-${ENDED_DAYS} days'))
     ORDER BY r.created_at DESC LIMIT 500`,
  )
    .bind(id)
    .all<Row>();
  return c.json({ requests: results.map(view) });
});

// Move a request along: { status: 'seen' | 'contacted' | 'visit' | 'closed', reason? } (closing needs a reason).
inbox.post('/requests/:id/status', async (c) => {
  const row = await requestForMember(c, c.req.param('id'));
  if (!row) return c.json({ error: 'not_found' }, 404);
  const b = await c.req.json<{ status?: string; reason?: string }>().catch(() => ({}) as { status?: string; reason?: string });
  const to = b.status ?? '';
  const from = MOVES[to];
  if (!from) return c.json({ error: 'invalid_status' }, 400);
  if (to === 'closed' && !CLOSE_REASONS.includes(b.reason as never)) return c.json({ error: 'reason_required' }, 400);
  if (!from.includes(row.status)) {
    // Opening an already-seen request again is fine; anything else from the wrong status is a conflict.
    if (to === 'seen') return c.json({ request: view(row) });
    return c.json({ error: 'invalid_transition' }, 409);
  }
  const now = nowIso();
  await c.env.DB.prepare(
    `UPDATE adoption_requests SET status = ?, closed_reason = CASE WHEN ? = 'closed' THEN ? ELSE closed_reason END,
       seen_at = coalesce(seen_at, ?), updated_at = ? WHERE id = ? AND status = ?`,
  )
    .bind(to, to, b.reason ?? null, now, now, row.id, row.status)
    .run();
  const updated = await c.env.DB.prepare(`${SELECT} WHERE r.id = ?`).bind(row.id).first<Row>();
  return c.json({ request: view(updated!) });
});

// "En proceso" and the pause switch, per animal: { reserved?: boolean, paused?: boolean }.
inbox.post('/pets/:id/availability', async (c) => {
  const db = c.env.DB;
  const pet = await db.prepare('SELECT d.id, d.status, d.shelter_id, s.status AS shelter_status FROM pets d JOIN shelters s ON s.id = d.shelter_id WHERE d.id = ?')
    .bind(c.req.param('id'))
    .first<{ id: string; status: string; shelter_id: string; shelter_status: string }>();
  if (!pet || !(await roleIn(c, pet.shelter_id))) return c.json({ error: 'not_found' }, 404);
  if (pet.shelter_status === 'suspended') return c.json({ error: 'shelter_suspended' }, 409);
  const b = await c.req.json<{ reserved?: unknown; paused?: unknown }>().catch(() => ({}) as { reserved?: unknown; paused?: unknown });
  if (b.reserved !== undefined && typeof b.reserved !== 'boolean') return c.json({ error: 'invalid_request' }, 400);
  if (b.paused !== undefined && typeof b.paused !== 'boolean') return c.json({ error: 'invalid_request' }, 400);
  if (b.reserved !== undefined && !['available', 'reserved'].includes(pet.status)) return c.json({ error: 'not_published' }, 409);
  const status = b.reserved === undefined ? pet.status : b.reserved ? 'reserved' : 'available';
  await db
    .prepare('UPDATE pets SET status = ?, requests_paused = coalesce(?, requests_paused), updated_at = ? WHERE id = ?')
    .bind(status, b.paused === undefined ? null : b.paused ? 1 : 0, nowIso(), pet.id)
    .run();
  forgetCatalogVersion();
  const now = await db.prepare('SELECT status, requests_paused FROM pets WHERE id = ?').bind(pet.id).first<{ status: string; requests_paused: number }>();
  return c.json({ pet: { id: pet.id, status: now!.status, requestsPaused: now!.requests_paused === 1 } });
});
