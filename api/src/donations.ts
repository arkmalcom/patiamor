// A shelter's bank account for donations (migration 0023): owners edit it in the portal (portal.ts),
// adopters read it on pet profiles (pets.ts). Patiamor never touches the money.

export type DonationRow = { donation_bank: string | null; donation_account_type: string | null; donation_account: string | null; donation_holder: string | null; donation_holder_id: string | null; donation_note: string | null };
export const DONATION_COLUMNS = 'donation_bank, donation_account_type, donation_account, donation_holder, donation_holder_id, donation_note';

/** The account as the app shows it, or null when the shelter hasn't given one. */
export const donationView = (r: DonationRow) =>
  r.donation_bank
    ? { bank: r.donation_bank, accountType: r.donation_account_type as 'ahorros' | 'corriente', account: r.donation_account!, holder: r.donation_holder!, holderId: r.donation_holder_id, note: r.donation_note }
    : null;
