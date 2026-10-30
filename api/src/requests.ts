import { Hono } from 'hono';
import { isoIn, nowIso } from './auth/crypto';
import { hasEmailBudget, sendBulkAdminEmail, sendRequestSentEmail } from './auth/email';
import { appOrigin } from './auth/routes';
import { BULK_MAX, BULK_MIN, BULK_PER_MONTH, BULK_SPECIES, bulkView, latestBulk, type BulkRow } from './bulk';
import type { AppContext } from './env';
import { distanceKm, placeById } from './places';
import { PET_JOINS, REQUEST_CAP, SUMMARY_COLUMNS, summary, VIEWABLE, type SummaryRow } from './pets';

// Adoption requests. Mi lista's three slots are requests: liking a pet leads to its full profile, and
// "Enviar solicitud" sends one deliberate request with the reflection answers, contact
// details the adopter consents to share, and anything else they want to tell the lister. There's no
// lower-commitment "save". Withdrawing is always possible; the lister always sees that it happened.
// A request can also be an offer to foster ("hogar temporal") an animal from a verified shelter, for a length
// the person picks: same form, same slot. While the animal lives with them it stays open (foster_started_at).
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
const TRAVEL = ['si', 'pensando'] as const;
/** Beyond this the form asks "¿Puedes viajar?" (the same number is in web/src/ui/request.ts). */
export const TRAVEL_FROM_KM = 50;
const WITHDRAW_REASONS = ['situacion', 'vivienda', 'otra_mascota', 'refugio', 'otro'] as const;
const KINDS = ['adopt', 'foster'] as const;
/** How long someone can foster (the same list is in the 0027 migration and web/src/store.ts). */
export const FOSTER_LENGTHS = ['dos_semanas', 'un_mes', 'dos_tres_meses', 'hasta_adopcion'] as const;

/** This many withdrawals within the window pause new requests until an admin clears the account. */
const WITHDRAW_LIMIT = 3;
export const WITHDRAW_WINDOW_DAYS = 90;

/** The adopters whose new requests are paused right now: this many withdrawals within the window, none of
 *  them before an admin cleared the account. The admin console lists them (admin.ts); requestsRestricted
 *  below applies the same rule to one person. */
export const PAUSED_SQL = `SELECT u.id, u.name, u.email, u.phone, count(*) AS withdrawals, max(r.updated_at) AS last
    FROM adoption_requests r JOIN users u ON u.id = r.user_id
   WHERE r.status = 'withdrawn' AND r.updated_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-${WITHDRAW_WINDOW_DAYS} days')
     AND (u.requests_cleared_at IS NULL OR r.updated_at > u.requests_cleared_at)
   GROUP BY u.id HAVING count(*) >= ${WITHDRAW_LIMIT}`;

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
  /** Whether they can travel to meet the animal; asked only beyond TRAVEL_FROM_KM. */
  travel?: string;
  /** The area they browse from, to work out how far they are (the distance is kept, never the place). */
  fromPlaceId?: string;
  /** 'adopt' (the default) or 'foster', with how long they can foster. */
  kind?: string;
  fosterLength?: string;
};

type RequestRow = SummaryRow & {
  request_id: string;
  request_status: string;
  answer_space: string;
  answer_time: string;
  answer_cost: string;
  request_created: string;
  request_updated: string;
  kind: string;
  foster_length: string | null;
  foster_started_at: string | null;
};

/** A foster in progress reads as its own step ('fostering'), though the stored status stays open. */
export const shownStatus = (r: { status: string; foster_started_at: string | null }) =>
  r.foster_started_at && ['sent', 'seen', 'contacted', 'visit'].includes(r.status) ? 'fostering' : r.status;

export const requests = new Hono<AppContext>();

requests.use('*', async (c, next) => {
  if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401);
  await next();
});

// Mi lista: open requests (the slots) and recently ended ones (so the outcome is never a mystery).
requests.get('/', async (c) => {
  const user = c.get('user')!;
  const db = c.env.DB;
  const [{ results }, { results: alertRows }, bulk] = await Promise.all([
    db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS}, r.id AS request_id, r.status AS request_status, r.answer_space, r.answer_time, r.answer_cost,
                r.created_at AS request_created, r.updated_at AS request_updated, r.kind, r.foster_length, r.foster_started_at
           FROM adoption_requests r JOIN pets d ON d.id = r.pet_id ${PET_JOINS}
          WHERE r.user_id = ? AND (r.status IN ${OPEN_STATUSES} OR r.updated_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-${ENDED_VISIBLE_DAYS} days'))
          ORDER BY r.created_at`,
      )
      .bind(user.id)
      .all<RequestRow>(),
    db.prepare('SELECT pet_id FROM availability_alerts WHERE user_id = ?').bind(user.id).all<{ pet_id: string }>(),
    latestBulk(db, user.id),
  ]);
  return c.json({
    bulk,
    items: results.map((r) => ({
      pet: summary(r),
      answers: { space: r.answer_space, time: r.answer_time, cost: r.answer_cost },
      request: {
        id: r.request_id,
        status: shownStatus({ status: r.request_status, foster_started_at: r.foster_started_at }),
        createdAt: r.request_created,
        updatedAt: r.request_updated,
        kind: r.kind,
        fosterLength: r.foster_length,
        fosterStartedAt: r.foster_started_at,
      },
    })),
    alerts: alertRows.map((a) => a.pet_id),
  });
});

/** Admin notices about special requests per day: a flood of accounts can't spend the email budget on them. */
const BULK_ADMIN_EMAILS_PER_DAY = 5;

type BulkBody = { animals?: unknown; species?: unknown; wanted?: string; about?: string; phone?: string; consent?: boolean };

// A special request to adopt more than Mi lista's three. It isn't about one animal: an admin reviews it
// with the person's other requests in mind and, if approved, puts them in touch with the shelters.
requests.post('/bulk', async (c) => {
  const user = c.get('user')!;
  const b = await c.req.json<BulkBody>().catch(() => ({}) as BulkBody);
  const animals = Number(b.animals);
  const species = oneOf(BULK_SPECIES, b.species) ? b.species : null;
  const wanted = (typeof b.wanted === 'string' ? b.wanted : '').trim().replace(/\s+/g, ' ').slice(0, 200) || null;
  const about = (typeof b.about === 'string' ? b.about : '').trim().slice(0, 1000);
  const phone = b.phone ? drPhone(String(b.phone)) : null;

  if (b.consent !== true) return c.json({ error: 'consent_required' }, 400);
  if (!Number.isInteger(animals) || animals < BULK_MIN || animals > BULK_MAX) return c.json({ error: 'invalid_animals' }, 400);
  if (!species) return c.json({ error: 'invalid_request' }, 400);
  if (about.length < 30) return c.json({ error: 'about_too_short' }, 400);
  if (b.phone && !phone) return c.json({ error: 'invalid_phone' }, 400);

  const db = c.env.DB;
  // Withdrawing several requests pauses new ones until Patiamor has checked in: that includes this.
  if (await requestsRestricted(db, user.id)) return c.json({ error: 'restricted' }, 403);
  const recent = await db.prepare('SELECT count(*) AS n FROM bulk_requests WHERE user_id = ? AND created_at > ?').bind(user.id, isoIn(-30 * 24 * 60 * 60 * 1000)).first<{ n: number }>();
  if ((recent?.n ?? 0) >= BULK_PER_MONTH) return c.json({ error: 'too_many_bulk' }, 409);

  const id = crypto.randomUUID();
  const now = nowIso();
  try {
    await db
      .prepare('INSERT INTO bulk_requests (id, user_id, animals, species, wanted, about, contact_phone, consent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, user.id, animals, species, wanted, about, phone, now, now)
      .run();
  } catch (err) {
    // One waiting at a time (a unique index on pending ones).
    if (String(err).includes('UNIQUE')) return c.json({ error: 'already_pending' }, 409);
    throw err;
  }

  // Tell the admins, within the email budget and a small daily cap (they also see it in the portal).
  const sent = await db.prepare("SELECT count(*) AS n FROM email_log WHERE kind = 'bulk_admin' AND created_at > ?").bind(isoIn(-24 * 60 * 60 * 1000)).first<{ n: number }>();
  if ((sent?.n ?? 0) < BULK_ADMIN_EMAILS_PER_DAY && (await hasEmailBudget(db, 'bulk_admin'))) {
    const { results: admins } = await db.prepare('SELECT email FROM users WHERE is_admin = 1').all<{ email: string }>();
    for (const a of admins) {
      await sendBulkAdminEmail(c.env, a.email, { who: user.name ?? user.email, animals, species, adminUrl: `${appOrigin(c)}/refugio/admin/grandes` }).catch((err) => console.error('bulk admin email failed', err));
    }
  }
  const row = await db.prepare('SELECT id, animals, species, status, decision_note, created_at, decided_at FROM bulk_requests WHERE id = ?').bind(id).first<BulkRow>();
  return c.json({ bulk: bulkView(row!) }, 201);
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
  const travel = optional(TRAVEL, b.travel);
  const fromPlace = typeof b.fromPlaceId === 'string' ? placeById(b.fromPlaceId) : null;
  const kind = b.kind === undefined ? 'adopt' : oneOf(KINDS, b.kind) ? b.kind : null;
  const fosterLength = kind === 'foster' && oneOf(FOSTER_LENGTHS, b.fosterLength) ? b.fosterLength : null;

  if (b.consent !== true) return c.json({ error: 'consent_required' }, 400);
  if (name.length < 2 || name.length > 80) return c.json({ error: 'invalid_name' }, 400);
  if (!pref) return c.json({ error: 'invalid_request' }, 400);
  // WhatsApp and calls need a number; email-only adopters may leave it out (but a typo is still an error).
  if ((pref !== 'correo' || b.phone) && !phone) return c.json({ error: 'invalid_phone' }, 400);
  if (!kind || (kind === 'foster' && !fosterLength) || (kind === 'adopt' && b.fosterLength != null)) return c.json({ error: 'invalid_request' }, 400);
  if (!b.petId || !oneOf(REFLECTION, a.space) || !oneOf(REFLECTION, a.time) || !oneOf(REFLECTION, a.cost) || !otherPets?.every((p) => oneOf(OTHER_PETS, p)) || Object.values(about).includes(undefined) || travel === undefined) {
    return c.json({ error: 'invalid_request' }, 400);
  }

  const db = c.env.DB;
  if (await requestsRestricted(db, user.id)) return c.json({ error: 'restricted' }, 403);
  const pet = await db
    .prepare(`SELECT d.name, d.status, d.open_requests, d.requests_paused, d.fostered, s.name AS shelter_name, s.kind AS shelter_kind, COALESCE(s.place_id, d.place_id) AS place_id FROM pets d LEFT JOIN shelters s ON s.id = d.shelter_id WHERE d.id = ? AND ${VIEWABLE}`)
    .bind(b.petId)
    .first<{ name: string; status: string; open_requests: number; requests_paused: number; fostered: number; shelter_name: string | null; shelter_kind: string | null; place_id: string }>();
  if (!pet) return c.json({ error: 'not_found' }, 404);
  // Only shelters take foster homes: a private lister is rehoming their own animal.
  if (kind === 'foster' && (!pet.shelter_name || pet.shelter_kind === 'private')) return c.json({ error: 'foster_unavailable' }, 400);
  // How far, if the app said where they browse from. Far away, they must say whether they can come.
  const petPlace = placeById(pet.place_id);
  const km = fromPlace && petPlace ? distanceKm(fromPlace, petPlace) : null;
  if (km !== null && km > TRAVEL_FROM_KM && !travel) return c.json({ error: 'travel_required' }, 400);

  const existing = await db
    .prepare(`SELECT id, status, created_at FROM adoption_requests WHERE user_id = ? AND pet_id = ? AND status IN ${OPEN_STATUSES}`)
    .bind(user.id, b.petId)
    .first<{ id: string; status: string; created_at: string }>();
  if (existing) return c.json({ request: { id: existing.id, status: existing.status, createdAt: existing.created_at } });
  if (pet.status === 'reserved') return c.json({ error: 'reserved' }, 409);
  if (pet.requests_paused || pet.open_requests >= REQUEST_CAP) return c.json({ error: 'paused' }, 409);
  if (kind === 'foster' && pet.fostered) return c.json({ error: 'fostered' }, 409);

  const id = crypto.randomUUID();
  const now = nowIso();
  try {
    await db.batch([
      db.prepare("UPDATE users SET name = ?, phone = coalesce(?, phone), contact_pref = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?").bind(name, phone, pref, user.id),
      db
        .prepare(
          `INSERT INTO adoption_requests (id, pet_id, user_id, answer_space, answer_time, answer_cost, home, other_pets, kids, experience, visit,
             message, contact_name, contact_email, contact_phone, contact_pref, consent_at, created_at, updated_at, distance_km, travel, kind, foster_length)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, b.petId, user.id, a.space, a.time, a.cost, about.home, JSON.stringify(otherPets), about.kids, about.experience, about.visit,
          message, name, user.email, phone, pref, now, now, now, km === null ? null : Math.round(km / 5) * 5, km !== null && km > TRAVEL_FROM_KM ? travel : null,
          kind, fosterLength),
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
      lister: pet.shelter_name && pet.shelter_kind !== 'private' ? pet.shelter_name : 'la persona que lo publicó',
      listUrl: `${appOrigin(c)}/lista`,
      foster: kind === 'foster',
    }).catch((err) => console.error('request confirmation email failed', err));
  } else console.warn('daily email budget reached: request confirmation not sent');

  return c.json({ request: { id, status: 'sent', createdAt: now, kind, fosterLength } }, 201);
});

// Withdrawing is a serious step: it needs a reason, frees the slot at once, and the lister always sees
// it (with the reason). Several in a short time pause new requests (requestsRestricted). A foster in
// progress can't be withdrawn here: the animal lives with them, so its return is arranged with the shelter,
// which ends it.
requests.post('/:id/withdraw', async (c) => {
  const user = c.get('user')!;
  const b = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  if (!oneOf(WITHDRAW_REASONS, b.reason)) return c.json({ error: 'reason_required' }, 400);
  const reason = b.reason;
  const db = c.env.DB;
  const fostering = await db.prepare(`SELECT 1 FROM adoption_requests WHERE id = ? AND user_id = ? AND foster_started_at IS NOT NULL AND status IN ${OPEN_STATUSES}`).bind(c.req.param('id'), user.id).first();
  if (fostering) return c.json({ error: 'fostering' }, 409);
  await db.prepare(`UPDATE adoption_requests SET status = 'withdrawn', closed_reason = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status IN ${OPEN_STATUSES} AND foster_started_at IS NULL`)
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
