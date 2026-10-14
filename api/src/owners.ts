import { Hono } from 'hono';
import { isoIn, nowIso } from './auth/crypto';
import { hasEmailBudget, sendOwnerAdminEmail } from './auth/email';
import { appOrigin } from './auth/routes';
import type { AppContext, AppUser } from './env';
import { links, text } from './portal';
import { drPhone } from './requests';

// Who may register a shelter. A person asks to be a shelter owner (here); an admin gets to know them and
// the shelter off the platform and approves or declines (admin.ts). Only then can they register the shelter
// (portal.ts), or an admin registers it for them. Registering is not open to everyone because the review
// inbox would then be open to everyone: spam, and one shelter in a hundred spellings.

/** At most this many requests per person in 90 days: a no isn't followed by an endless stream. */
const PER_QUARTER = 3;
/** Admin notices per day, so a flood of accounts can't spend the email budget on them. */
const ADMIN_EMAILS_PER_DAY = 5;
/** A decided request stays visible in the portal this long. */
const SHOWN_DAYS = 30;

export type OwnerRequestRow = {
  id: string; shelter_name: string; zone: string; status: string; decision_note: string | null; created_at: string; decided_at: string | null;
};

export const ownerRequestView = (r: OwnerRequestRow) => ({
  id: r.id,
  shelterName: r.shelter_name,
  zone: r.zone,
  status: r.status,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
  note: r.decision_note,
});

/** The person's latest request: the one waiting, or one decided in the last 30 days. */
export async function latestOwnerRequest(db: D1Database, userId: string) {
  const row = await db
    .prepare(
      `SELECT id, shelter_name, zone, status, decision_note, created_at, decided_at FROM shelter_owner_requests
        WHERE user_id = ? AND (status = 'pending' OR decided_at > ?) ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(userId, isoIn(-SHOWN_DAYS * 24 * 60 * 60 * 1000))
    .first<OwnerRequestRow>();
  return row ? ownerRequestView(row) : null;
}

/** Admins don't need approval; everyone else does. */
export const isShelterOwner = (u: Pick<AppUser, 'is_admin' | 'shelter_owner_at'>) => !!u.is_admin || !!u.shelter_owner_at;

// ---------- Look-alikes: what an admin should check before approving ----------

const fold = (s: string) => s.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Words that say little about which shelter it is. */
const COMMON = new Set(['refugio', 'rescate', 'rescates', 'animales', 'animal', 'hogar', 'fundacion', 'asociacion', 'proteccion', 'perros', 'gatos', 'mascotas', 'amigos', 'santuario', 'dominicana', 'dominicano']);
/** The words that tell shelters apart: four letters or more, and not the common ones. */
const distinctive = (name: string) => fold(name).split(' ').filter((w) => w.length >= 4 && !COMMON.has(w));

/** The same word, or one typo apart for longer words ("patitas" and "patitaz"): spelled differently, same name. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  // One substitution, insertion or deletion from the first difference on.
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i);
}
/** How many of `mine` have a counterpart in `theirs`. */
const overlap = (mine: string[], theirs: string[]) => mine.filter((w) => theirs.some((o) => sameWord(w, o))).length;

export interface LookAlike {
  kind: 'shelter' | 'request';
  /** Why it's flagged: the same name, a shared word, or the same phone number. */
  why: 'same_name' | 'shared_word' | 'same_phone';
  name: string;
  status: string;
  /** Who is behind it, so the admin can tell a repeat request from a second person at the same shelter. */
  who?: string;
}

/** What's already known, loaded once for a whole queue of requests. */
export async function loadKnown(db: D1Database) {
  const [{ results: shelters }, { results: requests }] = await Promise.all([
    db
      .prepare(
        `SELECT s.name, s.status, a.contact_phone AS phone, (SELECT u.email FROM shelter_members m JOIN users u ON u.id = m.user_id WHERE m.shelter_id = s.id AND m.role = 'owner' LIMIT 1) AS who
           FROM shelters s LEFT JOIN shelter_applications a ON a.shelter_id = s.id LIMIT 2000`,
      )
      .all<{ name: string; status: string; phone: string | null; who: string | null }>(),
    db
      .prepare(`SELECT r.id, r.shelter_name, r.status, r.phone, u.email FROM shelter_owner_requests r JOIN users u ON u.id = r.user_id ORDER BY r.created_at DESC LIMIT 500`)
      .all<{ id: string; shelter_name: string; status: string; phone: string; email: string }>(),
  ]);
  return { shelters, requests };
}
export type Known = Awaited<ReturnType<typeof loadKnown>>;

/** Shelters and other requests that might be the same one: same or overlapping name, or the same phone. */
export function lookAlikes(known: Known, request: { id: string; shelterName: string; phone: string }): LookAlike[] {
  const whole = fold(request.shelterName);
  const mine = distinctive(request.shelterName);
  // The same phone is the strongest sign. Then the same name: equal, or every telling word on both sides has a
  // counterpart ("Patitas Gazcue" is "Patitas de Gazcue"). Then a shared word: two of them, or the only one a
  // short name has. One common word among several ("Patitas" in "Patitas 10319") says too little to flag.
  const why = (name: string, phone?: string): LookAlike['why'] | null => {
    if (phone && phone === request.phone) return 'same_phone';
    if (fold(name) === whole) return 'same_name';
    const theirs = distinctive(name);
    const shared = overlap(mine, theirs);
    if (shared && shared === mine.length && shared === theirs.length) return 'same_name';
    return shared >= 2 || (shared >= 1 && mine.length === 1) ? 'shared_word' : null;
  };

  const found: LookAlike[] = [];
  for (const s of known.shelters) {
    const w = why(s.name, s.phone ?? undefined);
    if (w) found.push({ kind: 'shelter', why: w, name: s.name, status: s.status, who: s.who ?? undefined });
  }
  for (const r of known.requests) {
    if (r.id === request.id) continue;
    const w = why(r.shelter_name, r.phone);
    if (w) found.push({ kind: 'request', why: w, name: r.shelter_name, status: r.status, who: r.email });
  }
  // The strongest first: the same phone, then the same name, then a shared word.
  const order = { same_phone: 0, same_name: 1, shared_word: 2 };
  return found.sort((a, b) => order[a.why] - order[b.why]).slice(0, 12);
}

// ---------- The person's request ----------

export const owners = new Hono<AppContext>();

owners.use('*', async (c, next) => {
  if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401);
  await next();
});

type Body = { shelterName?: unknown; zone?: unknown; phone?: unknown; link?: unknown; about?: unknown; consent?: unknown };

// "Quiero registrar un refugio": not the registration itself, just who they are and which shelter.
owners.post('/owner-request', async (c) => {
  const user = c.get('user')!;
  const b = await c.req.json<Body>().catch(() => ({}) as Body);
  const shelterName = text(b.shelterName, 80);
  const zone = text(b.zone, 80);
  const phone = drPhone(text(b.phone, 30));
  const link = links([b.link])[0] ?? null;
  const about = typeof b.about === 'string' ? b.about.trim().slice(0, 1000) : '';

  if (b.consent !== true) return c.json({ error: 'consent_required' }, 400);
  if (shelterName.length < 3) return c.json({ error: 'invalid_name' }, 400);
  if (zone.length < 2) return c.json({ error: 'invalid_zone' }, 400);
  if (!phone) return c.json({ error: 'invalid_phone' }, 400);
  if (b.link && !link) return c.json({ error: 'invalid_link' }, 400);
  if (about.length < 30) return c.json({ error: 'about_too_short' }, 400);
  if (isShelterOwner(user)) return c.json({ error: 'already_owner' }, 409);

  const db = c.env.DB;
  const recent = await db.prepare('SELECT count(*) AS n FROM shelter_owner_requests WHERE user_id = ? AND created_at > ?').bind(user.id, isoIn(-90 * 24 * 60 * 60 * 1000)).first<{ n: number }>();
  if ((recent?.n ?? 0) >= PER_QUARTER) return c.json({ error: 'too_many_requests' }, 409);

  const id = crypto.randomUUID();
  const now = nowIso();
  try {
    await db
      .prepare('INSERT INTO shelter_owner_requests (id, user_id, shelter_name, zone, phone, link, about, consent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, user.id, shelterName, zone, phone, link, about, now, now)
      .run();
  } catch (err) {
    if (String(err).includes('UNIQUE')) return c.json({ error: 'already_pending' }, 409); // one waiting at a time
    throw err;
  }

  // Tell the admins, within the email budget and a small daily cap (they also see it in the portal).
  const sent = await db.prepare("SELECT count(*) AS n FROM email_log WHERE kind = 'owner_admin' AND created_at > ?").bind(isoIn(-24 * 60 * 60 * 1000)).first<{ n: number }>();
  if ((sent?.n ?? 0) < ADMIN_EMAILS_PER_DAY && (await hasEmailBudget(db, 'owner_admin'))) {
    const { results: admins } = await db.prepare('SELECT email FROM users WHERE is_admin = 1').all<{ email: string }>();
    for (const a of admins) {
      await sendOwnerAdminEmail(c.env, a.email, { who: user.name ?? user.email, shelter: shelterName, adminUrl: `${appOrigin(c)}/refugio/admin/duenos` }).catch((err) => console.error('owner admin email failed', err));
    }
  }
  const row = await db.prepare('SELECT id, shelter_name, zone, status, decision_note, created_at, decided_at FROM shelter_owner_requests WHERE id = ?').bind(id).first<OwnerRequestRow>();
  return c.json({ request: ownerRequestView(row!) }, 201);
});
