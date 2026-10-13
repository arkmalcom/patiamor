-- Shelter verification (PAT-13). A shelter registers through the portal (/refugio) and stays hidden
-- from adopters until an admin verifies it. Visibility follows `status`, not just `verified_at`, so a
-- suspended shelter disappears at once while keeping the date it was first verified.
ALTER TABLE shelters ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'verified', 'rejected', 'suspended'));
-- Shown to the shelter when rejected or suspended, so they know what to fix.
ALTER TABLE shelters ADD COLUMN status_reason TEXT;
UPDATE shelters SET status = 'verified' WHERE verified_at IS NOT NULL;

-- What a shelter tells Patiamor so it can be verified. Private: never shown to adopters.
CREATE TABLE shelter_applications (
  shelter_id        TEXT PRIMARY KEY REFERENCES shelters (id) ON DELETE CASCADE,
  contact_name      TEXT NOT NULL,
  contact_phone     TEXT NOT NULL,                -- E.164; the WhatsApp number for the verification call
  rnc               TEXT,                         -- RNC / ASFL registration, if they have one
  address           TEXT NOT NULL,                -- the real address, for the video tour or a visit; never published
  social            TEXT NOT NULL DEFAULT '[]',   -- JSON array of links (Instagram, Facebook, a website)
  history           TEXT NOT NULL,                -- how long they've rescued, how many animals, how they work
  reference_name    TEXT NOT NULL,
  reference_contact TEXT NOT NULL,
  reference_kind    TEXT NOT NULL CHECK (reference_kind IN ('veterinaria', 'refugio', 'otro')),
  submitted_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  reviewed_at       TEXT,
  reviewed_by       TEXT REFERENCES users (id)
);

-- Every moderation decision, so they can be looked back on (the admin console, PAT-14, reads this).
CREATE TABLE admin_actions (
  id           TEXT PRIMARY KEY,
  admin_id     TEXT NOT NULL REFERENCES users (id),
  action       TEXT NOT NULL,                     -- e.g. 'shelter.verify', 'shelter.reject', 'shelter.suspend'
  subject_type TEXT NOT NULL,                     -- e.g. 'shelter'
  subject_id   TEXT NOT NULL,
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX admin_actions_subject ON admin_actions (subject_type, subject_id, created_at);
