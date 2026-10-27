-- Migration number: 0024 	 2026-10-27
-- Many shelters have accounts at more than one bank (owner, 2026-10-27), so donation accounts move from
-- columns on shelters (0023) to their own table: up to four per shelter, in the order the owner gave them.
-- The note stays on shelters (one for all its accounts). Adopters still only see them while the shelter is
-- verified, and private listers still have none (portal.ts).
CREATE TABLE shelter_donation_accounts (
  id           TEXT PRIMARY KEY,
  shelter_id   TEXT NOT NULL REFERENCES shelters (id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,                   -- 0 first, as the owner ordered them
  bank         TEXT NOT NULL,                      -- e.g. 'Banco Popular'
  account_type TEXT NOT NULL CHECK (account_type IN ('ahorros', 'corriente')),
  account      TEXT NOT NULL,                      -- the account number, as the bank writes it
  holder       TEXT NOT NULL,                      -- the name on the account
  holder_id    TEXT,                               -- cédula or RNC, which transfers between banks ask for (optional)
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (shelter_id, position)
);

-- The one account 0023 allowed becomes each shelter's first.
INSERT INTO shelter_donation_accounts (id, shelter_id, position, bank, account_type, account, holder, holder_id)
SELECT lower(hex(randomblob(16))), id, 0, donation_bank, donation_account_type, donation_account, donation_holder, donation_holder_id
  FROM shelters WHERE donation_bank IS NOT NULL;

ALTER TABLE shelters DROP COLUMN donation_bank;
ALTER TABLE shelters DROP COLUMN donation_account_type;
ALTER TABLE shelters DROP COLUMN donation_account;
ALTER TABLE shelters DROP COLUMN donation_holder;
ALTER TABLE shelters DROP COLUMN donation_holder_id;

-- They show on cached pet profiles, so a change bumps the catalogue version (as 0006 does for shelters).
CREATE TRIGGER donation_accounts_bump_insert AFTER INSERT ON shelter_donation_accounts BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER donation_accounts_bump_update AFTER UPDATE ON shelter_donation_accounts BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER donation_accounts_bump_delete AFTER DELETE ON shelter_donation_accounts BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;
