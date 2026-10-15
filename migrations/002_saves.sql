-- save codes and passkeys, so a player can be loaded on another browser or device. Additive.
--   npx wrangler d1 execute baton-db --remote --file=migrations/002_saves.sql

-- extra devices a player is loaded on (the first device keeps using players.token_hash)
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,         -- SHA-256 of the cookie token
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  seen_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_player ON sessions (player_id);

-- save codes like K7QM-2XPA-9RTD-HV4C-8NBE; only their hash is stored (up to 5 per player)
CREATE TABLE IF NOT EXISTS save_codes (
  id            INTEGER PRIMARY KEY,
  player_id     INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  code_hash     TEXT NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER
);
CREATE INDEX IF NOT EXISTS save_codes_player ON save_codes (player_id);

-- passkeys (WebAuthn): the public half of each key
CREATE TABLE IF NOT EXISTS passkeys (
  id            INTEGER PRIMARY KEY,
  player_id     INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  cred_id       TEXT NOT NULL UNIQUE,
  public_key    TEXT NOT NULL,          -- JWK
  alg           INTEGER NOT NULL,       -- -7 ES256, -257 RS256
  sign_count    INTEGER NOT NULL DEFAULT 0,
  label         TEXT,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER
);
CREATE INDEX IF NOT EXISTS passkeys_player ON passkeys (player_id);

CREATE TABLE IF NOT EXISTS passkey_challenges (
  challenge   TEXT PRIMARY KEY,
  player_id   INTEGER,
  kind        TEXT NOT NULL,            -- register | login
  expires_at  INTEGER NOT NULL
);

-- slows down guessing save codes
CREATE TABLE IF NOT EXISTS rate_limits (
  key           TEXT NOT NULL,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);
