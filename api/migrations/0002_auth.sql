-- Migration number: 0002 	 2026-10-12
-- Sign-in: Google accounts, email code/link sign-in, and sessions.
-- Only hashes of tokens and codes are stored, so a database leak can't be replayed as a login.

-- Which external accounts belong to a user (one user can have Google and email).
CREATE TABLE auth_identities (
  provider         TEXT NOT NULL CHECK (provider IN ('google')),
  provider_user_id TEXT NOT NULL,                  -- Google's stable `sub`
  user_id          TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  email            TEXT NOT NULL COLLATE NOCASE,   -- email the provider reported at link time
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX auth_identities_user ON auth_identities (user_id);

-- One email can have several pending codes (re-sends); each is single-use and short-lived.
CREATE TABLE email_codes (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL COLLATE NOCASE,
  code_hash       TEXT NOT NULL,                   -- SHA-256 of the 6-digit code, salted with id
  link_token_hash TEXT NOT NULL UNIQUE,            -- SHA-256 of the one-tap link token
  attempts        INTEGER NOT NULL DEFAULT 0,      -- wrong guesses; the code dies at 5
  ip_hash         TEXT,                            -- SHA-256 of the requester's IP, for per-IP rate limits
  expires_at      TEXT NOT NULL,
  consumed_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX email_codes_email ON email_codes (email, created_at);
CREATE INDEX email_codes_ip ON email_codes (ip_hash, created_at);

-- Browser sessions. The cookie holds a random token; only its hash is stored here.
CREATE TABLE sessions (
  id_hash      TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  user_agent   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expires ON sessions (expires_at);
