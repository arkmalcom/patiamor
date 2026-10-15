-- Migration number: 0018 	 2026-10-15
-- "Verificado por Patiamor" on an adopter (PAT-2). Checking phone numbers automatically costs money per
-- check, so nobody would be verified and an "unverified" label would mean nothing. Instead an admin marks
-- a person they have checked out, or already know, and shelters see the badge on that person's requests.

ALTER TABLE users ADD COLUMN adopter_verified_at TEXT;
ALTER TABLE users ADD COLUMN adopter_verified_by TEXT REFERENCES users (id);
-- How the admin knows them ("adoptó a Luna con Hogar X", "hablamos por WhatsApp"): for admins only.
ALTER TABLE users ADD COLUMN adopter_verified_note TEXT;
