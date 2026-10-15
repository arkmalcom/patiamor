import { Hono } from 'hono';
import { isoIn, nowIso } from './auth/crypto';
import { hasEmailBudget, sendListingReviewEmail } from './auth/email';
import { appOrigin } from './auth/routes';
import { forgetCatalogVersion } from './cache';
import type { AppContext, Env } from './env';
import { VIEWABLE } from './pets';
import { OPEN_STATUSES } from './requests';
import { moneyWords } from '../../web/src/money';

// The anti-resale safeguards (adopted 2026-10-12): the report button on every profile (PAT-15), where
// three people reporting a listing hide it, and money language in a listing's text (PAT-16), which sends
// it back to review. A listing under review is 'in_review': adopters don't see it, its open requests
// stay as they are, and an admin puts it back or takes it down (admin.ts).

export const REPORT_REASONS = ['venta', 'estafa', 'maltrato', 'datos_falsos', 'otro'] as const;
/** Different people reporting it (not yet resolved) before a listing is hidden. */
export const REPORTS_TO_HOLD = 3;
/** Reports one person can send in a day: enough for someone who spots several, too few to bury a shelter. */
const REPORTS_PER_DAY = 10;

export { moneyWords };

/** The words a listing's own text would be held for: what an admin already let through doesn't count again. */
export function newMoneyWords(texts: (string | null)[], approved: string | null): string[] {
  const ok = new Set<string>(approved ? (JSON.parse(approved) as string[]) : []);
  return moneyWords(...texts).filter((w) => !ok.has(w));
}

/** Hides a live listing pending review. Returns whether it was live (and is now held). */
export async function hold(env: Env, petId: string, reason: 'reportes' | 'dinero', words: string[] = []): Promise<boolean> {
  const held = await env.DB.prepare(
    `UPDATE pets SET review_from = status, status = 'in_review', review_reason = ?, review_words = ?, review_at = ?, updated_at = ?
      WHERE id = ? AND status IN ('available', 'reserved') RETURNING id`,
  )
    .bind(reason, words.length ? JSON.stringify(words) : null, nowIso(), nowIso(), petId)
    .all();
  if (held.results.length) forgetCatalogVersion();
  return held.results.length > 0;
}

/** Emails the listing's shelter owners (within the email budget). */
export async function tellOwners(env: Env, origin: string, petId: string, o: { kind: 'held' | 'down'; note?: string | null }) {
  const db = env.DB;
  const pet = await db.prepare('SELECT name, shelter_id FROM pets WHERE id = ?').bind(petId).first<{ name: string; shelter_id: string | null }>();
  if (!pet?.shelter_id) return;
  const { results: owners } = await db.prepare("SELECT u.email FROM shelter_members m JOIN users u ON u.id = m.user_id WHERE m.shelter_id = ? AND m.role = 'owner'").bind(pet.shelter_id).all<{ email: string }>();
  for (const owner of owners) {
    if (!(await hasEmailBudget(db, 'listing_review'))) break;
    await sendListingReviewEmail(env, owner.email, { pet: pet.name, kind: o.kind, note: o.note ?? null, url: `${origin}/refugio/${encodeURIComponent(pet.shelter_id)}/animales/${encodeURIComponent(petId)}` }).catch(
      (err) => console.error('listing review email failed', err),
    );
  }
}

export const reports = new Hono<AppContext>();

// "Reportar" on a profile: { reason, details? }. One per person per animal; the third person hides it.
reports.post('/:id/report', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthenticated' }, 401);
  const b = await c.req.json<{ reason?: string; details?: unknown }>().catch(() => ({}) as { reason?: string; details?: unknown });
  const reason = REPORT_REASONS.find((r) => r === b.reason);
  if (!reason) return c.json({ error: 'invalid_reason' }, 400);
  const details = typeof b.details === 'string' ? b.details.trim().slice(0, 500) || null : null;
  if (reason === 'otro' && (details?.length ?? 0) < 10) return c.json({ error: 'details_required' }, 400);

  const db = c.env.DB;
  const pet = await db
    .prepare(`SELECT d.id, d.shelter_id, d.listed_by FROM pets d LEFT JOIN shelters s ON s.id = d.shelter_id WHERE d.id = ? AND ${VIEWABLE}`)
    .bind(c.req.param('id'))
    .first<{ id: string; shelter_id: string | null; listed_by: string | null }>();
  if (!pet) return c.json({ error: 'not_found' }, 404);
  const member = pet.shelter_id ? await db.prepare('SELECT 1 FROM shelter_members WHERE shelter_id = ? AND user_id = ?').bind(pet.shelter_id, user.id).first() : null;
  if (member || pet.listed_by === user.id) return c.json({ error: 'own_listing' }, 400);
  const today = await db.prepare('SELECT count(*) AS n FROM reports WHERE reported_by = ? AND created_at > ?').bind(user.id, isoIn(-24 * 60 * 60 * 1000)).first<{ n: number }>();
  if ((today?.n ?? 0) >= REPORTS_PER_DAY) return c.json({ error: 'too_many_reports' }, 429);

  const inserted = await db
    .prepare('INSERT INTO reports (id, pet_id, reported_by, reason, details) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id')
    .bind(crypto.randomUUID(), pet.id, user.id, reason, details)
    .all();
  if (!inserted.results.length) return c.json({ error: 'already_reported' }, 409);

  const open = await db.prepare('SELECT count(DISTINCT reported_by) AS n FROM reports WHERE pet_id = ? AND resolved_at IS NULL').bind(pet.id).first<{ n: number }>();
  if ((open?.n ?? 0) >= REPORTS_TO_HOLD && (await hold(c.env, pet.id, 'reportes'))) await tellOwners(c.env, appOrigin(c), pet.id, { kind: 'held' });
  // The person reporting isn't told whether it was hidden: that would show how many others reported it.
  return c.json({ report: { received: true } }, 201);
});

/** Ends a listing's review: back to what it was (`restore`), or taken down. Resolves its open reports. */
export async function endReview(env: Env, petId: string, adminId: string, o: { restore: boolean; note: string | null }) {
  const db = env.DB;
  const pet = await db.prepare('SELECT status, review_from, review_reason, review_words FROM pets WHERE id = ?').bind(petId).first<{ status: string; review_from: string | null; review_reason: string | null; review_words: string | null }>();
  if (!pet) return null;
  const now = nowIso();
  const steps = [
    db.prepare('UPDATE reports SET resolved_at = ?, resolved_by = ? WHERE pet_id = ? AND resolved_at IS NULL').bind(now, adminId, petId),
    db
      .prepare("INSERT INTO admin_actions (id, admin_id, action, subject_type, subject_id, note) VALUES (?, ?, ?, 'pet', ?, ?)")
      .bind(crypto.randomUUID(), adminId, o.restore ? 'pet.restore' : 'pet.takedown', petId, o.note),
  ];
  let closed = 0;
  if (o.restore) {
    // The words it was held for stay as approved (review_words with no reason), so saving the same text
    // again doesn't send it back.
    if (pet.status === 'in_review') {
      steps.push(
        db
          .prepare("UPDATE pets SET status = coalesce(review_from, 'available'), review_from = NULL, review_reason = NULL, review_at = NULL, updated_at = ? WHERE id = ?")
          .bind(now, petId),
      );
    }
    await db.batch(steps);
  } else {
    const [, , ended] = await db.batch([
      ...steps,
      db.prepare(`UPDATE adoption_requests SET status = 'closed', closed_reason = 'retirado', updated_at = ? WHERE pet_id = ? AND status IN ${OPEN_STATUSES} RETURNING id`).bind(now, petId),
      db
        .prepare(
          "UPDATE pets SET status = 'withdrawn', withdrawn_at = ?, withdrawn_reason = 'moderacion', review_from = NULL, review_reason = NULL, review_words = NULL, review_at = NULL, updated_at = ? WHERE id = ?",
        )
        .bind(now, now, petId),
    ]);
    closed = ended.results.length;
  }
  forgetCatalogVersion();
  return { closed };
}
