-- Migration number: 0020 	 2026-10-15
-- The anti-resale safeguards (adopted 2026-10-12): reports (PAT-15) and money language (PAT-16) send a
-- live listing back to review. It is hidden from adopters ('in_review') until an admin puts it back or
-- takes it down; these say what it was and why it's there.

ALTER TABLE pets ADD COLUMN review_from TEXT CHECK (review_from IS NULL OR review_from IN ('available', 'reserved'));
ALTER TABLE pets ADD COLUMN review_reason TEXT CHECK (review_reason IS NULL OR review_reason IN ('reportes', 'dinero'));
-- What the money check found, as JSON (["vendo", "rd$5,000"]), for the shelter and the admin.
ALTER TABLE pets ADD COLUMN review_words TEXT;
ALTER TABLE pets ADD COLUMN review_at TEXT;

-- One report per person per animal; the report table exists since 0001 (reasons venta, estafa, maltrato,
-- datos_falsos, otro).
CREATE UNIQUE INDEX reports_once ON reports (pet_id, reported_by) WHERE reported_by IS NOT NULL;
CREATE INDEX reports_pet ON reports (pet_id, resolved_at);
CREATE INDEX reports_by ON reports (reported_by, created_at);

-- When the person read the rules for listing (shown before their first animal).
ALTER TABLE users ADD COLUMN lister_rules_at TEXT;
