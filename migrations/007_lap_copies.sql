-- The baton in the shared registry: each closed lap that a person held makes one numbered copy of "The Dawn Baton" (a relic
-- in dungeon-items `items-db`, key "baton") for one of that lap's human stampers. This row says which lap got which copy
-- and who holds it, so the Worker asks the registry once per lap. Never published: only the holder is told. Additive.
--   npx wrangler d1 execute baton-db --remote --file=migrations/007_lap_copies.sql
CREATE TABLE IF NOT EXISTS lap_copies (
  lap        INTEGER PRIMARY KEY,
  item_id    INTEGER NOT NULL,       -- the baton's id in items-db
  copy       INTEGER NOT NULL,       -- its copy number in the shared registry
  player_id  INTEGER NOT NULL,       -- who it went to
  made_at    INTEGER NOT NULL
);
