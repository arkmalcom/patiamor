-- Migration number: 0025 	 2026-10-28
-- Cases (owner decision, 2026-10-28): a verified shelter asks for help with an animal's surgery, treatment,
-- exams or recovery, apart from adoption. People give straight to the shelter's donation accounts (0024):
-- Patiamor never handles the money. Only shelters (never private listers) publish them, and an admin may
-- publish one for a shelter. A case ends with what happened, and drops out of view after 60 days with no
-- news (cases.ts).
CREATE TABLE cases (
  id           TEXT PRIMARY KEY,
  shelter_id   TEXT NOT NULL REFERENCES shelters (id) ON DELETE CASCADE,
  pet_id       TEXT REFERENCES pets (id) ON DELETE SET NULL,    -- the same animal's adoption listing, if it has one
  species      TEXT NOT NULL CHECK (species IN ('perro', 'gato')),
  name         TEXT NOT NULL,
  need         TEXT NOT NULL CHECK (need IN ('cirugia', 'tratamiento', 'examenes', 'medicinas', 'recuperacion', 'otro')),
  story        TEXT NOT NULL,
  cost_dop     INTEGER CHECK (cost_dop IS NULL OR cost_dop BETWEEN 1 AND 2000000), -- the estimate, from the vet's quote
  also_needed  TEXT,                                           -- help that isn't money: a foster home, blood donors…
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'resolved', 'closed')),
  outcome      TEXT,                                           -- how it ended, in the shelter's words
  created_by   TEXT REFERENCES users (id) ON DELETE SET NULL,
  published_at TEXT,
  active_at    TEXT,                                           -- published, or the latest news: 60 days after it, the case is hidden
  ended_at     TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX cases_status_active ON cases (status, active_at);
CREATE INDEX cases_shelter ON cases (shelter_id);
CREATE INDEX cases_pet ON cases (pet_id);

-- News on a case ("ya la operaron"), newest shown first.
CREATE TABLE case_updates (
  id         TEXT PRIMARY KEY,
  case_id    TEXT NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX case_updates_case ON case_updates (case_id, created_at);

-- Photos work like pets' (0011): resized on the phone, keys from a content hash, five per case, and the
-- same storage counter, so cases and pets share one ceiling below R2's free 10 GB.
CREATE TABLE case_photos (
  id           TEXT PRIMARY KEY,
  case_id      TEXT NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  r2_key       TEXT NOT NULL UNIQUE,
  thumb_key    TEXT,
  content_type TEXT,
  bytes        INTEGER NOT NULL DEFAULT 0,
  uploaded_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  position     INTEGER NOT NULL DEFAULT 0,
  focus        TEXT NOT NULL DEFAULT '50% 40%',
  width        INTEGER,
  height       INTEGER,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (case_id, position)
);

CREATE TRIGGER case_photos_max_five
BEFORE INSERT ON case_photos
WHEN (SELECT count(*) FROM case_photos WHERE case_id = NEW.case_id) >= 5
BEGIN
  SELECT RAISE(ABORT, 'photos_full');
END;
CREATE TRIGGER case_photos_storage_insert AFTER INSERT ON case_photos BEGIN UPDATE photo_storage SET bytes = bytes + NEW.bytes WHERE id = 1; END;
CREATE TRIGGER case_photos_storage_delete AFTER DELETE ON case_photos BEGIN UPDATE photo_storage SET bytes = max(0, bytes - OLD.bytes) WHERE id = 1; END;

-- Cases are cached like pets (the list and each page), and a linked pet's profile shows its case: any
-- change bumps the catalogue version (0006).
CREATE TRIGGER cases_bump_insert AFTER INSERT ON cases BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER cases_bump_update AFTER UPDATE ON cases BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER cases_bump_delete AFTER DELETE ON cases BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER case_updates_bump_insert AFTER INSERT ON case_updates BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER case_updates_bump_delete AFTER DELETE ON case_updates BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER case_photos_bump_insert AFTER INSERT ON case_photos BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER case_photos_bump_update AFTER UPDATE ON case_photos BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER case_photos_bump_delete AFTER DELETE ON case_photos BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;
