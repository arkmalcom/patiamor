-- Migration number: 0015 	 2026-10-14
-- Special requests to adopt more than the three Mi lista allows (a farm, a large family home). They aren't
-- about one animal: an admin reads them with the adopter's other requests in mind, and if approved, puts
-- them in touch with the shelter or shelters that fit. A person has at most one waiting at a time.
CREATE TABLE bulk_requests (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  animals         INTEGER NOT NULL CHECK (animals BETWEEN 4 AND 30),
  species         TEXT NOT NULL CHECK (species IN ('perros', 'gatos', 'ambos')),
  wanted          TEXT,                       -- which animals or shelter they have in mind (optional)
  about           TEXT NOT NULL,              -- their home, experience, who would care for them
  contact_phone   TEXT,                       -- E.164, optional: their email is always known
  consent_at      TEXT NOT NULL,              -- agreed to share this with the shelters Patiamor contacts
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  decision_note   TEXT,                       -- the adopter sees it (required when declining)
  decided_by      TEXT REFERENCES users (id),
  decided_at      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE UNIQUE INDEX bulk_requests_one_pending ON bulk_requests (user_id) WHERE status = 'pending';
CREATE INDEX bulk_requests_user ON bulk_requests (user_id, created_at);
CREATE INDEX bulk_requests_status ON bulk_requests (status, created_at);
