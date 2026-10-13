-- Migration number: 0011 	 2026-10-13
-- Photo uploads to R2 (PAT-9). Each photo is two objects: the full image (about 1600 px) and a small
-- thumbnail for lists. Both are resized on the shelter's phone; the Worker checks them and names them
-- after a hash of their contents, so a key never changes meaning and can be cached for good.

ALTER TABLE pet_photos ADD COLUMN thumb_key TEXT;
ALTER TABLE pet_photos ADD COLUMN content_type TEXT;
ALTER TABLE pet_photos ADD COLUMN bytes INTEGER NOT NULL DEFAULT 0;      -- full + thumbnail
ALTER TABLE pet_photos ADD COLUMN uploaded_by TEXT REFERENCES users (id) ON DELETE SET NULL;

-- Five photos per animal, enforced by the database so no code path can go past it.
CREATE TRIGGER pet_photos_max_five
BEFORE INSERT ON pet_photos
WHEN (SELECT count(*) FROM pet_photos WHERE pet_id = NEW.pet_id) >= 5
BEGIN
  SELECT RAISE(ABORT, 'photos_full');
END;

-- Upload budgets: one row per person per UTC day. Deleting a photo doesn't give an upload back, so
-- uploading and deleting in a loop still runs into the limit. The day's total is a sum over a handful
-- of rows, not a scan of every upload.
CREATE TABLE photo_quota (
  day     TEXT NOT NULL,                      -- YYYY-MM-DD, UTC
  user_id TEXT NOT NULL,
  n       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, user_id)
);

-- Bytes stored in R2 across every photo, kept by triggers, so uploads stop well before the free tier's
-- 10 GB without summing the whole table on each upload.
CREATE TABLE photo_storage (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  bytes INTEGER NOT NULL
);
INSERT INTO photo_storage (id, bytes) VALUES (1, 0);

CREATE TRIGGER pet_photos_storage_insert AFTER INSERT ON pet_photos
BEGIN
  UPDATE photo_storage SET bytes = bytes + NEW.bytes WHERE id = 1;
END;

CREATE TRIGGER pet_photos_storage_delete AFTER DELETE ON pet_photos
BEGIN
  UPDATE photo_storage SET bytes = max(0, bytes - OLD.bytes) WHERE id = 1;
END;
