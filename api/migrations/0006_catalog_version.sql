-- Public pet pages (the national list and each profile) are cached at Cloudflare's edge under the
-- current catalogue version. Any change to what adopters can see bumps the version, so every cached
-- copy in every data centre misses at once. Triggers do the bumping, so no write path (portal, admin,
-- a manual SQL fix) can forget to.
CREATE TABLE catalog_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  v  INTEGER NOT NULL
);
INSERT INTO catalog_version (id, v) VALUES (1, 1);

CREATE TRIGGER pets_bump_insert AFTER INSERT ON pets BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER pets_bump_update AFTER UPDATE ON pets BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER pets_bump_delete AFTER DELETE ON pets BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;

CREATE TRIGGER pet_photos_bump_insert AFTER INSERT ON pet_photos BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER pet_photos_bump_update AFTER UPDATE ON pet_photos BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER pet_photos_bump_delete AFTER DELETE ON pet_photos BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;

-- Shelters: verification decides visibility, and the name and visit hours show on cards and profiles.
CREATE TRIGGER shelters_bump_insert AFTER INSERT ON shelters BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER shelters_bump_update AFTER UPDATE ON shelters BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER shelters_bump_delete AFTER DELETE ON shelters BEGIN UPDATE catalog_version SET v = v + 1 WHERE id = 1; END;
