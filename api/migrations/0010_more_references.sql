-- Shelters can give up to two more references beyond the required one (PAT-13). The first stays in its
-- own columns; the extras are a JSON array of { name, contact, kind }.
ALTER TABLE shelter_applications ADD COLUMN more_references TEXT NOT NULL DEFAULT '[]';
