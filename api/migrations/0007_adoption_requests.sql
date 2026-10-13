-- Adoption requests. Mi lista's three slots ARE requests: liking a pet leads to its full profile, and
-- "Sí, quiero empezar el proceso" sends a request in one deliberate step. There is no separate "save".
-- Each request keeps a snapshot of what the adopter agreed to share, so later edits to their account
-- don't change what the lister was sent.
CREATE TABLE adoption_requests (
  id              TEXT PRIMARY KEY,
  pet_id          TEXT NOT NULL REFERENCES pets (id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- sent → seen (lister opened it) → contacted → visit → adopted; or closed (by the lister, or because
  -- the pet found another home) or withdrawn (by the adopter; the lister always sees it).
  status          TEXT NOT NULL DEFAULT 'sent'
                  CHECK (status IN ('sent', 'seen', 'contacted', 'visit', 'adopted', 'closed', 'withdrawn')),
  -- The reflection questions, answered when the request is sent.
  answer_space    TEXT NOT NULL CHECK (answer_space IN ('si', 'pensando')),
  answer_time     TEXT NOT NULL CHECK (answer_time IN ('si', 'pensando')),
  answer_cost     TEXT NOT NULL CHECK (answer_cost IN ('si', 'pensando')),
  -- "Cuéntale más": all optional, so a serious adopter is never one long form away from a shelter.
  home            TEXT CHECK (home IS NULL OR home IN ('casa_patio', 'casa', 'apartamento')),
  other_pets      TEXT NOT NULL DEFAULT '[]',     -- JSON array of 'perros' | 'gatos' | 'otros'
  kids            TEXT CHECK (kids IS NULL OR kids IN ('no', 'menores', 'mayores')),
  experience      TEXT CHECK (experience IS NULL OR experience IN ('si', 'primera')),
  visit           TEXT CHECK (visit IS NULL OR visit IN ('semana', 'fin', 'cualquiera')),
  message         TEXT,
  contact_name    TEXT NOT NULL,
  contact_email   TEXT NOT NULL,
  contact_phone   TEXT,                           -- E.164 (+1 809/829/849 …); required unless they prefer email
  contact_pref    TEXT NOT NULL CHECK (contact_pref IN ('whatsapp', 'llamada', 'correo')),
  phone_verified  INTEGER NOT NULL DEFAULT 0 CHECK (phone_verified IN (0, 1)),
  consent_at      TEXT NOT NULL,                  -- when they agreed to share their contact details with this lister
  seen_at         TEXT,
  closed_reason   TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
-- One open request per adopter and pet; a closed or withdrawn one doesn't block asking again later.
CREATE UNIQUE INDEX adoption_requests_one_open ON adoption_requests (user_id, pet_id)
  WHERE status IN ('sent', 'seen', 'contacted', 'visit');

-- Three open requests per adopter, enforced by the database so no code path can bypass it. A request
-- the lister closes, or one that ends because the pet went home with someone else, frees its slot.
CREATE TRIGGER adoption_requests_max_three
BEFORE INSERT ON adoption_requests
WHEN (SELECT count(*) FROM adoption_requests WHERE user_id = NEW.user_id AND status IN ('sent', 'seen', 'contacted', 'visit')) >= 3
BEGIN
  SELECT RAISE(ABORT, 'requests_full');
END;

-- How the adopter likes to be reached, remembered for their next request.
ALTER TABLE users ADD COLUMN contact_pref TEXT CHECK (contact_pref IS NULL OR contact_pref IN ('whatsapp', 'llamada', 'correo'));

CREATE INDEX adoption_requests_pet ON adoption_requests (pet_id, status);
CREATE INDEX adoption_requests_user ON adoption_requests (user_id, created_at);

-- How many open requests each pet has, kept by triggers so the list and profiles read it for free.
-- Updating pets also bumps the catalogue version (0006), so cached pages pick up "busy" or "paused".
-- requests_paused is the lister's manual switch (portal, later).
ALTER TABLE pets ADD COLUMN open_requests INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pets ADD COLUMN requests_paused INTEGER NOT NULL DEFAULT 0 CHECK (requests_paused IN (0, 1));

CREATE TRIGGER adoption_requests_count_insert AFTER INSERT ON adoption_requests
WHEN NEW.status IN ('sent', 'seen', 'contacted', 'visit')
BEGIN
  UPDATE pets SET open_requests = open_requests + 1 WHERE id = NEW.pet_id;
END;

CREATE TRIGGER adoption_requests_count_close AFTER UPDATE OF status ON adoption_requests
WHEN OLD.status IN ('sent', 'seen', 'contacted', 'visit') AND NEW.status NOT IN ('sent', 'seen', 'contacted', 'visit')
BEGIN
  UPDATE pets SET open_requests = max(0, open_requests - 1) WHERE id = NEW.pet_id;
END;

CREATE TRIGGER adoption_requests_count_reopen AFTER UPDATE OF status ON adoption_requests
WHEN OLD.status NOT IN ('sent', 'seen', 'contacted', 'visit') AND NEW.status IN ('sent', 'seen', 'contacted', 'visit')
BEGIN
  UPDATE pets SET open_requests = open_requests + 1 WHERE id = NEW.pet_id;
END;

CREATE TRIGGER adoption_requests_count_delete AFTER DELETE ON adoption_requests
WHEN OLD.status IN ('sent', 'seen', 'contacted', 'visit')
BEGIN
  UPDATE pets SET open_requests = max(0, open_requests - 1) WHERE id = OLD.pet_id;
END;

-- "Avísame si vuelve a estar disponible": who to tell when a pet in process or paused reopens.
CREATE TABLE availability_alerts (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  pet_id     TEXT NOT NULL REFERENCES pets (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (user_id, pet_id)
);
CREATE INDEX availability_alerts_pet ON availability_alerts (pet_id);

-- Every email we send, by kind, so one daily cap covers them all (Resend's free tier: 100 a day for
-- the whole account). Sign-in codes always keep headroom; confirmations and digests yield first.
CREATE TABLE email_log (
  id         INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL,                       -- 'signin' | 'request_sent' | later: digests, updates
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX email_log_created ON email_log (created_at);
