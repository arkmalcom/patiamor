import { Hono } from 'hono';
import { nowIso } from './auth/crypto';
import { hasEmailBudget, sendRequestSentEmail } from './auth/email';
import { appOrigin } from './auth/routes';
import type { AppContext } from './env';
import { PET_JOINS, REQUEST_CAP, SUMMARY_COLUMNS, summary, VIEWABLE, type SummaryRow } from './pets';

// Adoption requests. Mi lista's three slots are requests: liking a pet leads to its full profile, and
// "Enviar solicitud" sends one deliberate request with the reflection answers, contact
// details the adopter consents to share, and anything else they want to tell the lister. There's no
// lower-commitment "save". Withdrawing is always possible; the lister always sees that it happened.
// Listers read and move requests in the portal (later); this file is the adopter's side.

export const OPEN_STATUSES = `('sent', 'seen', 'contacted', 'visit')`;
/** Ended requests stay visible in Mi lista this long, so the adopter sees how things turned out. */
const ENDED_VISIBLE_DAYS = 30;

const REFLECTION = ['si', 'pensando'] as const;
const PREFS = ['whatsapp', 'llamada', 'correo'] as const;
const HOMES = ['casa_patio', 'casa', 'apartamento'] as const;
const OTHER_PETS = ['perros', 'gatos', 'otros'] as const;
const KIDS = ['no', 'menores', 'mayores'] as const;
const EXPERIENCE = ['si', 'primera'] as const;
const VISIT = ['semana', 'fin', 'cualquiera'] as const;
const WITHDRAW_REASONS = ['situacion', 'vivienda', 'otra_mascota', 'refugio', 'otro'] as const;

/** This many withdrawals within the window pause new requests until an admin clears the account. */
const WITHDRAW_LIMIT = 3;
const WITHDRAW_WINDOW_DAYS = 90;

/** Whether new requests are paused for this adopter because of recent withdrawals. */
export async function requestsRestricted(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT count(*) AS n FROM adoption_requests r JOIN users u ON u.id = r.user_id
        WHERE r.user_id = ? AND r.status = 'withdrawn'
          AND r.updated_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-${WITHDRAW_WINDOW_DAYS} days')
          AND (u.requests_cleared_at IS NULL OR r.updated_at > u.requests_cleared_at)`,
    )
    .bind(userId)
    .first<{ n: number }>();
  return (row?.n ?? 0) >= WITHDRAW_LIMIT;
}
const oneOf = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => list.includes(v as T[number]);
const optional = <T extends readonly string[]>(list: T, v: unknown): T[number] | null | undefined =>
  v === undefined || v === null || v === '' ? null : oneOf(list, v) ? v : undefined; // undefined = invalid

/** Dominican numbers: 10 digits starting 809, 829 or 849 (a leading 1 is fine). Stored as E.164. */
export function drPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const n = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return /^(809|829|849)\d{7}$/.test(n) ? `+1${n}` : null;
}

type RequestBody = {
  petId?: string;
  answers?: { space?: string; time?: string; cost?: string };
  name?: string;
  phone?: string;
  pref?: string;
  home?: string;
  otherPets?: unknown;
  kids?: string;
  experience?: string;
  visit?: string;
  message?: string;
  consent?: boolean;
};

type RequestRow = SummaryRow & {
  request_id: string;
  request_status: string;
  answer_space: string;
  answer_time: string;
  answer_cost: string;
  request_created: string;
  request_updated: string;
};

export const requests = new Hono<AppContext>();

requests.use('*', async (c, next) => {
  if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401);
  await next();
});

// Mi lista: open requests (the slots) and recently ended ones (so the outcome is never a mystery).
requests.get('/', async (c) => {
  const user = c.get('user')!;
  const db = c.env.DB;
  const [{ results }, { results: alertRows }] = await Promise.all([
    db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS}, r.id AS request_id, r.status AS request_status, r.answer_space, r.answer_time, r.answer_cost,
                r.created_at AS request_created, r.updated_at AS request_updated
           FROM adoption_requests r JOIN pets d ON d.id = r.pet_id ${PET_JOINS}
          WHERE r.user_id = ? AND (r.status IN ${OPEN_STATUSES} OR r.updated_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-${ENDED_VISIBLE_DAYS} days'))
          ORDER BY r.created_at`,
      )
      .bind(user.id)
      .all<RequestRow>(),
    db.prepare('SELECT pet_id FROM availability_alerts WHERE user_id = ?').bind(user.id).all<{ pet_id: string }>(),
  ]);
  return c.json({
    items: results.map((r) => ({
      pet: summary(r),
      answers: { space: r.answer_space, time: r.answer_time, cost: r.answer_cost },
      request: { id: r.request_id, status: r.request_status, createdAt: r.request_created, updatedAt: r.request_updated },
    })),
    alerts: alertRows.map((a) => a.pet_id),
  });
});

requests.post('/', async (c) => {
  const user = c.get('user')!;
  const b = await c.req.json<RequestBody>().catch(() => ({}) as RequestBody);
  const a = b.answers ?? {};
  const name = (b.name ?? '').trim().replace(/\s+/g, ' ');
  const pref = oneOf(PREFS, b.pref) ? b.pref : null;
  const phone = b.phone ? drPhone(b.phone) : null;
  const otherPets = b.otherPets === undefined ? [] : Array.isArray(b.otherPets) ? [...new Set(b.otherPets)] : null;
  const about = { home: optional(HOMES, b.home), kids: optional(KIDS, b.kids), experience: optional(EXPERIENCE, b.experience), visit: optional(VISIT, b.visit) };
  const message = (b.message ?? '').trim().slice(0, 500) || null;

  if (b.consent !== true) return c.json({ error: 'consent_required' }, 400);
  if (name.length < 2 || name.length > 80) return c.json({ error: 'invalid_name' }, 400);
  if (!pref) return c.json({ error: 'invalid_request' }, 400);
  // WhatsApp and calls need a number; email-only adopters may leave it out (but a typo is still an error).
  if ((pref !== 'correo' || b.phone) && !phone) return c.json({ error: 'invalid_phone' }, 400);
  if (!b.petId || !oneOf(REFLECTION, a.space) || !oneOf(REFLECTION, a.time) || !oneOf(REFLECTION, a.cost) || !otherPets?.every((p) => oneOf(OTHER_PETS, p)) || Object.values(about).includes(undefined)) {
    return c.json({ error: 'invalid_request' }, 400);
  }

  const db = c.env.DB;
  if (await requestsRestricted(db, user.id)) return c.json({ error: 'restricted' }, 403);
  const pet = await db
    .prepare(`SELECT d.name, d.status, d.open_requests, d.requests_paused, s.name AS shelter_name FROM pets d LEFT JOIN shelters s ON s.id = d.shelter_id WHERE d.id = ? AND ${VIEWABLE}`)
    .bind(b.petId)
    .first<{ name: string; status: string; open_requests: number; requests_paused: number; shelter_name: string | null }>();
  if (!pet) return c.json({ error: 'not_found' }, 404);

  const existing = await db
    .prepare(`SELECT id, status, created_at FROM adoption_requests WHERE user_id = ? AND pet_id = ? AND status IN ${OPEN_STATUSES}`)
    .bind(user.id, b.petId)
    .first<{ id: string; status: string; created_at: string }>();
  if (existing) return c.json({ request: { id: existing.id, status: existing.status, createdAt: existing.created_at } });
  if (pet.status === 'reserved') return c.json({ error: 'reserved' }, 409);
  if (pet.requests_paused || pet.open_requests >= REQUEST_CAP) return c.json({ error: 'paused' }, 409);

  const id = crypto.randomUUID();
  const now = nowIso();
  try {
    await db.batch([
      db.prepare("UPDATE users SET name = ?, phone = coalesce(?, phone), contact_pref = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?").bind(name, phone, pref, user.id),
      db
        .prepare(
          `INSERT INTO adoption_requests (id, pet_id, user_id, answer_space, answer_time, answer_cost, home, other_pets, kids, experience, visit,
             message, contact_name, contact_email, contact_phone, contact_pref, consent_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, b.petId, user.id, a.space, a.time, a.cost, about.home, JSON.stringify(otherPets), about.kids, about.experience, about.visit,
          message, name, user.email, phone, pref, now, now, now),
    ]);
  } catch (err) {
    // The database refuses a 4th open request (trigger in 0007), e.g. one sent from another device.
    if (String(err).includes('requests_full')) return c.json({ error: 'requests_full' }, 409);
    throw err;
  }

  // One confirmation, only while the day's email budget allows (sign-in codes always keep their share).
  if (await hasEmailBudget(db, 'request_sent')) {
    await sendRequestSentEmail(c.env, user.email, {
      pet: pet.name,
      lister: pet.shelter_name ?? 'la persona que lo publicó',
      listUrl: `${appOrigin(c)}/lista`,
    }).catch((err) => console.error('request confirmation email failed', err));
  } else console.warn('daily email budget reached: request confirmation not sent');

  return c.json({ request: { id, status: 'sent', createdAt: now } }, 201);
});

// Withdrawing is a serious step: it needs a reason, frees the slot at once, and the lister always sees
// it (with the reason). Several in a short time pause new requests (requestsRestricted).
requests.post('/:id/withdraw', async (c) => {
  const user = c.get('user')!;
  const b = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  if (!oneOf(WITHDRAW_REASONS, b.reason)) return c.json({ error: 'reason_required' }, 400);
  const reason = b.reason;
  await c.env.DB.prepare(`UPDATE adoption_requests SET status = 'withdrawn', closed_reason = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status IN ${OPEN_STATUSES}`)
    .bind(reason, nowIso(), c.req.param('id'), user.id)
    .run();
  return c.json({ ok: true });
});

// ---------- "Avísame si vuelve a estar disponible" ----------

/** "Avísame" wishes per person at a time: plenty for a family, a ceiling for a script. */
const MAX_ALERTS = 20;

export const alerts = new Hono<AppContext>();

alerts.use('*', async (c, next) => {
  if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401);
  await next();
});

alerts.put('/:petId', async (c) => {
  const db = c.env.DB;
  const petId = c.req.param('petId');
  const pet = await db.prepare(`SELECT 1 FROM pets d LEFT JOIN shelters s ON s.id = d.shelter_id WHERE d.id = ? AND ${VIEWABLE}`).bind(petId).first();
  if (!pet) return c.json({ error: 'not_found' }, 404);
  const mine = await db.prepare('SELECT count(*) AS n FROM availability_alerts WHERE user_id = ?').bind(c.get('user')!.id).first<{ n: number }>();
  if ((mine?.n ?? 0) >= MAX_ALERTS) return c.json({ error: 'too_many_alerts' }, 409);
  await db.prepare('INSERT OR IGNORE INTO availability_alerts (user_id, pet_id) VALUES (?, ?)').bind(c.get('user')!.id, petId).run();
  return c.json({ ok: true });
});

alerts.delete('/:petId', async (c) => {
  await c.env.DB.prepare('DELETE FROM availability_alerts WHERE user_id = ? AND pet_id = ?').bind(c.get('user')!.id, c.req.param('petId')).run();
  return c.json({ ok: true });
});
