-- Migration number: 0012 	 2026-10-13
-- The shelter's request inbox (PAT-5) and the daily email job (PAT-4). To stay inside the free email
-- budget there are no per-request emails to shelters: one morning summary per shelter lists what's new,
-- and "Avísame" alerts go out in the same run.

-- When a morning summary told the shelter about this request (NULL: not yet). Marked per request, not
-- by comparing times, so a request sent the same second the job runs is never skipped.
ALTER TABLE adoption_requests ADD COLUMN digested_at TEXT;

-- When a pet last became requestable again (left "en proceso", was unpaused, or dropped below the
-- automatic cap). The morning run tells people waiting with "Avísame" since before then.
ALTER TABLE pets ADD COLUMN reopened_at TEXT;

CREATE TRIGGER pets_reopened AFTER UPDATE OF status, requests_paused, open_requests ON pets
WHEN (OLD.status = 'reserved' AND NEW.status = 'available')
  OR (OLD.requests_paused = 1 AND NEW.requests_paused = 0)
  OR (OLD.open_requests >= 10 AND NEW.open_requests < 10)
BEGIN
  UPDATE pets SET reopened_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
END;

CREATE INDEX adoption_requests_undigested ON adoption_requests (status) WHERE digested_at IS NULL;
