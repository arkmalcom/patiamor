-- Migration number: 0016 	 2026-10-14
-- Finding an animal by name when the app's own list doesn't have it (the list is the nearest 1,000
-- nationwide, and search must still work past that). Names are looked up by their start, so the
-- lookup reads about as many rows as it returns and a flood of searches can't scan the table.
--
-- name_key is the name without accents or capitals ("Panchó" → "pancho"); name_rest is what follows its
-- first word ("Luna Pancho" → "pancho"), so a second word is found too. Both are indexed. They are
-- generated columns, so every way of writing a pet (the portal, seeds, a manual fix) keeps them right.
-- Plain indexes rather than full-text search, which D1 can't export (our backups are exports).
ALTER TABLE pets ADD COLUMN name_key TEXT GENERATED ALWAYS AS (lower(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(name, 'á', 'a'), 'à', 'a'), 'â', 'a'), 'ä', 'a'), 'Á', 'a'), 'À', 'a'), 'Â', 'a'), 'Ä', 'a'), 'é', 'e'), 'è', 'e'), 'ê', 'e'), 'ë', 'e'), 'É', 'e'), 'È', 'e'), 'Ê', 'e'), 'Ë', 'e'), 'í', 'i'), 'ì', 'i'), 'î', 'i'), 'ï', 'i'), 'Í', 'i'), 'Ì', 'i'), 'Î', 'i'), 'Ï', 'i'), 'ó', 'o'), 'ò', 'o'), 'ô', 'o'), 'ö', 'o'), 'Ó', 'o'), 'Ò', 'o'), 'Ô', 'o'), 'Ö', 'o'), 'ú', 'u'), 'ù', 'u'), 'û', 'u'), 'ü', 'u'), 'Ú', 'u'), 'Ù', 'u'), 'Û', 'u'), 'Ü', 'u'), 'ñ', 'n'), 'Ñ', 'n'), 'ç', 'c'), 'Ç', 'c'))) VIRTUAL;
ALTER TABLE pets ADD COLUMN name_rest TEXT GENERATED ALWAYS AS (CASE WHEN instr(name_key, ' ') > 0 THEN substr(name_key, instr(name_key, ' ') + 1) END) VIRTUAL;
CREATE INDEX pets_name_key ON pets (name_key);
CREATE INDEX pets_name_rest ON pets (name_rest);
