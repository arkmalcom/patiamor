import { isoIn, nowIso } from './auth/crypto';
import { hasEmailBudget, sendAvailableEmail, sendClosedEmail, sendDigestEmail, type ClosedNotice, type ClosedOutcome } from './auth/email';
import type { Env } from './env';
import { REQUEST_CAP, VISIBLE } from './pets';

// The morning job (cron in wrangler.jsonc, 8:00 in the DR). Instead of an email per request, which the
// free email plan can't afford, each shelter with new requests gets one summary a day, and people who
// asked "Avísame" hear once when a pet takes requests again. Everything draws on the shared daily email
// budget, which always keeps room for sign-in codes; what doesn't fit goes out the next morning, and
// shelters see every request in the portal meanwhile.
//
// People who asked to adopt are emailed only when a request ends without a home for them (the shelter moved
// on, the animal went to another family or left Patiamor), at most once a morning however many ended. Good
// news needs no email: the shelter has already told them (owner decision, 2026-10-16).

export type DigestResult = { shelters: number; digestEmails: number; alertEmails: number; closedEmails: number; deferred: boolean };

/** A request that ended more than this long ago isn't announced any more (the job was down, or the budget ran out). */
const NOTICE_DAYS = 3;
/** How each way a request can close reads to the adopter: the shelter's own reasons stay with the shelter. */
const OUTCOME: Record<string, ClosedOutcome> = { adoptado: 'found_home', retirado: 'gone' };

/** What the adopter is told about one request that ended: how it ended and who was involved, never the
 *  shelter's own reason, and never a private lister's name. */
export function noticeFor(r: { closed_reason: string | null; pet: string; lister: string | null; lister_kind: string | null }): ClosedNotice {
  return {
    pet: r.pet,
    outcome: OUTCOME[r.closed_reason ?? ''] ?? 'moved_on',
    lister: r.lister && r.lister_kind !== 'private' ? r.lister : 'La persona que lo publicó',
  };
}

export async function runDigest(env: Env, origin = env.APP_ORIGIN ?? ''): Promise<DigestResult> {
  const db = env.DB;
  const started = nowIso();
  const result: DigestResult = { shelters: 0, digestEmails: 0, alertEmails: 0, closedEmails: 0, deferred: false };

  // Shelters with unopened requests no summary has mentioned yet, and how many are unopened in total.
  const { results: shelters } = await db
    .prepare(
      `SELECT s.id, s.name, count(r.id) AS fresh, json_group_array(DISTINCT d.name) AS pets, json_group_array(r.id) AS ids,
              (SELECT count(*) FROM adoption_requests r2 JOIN pets d2 ON d2.id = r2.pet_id WHERE d2.shelter_id = s.id AND r2.status = 'sent') AS unopened
         FROM shelters s JOIN pets d ON d.shelter_id = s.id JOIN adoption_requests r ON r.pet_id = d.id
        WHERE s.status = 'verified' AND r.status = 'sent' AND r.digested_at IS NULL
        GROUP BY s.id ORDER BY min(r.created_at)`,
    )
    .all<{ id: string; name: string; fresh: number; pets: string; ids: string; unopened: number }>();

  shelterLoop: for (const s of shelters) {
    const { results: members } = await db
      .prepare('SELECT u.email FROM shelter_members m JOIN users u ON u.id = m.user_id WHERE m.shelter_id = ?')
      .bind(s.id)
      .all<{ email: string }>();
    for (const m of members) {
      if (!(await hasEmailBudget(db, 'digest'))) {
        result.deferred = true;
        break shelterLoop; // this shelter and the rest wait for tomorrow (their requests stay unmarked)
      }
      await sendDigestEmail(env, m.email, {
        shelter: s.name,
        fresh: s.fresh,
        pets: JSON.parse(s.pets) as string[],
        unopened: s.unopened,
        inboxUrl: `${origin}/refugio/${encodeURIComponent(s.id)}/solicitudes`,
      }).catch((err) => console.error('digest email failed', s.id, err));
      result.digestEmails++;
    }
    await db.prepare('UPDATE adoption_requests SET digested_at = ? WHERE id IN (SELECT value FROM json_each(?))').bind(started, s.ids).run();
    result.shelters++;
  }

  // "Avísame": pets that reopened after the person asked, and can take a request right now.
  if (!result.deferred) {
    const { results: alerts } = await db
      .prepare(
        `SELECT a.user_id, u.email, d.id AS pet_id, d.name
           FROM availability_alerts a JOIN users u ON u.id = a.user_id
           JOIN pets d ON d.id = a.pet_id LEFT JOIN shelters s ON s.id = d.shelter_id
          WHERE d.reopened_at > a.created_at AND ${VISIBLE} AND d.requests_paused = 0 AND d.open_requests < ${REQUEST_CAP}
          ORDER BY a.user_id`,
      )
      .all<{ user_id: string; email: string; pet_id: string; name: string }>();
    const byUser = new Map<string, { email: string; pets: { id: string; name: string }[] }>();
    for (const a of alerts) {
      const entry = byUser.get(a.user_id) ?? { email: a.email, pets: [] };
      entry.pets.push({ id: a.pet_id, name: a.name });
      byUser.set(a.user_id, entry);
    }
    for (const [userId, entry] of byUser) {
      if (!(await hasEmailBudget(db, 'available'))) {
        result.deferred = true;
        break;
      }
      await sendAvailableEmail(env, entry.email, { pets: entry.pets.map((p) => ({ name: p.name, url: `${origin}/mascota/${encodeURIComponent(p.id)}` })) })
        .then(() =>
          // One notice per wish: the alert is done once it's been sent.
          db.batch(entry.pets.map((p) => db.prepare('DELETE FROM availability_alerts WHERE user_id = ? AND pet_id = ?').bind(userId, p.id))),
        )
        .catch((err) => console.error('availability email failed', userId, err));
      result.alertEmails++;
    }
  }
  // Requests that ended without a home for this person. 'devuelto' (an adoption undone) isn't announced.
  if (!result.deferred) {
    await db
      .prepare("UPDATE adoption_requests SET closed_notified_at = ? WHERE status = 'closed' AND closed_notified_at IS NULL AND (updated_at < ? OR coalesce(closed_reason, '') = 'devuelto')")
      .bind(started, isoIn(-NOTICE_DAYS * 24 * 60 * 60 * 1000))
      .run();
    const { results: closed } = await db
      .prepare(
        `SELECT r.id, r.user_id, r.closed_reason, u.email, d.name AS pet, s.name AS lister, s.kind AS lister_kind
           FROM adoption_requests r JOIN users u ON u.id = r.user_id JOIN pets d ON d.id = r.pet_id LEFT JOIN shelters s ON s.id = d.shelter_id
          WHERE r.status = 'closed' AND r.closed_notified_at IS NULL ORDER BY r.updated_at LIMIT 500`,
      )
      .all<{ id: string; user_id: string; closed_reason: string | null; email: string; pet: string; lister: string | null; lister_kind: string | null }>();
    const people = new Map<string, { email: string; ids: string[]; notices: ClosedNotice[] }>();
    for (const r of closed) {
      const person = people.get(r.user_id) ?? { email: r.email, ids: [], notices: [] };
      person.ids.push(r.id);
      person.notices.push(noticeFor(r));
      people.set(r.user_id, person);
    }
    for (const [, person] of people) {
      if (!(await hasEmailBudget(db, 'request_closed'))) {
        result.deferred = true; // they stay unmarked: tomorrow, if still within a few days
        break;
      }
      await sendClosedEmail(env, person.email, { notices: person.notices, listUrl: `${origin}/lista`, exploreUrl: origin || '/' })
        .then(() => db.prepare('UPDATE adoption_requests SET closed_notified_at = ? WHERE id IN (SELECT value FROM json_each(?))').bind(started, JSON.stringify(person.ids)).run())
        .catch((err) => console.error('closed request email failed', person.email, err));
      result.closedEmails++;
    }
  }
  if (result.deferred) console.warn('morning job: daily email budget reached; the rest goes out tomorrow', result);
  return result;
}
