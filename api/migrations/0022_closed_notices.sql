-- Migration number: 0022 	 2026-10-16
-- Telling an adopter when their request ended without a home for them (PAT-6, owner decision 2026-10-16: no
-- email for good news, they already know; the shelter has told them). One email per person per morning,
-- sent by the morning job; this marks the requests it has already told about.
ALTER TABLE adoption_requests ADD COLUMN closed_notified_at TEXT;

-- Requests closed before this existed won't be announced after the fact.
UPDATE adoption_requests SET closed_notified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE status = 'closed';

CREATE INDEX adoption_requests_unnotified ON adoption_requests (status) WHERE status = 'closed' AND closed_notified_at IS NULL;
