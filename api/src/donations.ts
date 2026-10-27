// A shelter's bank accounts for donations (migrations 0023, 0024): owners edit them in the portal (portal.ts),
// adopters read them on pet profiles (pets.ts). Patiamor never touches the money.

/** Shelters often bank in more than one place; four covers that without turning the profile into a list. */
export const MAX_DONATION_ACCOUNTS = 4;

type AccountRow = { bank: string; account_type: 'ahorros' | 'corriente'; account: string; holder: string; holder_id: string | null };

/** The accounts as the app shows them, with the shelter's note, or null when it has given none. */
export async function donationFor(db: D1Database, shelterId: string, note: string | null) {
  const { results } = await db
    .prepare('SELECT bank, account_type, account, holder, holder_id FROM shelter_donation_accounts WHERE shelter_id = ? ORDER BY position')
    .bind(shelterId)
    .all<AccountRow>();
  if (!results.length) return null;
  return { accounts: results.map((r) => ({ bank: r.bank, accountType: r.account_type, account: r.account, holder: r.holder, holderId: r.holder_id })), note };
}
