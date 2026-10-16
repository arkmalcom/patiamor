-- Migration number: 0021 	 2026-10-16
-- Private listers: a person outside any shelter who rehomes animals (a family with a litter). Owner decision
-- (2026-10-16): an admin approves the person, not each listing, and they then work like a shelter, only
-- smaller. So a private lister is a row in `shelters` of kind 'private': one person, verified when an
-- admin approves them, with the same listing form, inbox, moderation and suspension. What adopters see
-- never names the person ("Particular" plus the area), and a private lister can't ask for a fee.

ALTER TABLE shelters ADD COLUMN kind TEXT NOT NULL DEFAULT 'shelter' CHECK (kind IN ('shelter', 'private'));

-- Their request to be approved is the same table as a shelter owner's (one waiting at a time, three in 90
-- days). A private request has no shelter name: the person says where they are (a place) and who they are.
ALTER TABLE shelter_owner_requests ADD COLUMN kind TEXT NOT NULL DEFAULT 'shelter' CHECK (kind IN ('shelter', 'private'));
ALTER TABLE shelter_owner_requests ADD COLUMN place_id TEXT REFERENCES places (id);
