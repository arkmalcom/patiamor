-- Migration number: 0023 	 2026-10-27
-- How to donate to a shelter (owner decision 2026-10-27: launch with it). A shelter's owner can add a bank
-- account from the portal, any time after registering (never part of registration). Adopters see it on the
-- shelter's card in each pet's profile, and only while the shelter is verified: pets are only public then,
-- which keeps fake shelters from collecting money. Patiamor never touches the money. Private listers can't
-- ask for money, so they have none. Either the first four are all set or all NULL (portal.ts checks it).
ALTER TABLE shelters ADD COLUMN donation_bank TEXT;                -- e.g. 'Banco Popular'
ALTER TABLE shelters ADD COLUMN donation_account_type TEXT CHECK (donation_account_type IN ('ahorros', 'corriente'));
ALTER TABLE shelters ADD COLUMN donation_account TEXT;             -- the account number, as the bank writes it
ALTER TABLE shelters ADD COLUMN donation_holder TEXT;              -- the name on the account
ALTER TABLE shelters ADD COLUMN donation_holder_id TEXT;           -- cédula or RNC, which transfers between banks ask for (optional)
ALTER TABLE shelters ADD COLUMN donation_note TEXT;                -- e.g. 'También recibimos alimento y medicinas' (optional)
