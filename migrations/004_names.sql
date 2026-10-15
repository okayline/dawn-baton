-- player names: two words from lists. Additive.
--   npx wrangler d1 execute baton-db --remote --file=migrations/004_names.sql
ALTER TABLE players ADD COLUMN name_a TEXT;                       -- "adj:3"
ALTER TABLE players ADD COLUMN name_b TEXT;                       -- "noun:7"
ALTER TABLE players ADD COLUMN name_tag INTEGER NOT NULL DEFAULT 0;   -- unused (always 0); names are unique pairs
ALTER TABLE players ADD COLUMN signs INTEGER NOT NULL DEFAULT 1;      -- 1 = show my name on my stamps (once the lap is over)
CREATE UNIQUE INDEX IF NOT EXISTS players_name ON players (name_a, name_b, name_tag) WHERE name_a IS NOT NULL;
