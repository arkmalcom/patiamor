-- Migration number: 0027 	 2026-10-30
-- Fostering (owner decision, 2026-10-30): besides adopting, a person can offer to be a foster home ("hogar
-- temporal") for an animal from a verified shelter, for a length they choose. An offer is a request like
-- any other: the same form, the same inbox, and one of Mi lista's three slots. It stays open while the
-- animal lives with them, so the status list, the three-slot trigger and the counters in 0007 need no
-- change: a foster in progress is an open request with foster_started_at set. The animal stays listed for
-- adoption meanwhile, tagged "En hogar temporal" (pets.fostered).
ALTER TABLE adoption_requests ADD COLUMN kind TEXT NOT NULL DEFAULT 'adopt' CHECK (kind IN ('adopt', 'foster'));
-- How long they can foster: a length for a foster offer, nothing for an adoption.
ALTER TABLE adoption_requests ADD COLUMN foster_length TEXT
  CHECK ((kind = 'foster') = (foster_length IS NOT NULL) AND (foster_length IS NULL OR foster_length IN ('dos_semanas', 'un_mes', 'dos_tres_meses', 'hasta_adopcion')));
-- When the shelter said the animal moved in. It ends when the request closes (the shelter's
-- "acogida_terminada", or any other way a request ends).
ALTER TABLE adoption_requests ADD COLUMN foster_started_at TEXT CHECK (foster_started_at IS NULL OR kind = 'foster');

-- One foster home at a time per animal.
CREATE UNIQUE INDEX adoption_requests_one_foster ON adoption_requests (pet_id)
  WHERE foster_started_at IS NOT NULL AND status IN ('sent', 'seen', 'contacted', 'visit');

-- Whether the animal is in a foster home right now, kept by triggers so lists and profiles read it for free.
-- Updating pets bumps the catalogue version (0006), so cached pages pick up the tag.
ALTER TABLE pets ADD COLUMN fostered INTEGER NOT NULL DEFAULT 0 CHECK (fostered IN (0, 1));

CREATE TRIGGER adoption_requests_fostered AFTER UPDATE OF status, foster_started_at ON adoption_requests
WHEN (OLD.foster_started_at IS NOT NULL AND OLD.status IN ('sent', 'seen', 'contacted', 'visit'))
  != (NEW.foster_started_at IS NOT NULL AND NEW.status IN ('sent', 'seen', 'contacted', 'visit'))
BEGIN
  UPDATE pets SET fostered = (NEW.foster_started_at IS NOT NULL AND NEW.status IN ('sent', 'seen', 'contacted', 'visit')) WHERE id = NEW.pet_id;
END;

CREATE TRIGGER adoption_requests_fostered_delete AFTER DELETE ON adoption_requests
WHEN OLD.foster_started_at IS NOT NULL AND OLD.status IN ('sent', 'seen', 'contacted', 'visit')
BEGIN
  UPDATE pets SET fostered = 0 WHERE id = OLD.pet_id;
END;
