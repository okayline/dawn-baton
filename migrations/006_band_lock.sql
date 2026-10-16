-- when a player last set their band (seconds), so a band can only be changed once a week (with a 1 hour grace after
-- the first pick for fixing a mistake). NULL for players from before this; they get one free change. Additive.
--   npx wrangler d1 execute baton-db --remote --file=migrations/006_band_lock.sql
ALTER TABLE players ADD COLUMN band_set_at INTEGER;
