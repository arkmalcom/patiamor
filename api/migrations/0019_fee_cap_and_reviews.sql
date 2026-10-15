-- Migration number: 0019 	 2026-10-15
-- Two owner decisions (2026-10-15):
--
-- 1. Adoption fees are capped at RD$2,000 by default. A shelter that needs more talks to the admins, who
--    can raise the cap for that shelter. NULL means the default (listings.ts); never above RD$50,000.
ALTER TABLE shelters ADD COLUMN fee_cap_dop INTEGER CHECK (fee_cap_dop IS NULL OR (fee_cap_dop >= 0 AND fee_cap_dop <= 50000));

-- 2. A suspended shelter's owner can ask for a review, explaining why the suspension should be lifted. An
--    admin lifts it (the shelter is verified again) or keeps it, with a note the owner reads.
CREATE TABLE shelter_reviews (
  id            TEXT PRIMARY KEY,
  shelter_id    TEXT NOT NULL REFERENCES shelters (id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,   -- the owner who asked
  message       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'lifted', 'kept')),
  decision_note TEXT,                                                    -- the owner reads it (required when keeping)
  decided_by    TEXT REFERENCES users (id),
  decided_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
-- One waiting at a time per shelter.
CREATE UNIQUE INDEX shelter_reviews_one_pending ON shelter_reviews (shelter_id) WHERE status = 'pending';
CREATE INDEX shelter_reviews_shelter ON shelter_reviews (shelter_id, created_at);
