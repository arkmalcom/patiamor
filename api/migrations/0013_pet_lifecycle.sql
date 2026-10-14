-- Migration number: 0013 	 2026-10-14
-- How an animal's time on Patiamor ends (PAT-11): it goes home (adopted), or the shelter withdraws it;
-- either can be undone by relisting. Ending closes its open requests, so adopters' slots free up.
-- pets.adopted_at already exists (0001).

-- The request that led to the adoption; NULL when the family came from outside Patiamor. For the
-- shelter's adoption-rate badge later (PAT-17).
ALTER TABLE pets ADD COLUMN adopted_request_id TEXT;
ALTER TABLE pets ADD COLUMN withdrawn_at TEXT;
ALTER TABLE pets ADD COLUMN withdrawn_reason TEXT;

-- Relisting an adopted or withdrawn animal also counts as reopening, so "Avísame" hears about it.
DROP TRIGGER pets_reopened;
CREATE TRIGGER pets_reopened AFTER UPDATE OF status, requests_paused, open_requests ON pets
WHEN (OLD.status IN ('reserved', 'adopted', 'withdrawn') AND NEW.status = 'available')
  OR (OLD.requests_paused = 1 AND NEW.requests_paused = 0)
  OR (OLD.open_requests >= 10 AND NEW.open_requests < 10)
BEGIN
  UPDATE pets SET reopened_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
END;
