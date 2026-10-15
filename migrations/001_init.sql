-- Dawn Baton database (Cloudflare D1)
--   npx wrangler d1 execute baton-db --remote --file=schema.sql

-- A player is a browser cookie (only the token's SHA-256 is stored). `band` is the 0..23 baton index
-- of their coarse solar band, or NULL until set. No other location is kept.
CREATE TABLE IF NOT EXISTS players (
  id          INTEGER PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  band        INTEGER,
  created_at  INTEGER NOT NULL,
  seen_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL,          -- lap | stamp | gap
  lap         INTEGER NOT NULL,
  band        INTEGER,                -- 0..23, stamp and gap entries
  player_id   INTEGER,                -- stamp entries by a person (NULL for a bot's stamp)
  record      TEXT NOT NULL,          -- the sealed JSON record
  prev_hash   TEXT NOT NULL UNIQUE,   -- one entry per chain head: the chain can't fork
  hash        TEXT NOT NULL UNIQUE,   -- SHA-256(prev_hash + "|" + record)
  created_at  INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ledger_one_lap ON ledger (lap) WHERE kind = 'lap';
-- a band holds the baton once per lap: a stamp or a gap, never both, never twice
CREATE UNIQUE INDEX IF NOT EXISTS ledger_one_band ON ledger (lap, band) WHERE kind IN ('stamp', 'gap');
-- a player stamps once per lap
CREATE UNIQUE INDEX IF NOT EXISTS ledger_one_player ON ledger (lap, player_id) WHERE kind = 'stamp' AND player_id IS NOT NULL;
