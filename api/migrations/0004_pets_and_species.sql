-- Migration number: 0004 	 2026-10-13
-- Cats join dogs: rename the dog-specific tables/columns to "pets" and add a species column.
-- SQLite rewrites foreign-key references in other tables when a table or column is renamed.

ALTER TABLE dogs RENAME TO pets;
ALTER TABLE dog_photos RENAME TO pet_photos;
ALTER TABLE pet_photos RENAME COLUMN dog_id TO pet_id;
ALTER TABLE shortlist RENAME COLUMN dog_id TO pet_id;
ALTER TABLE reports RENAME COLUMN dog_id TO pet_id;

-- Existing rows are dogs.
ALTER TABLE pets ADD COLUMN species TEXT NOT NULL DEFAULT 'perro' CHECK (species IN ('perro', 'gato'));

-- Index names follow the new table names (columns were renamed in place already).
DROP INDEX dogs_status_place;
DROP INDEX dogs_shelter;
DROP INDEX dogs_listed_by;
DROP INDEX dogs_litter;
DROP INDEX shortlist_dog;
CREATE INDEX pets_status_place ON pets (status, place_id);
CREATE INDEX pets_shelter ON pets (shelter_id);
CREATE INDEX pets_listed_by ON pets (listed_by);
CREATE INDEX pets_litter ON pets (litter_id);
CREATE INDEX shortlist_pet ON shortlist (pet_id);
