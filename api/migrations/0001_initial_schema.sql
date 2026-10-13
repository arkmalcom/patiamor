-- Migration number: 0001 	 2026-10-12
-- Initial schema: places, people and roles, shelters, litters, dogs, photos, shortlists, reports.
-- IDs are TEXT (crypto.randomUUID() in the Worker); timestamps are ISO-8601 TEXT in UTC.

-- General areas (barrio / sector / municipio). Seeded from GeoNames (CC BY 4.0) and curated.
-- Listings point here instead of storing addresses, so a precise location is never collected.
CREATE TABLE places (
  id           TEXT PRIMARY KEY,                -- slug, e.g. 'gazcue-distrito-nacional'
  name         TEXT NOT NULL,                   -- display name, e.g. 'Gazcue'
  search_name  TEXT NOT NULL,                   -- lowercase, accents stripped, for autocomplete
  aliases      TEXT NOT NULL DEFAULT '[]',      -- JSON array of everyday names: ["naco"] for Ensanche Naco
  kind         TEXT NOT NULL CHECK (kind IN ('barrio', 'sector', 'paraje', 'distrito_municipal', 'municipio')),
  municipality TEXT NOT NULL,
  province     TEXT NOT NULL,
  lat          REAL NOT NULL CHECK (lat BETWEEN 17.3 AND 20.1),
  lng          REAL NOT NULL CHECK (lng BETWEEN -72.1 AND -68.2),
  geonames_id  INTEGER UNIQUE
);
CREATE INDEX places_lat_lng ON places (lat, lng);
CREATE INDEX places_search ON places (search_name);

-- Everyone who signs in. Shelter roles live in shelter_members; is_admin is the platform owner role.
CREATE TABLE users (
  id                 TEXT PRIMARY KEY,
  email              TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name               TEXT,                          -- asked after first sign-in if the provider didn't give one
  phone              TEXT,
  place_id           TEXT REFERENCES places (id),   -- the user's home area, optional
  is_admin           INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  -- Set when an admin approves this person's first private listing; after that they post freely.
  lister_approved_at TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE shelters (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  place_id    TEXT NOT NULL REFERENCES places (id),
  phone       TEXT,
  email       TEXT,
  website     TEXT,
  visit_hours TEXT,
  verified_at TEXT,                                -- set by an admin once the shelter is confirmed real
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE shelter_members (
  shelter_id TEXT NOT NULL REFERENCES shelters (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'maintainer')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (shelter_id, user_id)
);
CREATE INDEX shelter_members_user ON shelter_members (user_id);

-- Siblings listed together. Each puppy is still its own row in dogs and is adopted on its own.
CREATE TABLE litters (
  id         TEXT PRIMARY KEY,
  listed_by  TEXT NOT NULL REFERENCES users (id),
  shelter_id TEXT REFERENCES shelters (id),        -- NULL = private rehoming
  place_id   TEXT NOT NULL REFERENCES places (id),
  name       TEXT NOT NULL,                        -- e.g. 'Camada de Luna'
  born_on    TEXT,                                 -- YYYY-MM-DD, may be estimated
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE dogs (
  id                   TEXT PRIMARY KEY,
  listed_by            TEXT NOT NULL REFERENCES users (id),
  shelter_id           TEXT REFERENCES shelters (id),   -- NULL = private lister
  place_id             TEXT NOT NULL REFERENCES places (id),
  litter_id            TEXT REFERENCES litters (id) ON DELETE SET NULL,

  name                 TEXT NOT NULL,
  sex                  TEXT NOT NULL CHECK (sex IN ('hembra', 'macho')),
  birth_date           TEXT,                            -- YYYY-MM-DD
  birth_date_estimated INTEGER NOT NULL DEFAULT 1 CHECK (birth_date_estimated IN (0, 1)),
  size                 TEXT NOT NULL CHECK (size IN ('pequeno', 'mediano', 'grande')),
  energy               TEXT NOT NULL CHECK (energy IN ('tranquila', 'media', 'alta')),
  -- NULL means the lister doesn't know yet ("Por confirmar").
  good_with_kids       INTEGER CHECK (good_with_kids IN (0, 1)),
  good_with_dogs       INTEGER CHECK (good_with_dogs IN (0, 1)),
  good_with_cats       INTEGER CHECK (good_with_cats IN (0, 1)),
  vaccinated           INTEGER NOT NULL DEFAULT 0 CHECK (vaccinated IN (0, 1)),
  sterilized           INTEGER NOT NULL DEFAULT 0 CHECK (sterilized IN (0, 1)),
  dewormed             INTEGER NOT NULL DEFAULT 0 CHECK (dewormed IN (0, 1)),
  story                TEXT NOT NULL DEFAULT '',
  needs                TEXT NOT NULL DEFAULT '[]',      -- JSON array of short strings
  -- Only shelters may show a fee; private listers can't ask for money.
  adoption_fee_dop     INTEGER CHECK (adoption_fee_dop IS NULL OR (adoption_fee_dop >= 0 AND shelter_id IS NOT NULL)),

  status               TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'in_review', 'available', 'reserved', 'adopted', 'withdrawn')),
  reviewed_by          TEXT REFERENCES users (id),
  reviewed_at          TEXT,
  review_notes         TEXT,
  in_care_since        TEXT,                            -- YYYY-MM-DD
  published_at         TEXT,
  adopted_at           TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX dogs_status_place ON dogs (status, place_id);
CREATE INDEX dogs_shelter ON dogs (shelter_id);
CREATE INDEX dogs_listed_by ON dogs (listed_by);
CREATE INDEX dogs_litter ON dogs (litter_id);

-- Photo files live in R2; this table holds their keys and display hints.
CREATE TABLE dog_photos (
  id         TEXT PRIMARY KEY,
  dog_id     TEXT NOT NULL REFERENCES dogs (id) ON DELETE CASCADE,
  r2_key     TEXT NOT NULL UNIQUE,
  position   INTEGER NOT NULL DEFAULT 0,
  focus      TEXT NOT NULL DEFAULT '50% 40%',          -- CSS object-position keeping the face in frame
  width      INTEGER,
  height     INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (dog_id, position)
);

-- "Mi lista": three deliberate slots, with the answers given when saving.
CREATE TABLE shortlist (
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  dog_id       TEXT NOT NULL REFERENCES dogs (id) ON DELETE CASCADE,
  answer_space TEXT NOT NULL CHECK (answer_space IN ('si', 'pensando')),
  answer_time  TEXT NOT NULL CHECK (answer_time IN ('si', 'pensando')),
  answer_cost  TEXT NOT NULL CHECK (answer_cost IN ('si', 'pensando')),
  saved_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (user_id, dog_id)
);
CREATE INDEX shortlist_dog ON shortlist (dog_id);

-- The database itself refuses a 4th slot, so no code path can bypass the limit.
CREATE TRIGGER shortlist_max_three
BEFORE INSERT ON shortlist
WHEN (SELECT count(*) FROM shortlist WHERE user_id = NEW.user_id) >= 3
BEGIN
  SELECT RAISE(ABORT, 'shortlist_full');
END;

-- The report button. Reviewed by admins; the backstop for private listers after their first approval.
CREATE TABLE reports (
  id          TEXT PRIMARY KEY,
  dog_id      TEXT NOT NULL REFERENCES dogs (id) ON DELETE CASCADE,
  reported_by TEXT REFERENCES users (id) ON DELETE SET NULL,   -- NULL allows anonymous reports
  reason      TEXT NOT NULL CHECK (reason IN ('venta', 'estafa', 'maltrato', 'datos_falsos', 'otro')),
  details     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  resolved_at TEXT,
  resolved_by TEXT REFERENCES users (id)
);
CREATE INDEX reports_open ON reports (resolved_at, created_at);
