import { isoIn } from './auth/crypto';

// Special requests to adopt more than Mi lista's three (a farm, a large family home). They aren't about one
// animal: an admin reads them with the person's other requests in mind and, if approved, puts them in touch
// with the shelter or shelters that fit; the shelters still choose who goes with whom. The adopter's side
// is in requests.ts (POST /api/requests/bulk), the admin's in admin.ts.

export const BULK_MIN = 4;
export const BULK_MAX = 30;
export const BULK_SPECIES = ['perros', 'gatos', 'ambos'] as const;
/** At most this many in 30 days per person, so a decision isn't followed by an endless stream of new ones. */
export const BULK_PER_MONTH = 3;
/** A decided request stays visible in Mi lista this long. */
const SHOWN_DAYS = 30;

export type BulkRow = {
  id: string; animals: number; species: string; status: string; decision_note: string | null; created_at: string; decided_at: string | null;
};

export const bulkView = (r: BulkRow) => ({
  id: r.id,
  animals: r.animals,
  species: r.species,
  status: r.status,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
  note: r.decision_note,
});

/** The person's latest special request: the one waiting, or one decided in the last 30 days. */
export async function latestBulk(db: D1Database, userId: string) {
  const row = await db
    .prepare(
      `SELECT id, animals, species, status, decision_note, created_at, decided_at FROM bulk_requests
        WHERE user_id = ? AND (status = 'pending' OR decided_at > ?) ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(userId, isoIn(-SHOWN_DAYS * 24 * 60 * 60 * 1000))
    .first<BulkRow>();
  return row ? bulkView(row) : null;
}
