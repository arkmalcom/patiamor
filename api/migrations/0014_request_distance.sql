-- Migration number: 0014 	 2026-10-14
-- While shelters are few, adopters can live far from the animal they ask about. For animals further than
-- about 50 km the form asks whether they can travel, and the shelter sees the answer and the distance
-- (from the area the adopter browses from, rounded to 5 km: never a precise position).
ALTER TABLE adoption_requests ADD COLUMN distance_km INTEGER;
ALTER TABLE adoption_requests ADD COLUMN travel TEXT CHECK (travel IS NULL OR travel IN ('si', 'pensando'));
