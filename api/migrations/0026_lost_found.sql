-- Migration number: 0026 	 2026-10-28
-- Lost and found (owner decision, 2026-10-28): a verified shelter posts an animal someone lost, or one found in
-- the street, so people nearby can recognise it. Only shelters post (never private listers or the public):
-- whoever lost or found an animal goes through a shelter, and people who respond call the shelter's public
-- phone, so owners' and finders' numbers are never published. A post stays up 30 days unless the shelter
-- renews it, and ends when the animal is home or the shelter closes it (lostfound.ts).
CREATE TABLE lost_found (
  id           TEXT PRIMARY KEY,
  shelter_id   TEXT NOT NULL REFERENCES shelters (id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('perdido', 'encontrado')),
  species      TEXT NOT NULL CHECK (species IN ('perro', 'gato')),
  name         TEXT,                                           -- often unknown for an animal found
  sex          TEXT CHECK (sex IS NULL OR sex IN ('hembra', 'macho')),
  description  TEXT NOT NULL,                                  -- colour, size, collar, microchip, how it behaves
  place_id     TEXT NOT NULL REFERENCES places (id),           -- where it was lost or seen
  seen_on      TEXT NOT NULL,                                  -- YYYY-MM-DD
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'home', 'closed')),
  created_by   TEXT REFERENCES users (id) ON DELETE SET NULL,
  published_at TEXT,
  active_at    TEXT,                                           -- published or renewed: 30 days after it, the post is hidden
  ended_at     TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX lost_found_status_active ON lost_found (status, active_at);
CREATE INDEX lost_found_shelter ON lost_found (shelter_id);

-- Photos as for pets (0011) and cases (0025): five per post, one storage counter for all of them.
CREATE TABLE lost_found_photos (
  id           TEXT PRIMARY KEY,
  post_id      TEXT NOT NULL REFERENCES lost_found (id) ON DELETE CASCADE,
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
  UNIQUE (post_id, position)
);

CREATE TRIGGER lost_found_photos_max_five
BEFORE INSERT ON lost_found_photos
WHEN (SELECT count(*) FROM lost_found_photos WHERE post_id = NEW.post_id) >= 5
BEGIN
  SELECT RAISE(ABORT, 'photos_full');
END;
CREATE TRIGGER lost_found_photos_storage_insert AFTER INSERT ON lost_found_photos BEGIN UPDATE photo_storage SET bytes = bytes + NEW.bytes WHERE id = 1; END;
CREATE TRIGGER lost_found_photos_storage_delete AFTER DELETE ON lost_found_photos BEGIN UPDATE photo_storage SET bytes = max(0, bytes - OLD.bytes) WHERE id = 1; END;

-- Cached like pets and cases: any change bumps the catalogue version (0006).
CREATE TRIGGER lost_found_bump_insert AFTER INSERT ON lost_found BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER lost_found_bump_update AFTER UPDATE ON lost_found BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER lost_found_bump_delete AFTER DELETE ON lost_found BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER lost_found_photos_bump_insert AFTER INSERT ON lost_found_photos BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER lost_found_photos_bump_update AFTER UPDATE ON lost_found_photos BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER lost_found_photos_bump_delete AFTER DELETE ON lost_found_photos BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;
