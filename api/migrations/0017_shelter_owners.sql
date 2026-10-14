-- Migration number: 0017 	 2026-10-14
-- Who may register a shelter. Anyone signed in could, which invites spam and "the same shelter spelled a
-- hundred ways". Now a person asks to be a shelter owner, an admin gets to know them and the shelter
-- (off the platform) and approves, and only then can they register it. Admins can also register a shelter
-- for someone, from the details the owner gave them.

-- Set when an admin approves the person as a shelter owner. (lister_approved_at is for approving a private
-- person's first listing, a different thing.)
ALTER TABLE users ADD COLUMN shelter_owner_at TEXT;

-- Anyone who already owns a shelter keeps owning shelters.
UPDATE users SET shelter_owner_at = (SELECT min(m.created_at) FROM shelter_members m WHERE m.user_id = users.id AND m.role = 'owner')
 WHERE id IN (SELECT user_id FROM shelter_members WHERE role = 'owner');

CREATE TABLE shelter_owner_requests (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  shelter_name  TEXT NOT NULL,
  zone          TEXT NOT NULL,                -- where, in their words; the admin pins it down when they talk
  phone         TEXT NOT NULL,                -- E.164: how the admin reaches them (and spots repeat requests)
  link          TEXT,                         -- Instagram, Facebook or a website (optional)
  about         TEXT NOT NULL,                -- who they are, their role, how the shelter works
  consent_at    TEXT NOT NULL,                -- agreed to be contacted to verify
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  decision_note TEXT,                         -- the person reads it (required when declining)
  decided_by    TEXT REFERENCES users (id),
  decided_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
-- One waiting at a time per person.
CREATE UNIQUE INDEX shelter_owner_requests_one_pending ON shelter_owner_requests (user_id) WHERE status = 'pending';
CREATE INDEX shelter_owner_requests_user ON shelter_owner_requests (user_id, created_at);
CREATE INDEX shelter_owner_requests_status ON shelter_owner_requests (status, created_at);
CREATE INDEX shelter_owner_requests_phone ON shelter_owner_requests (phone);
