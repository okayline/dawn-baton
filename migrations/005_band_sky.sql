-- the weather "somewhere in a band" for finished laps, used to colour gaps (never sealed in the ledger). Additive.
--   npx wrangler d1 execute baton-db --remote --file=migrations/005_band_sky.sql
CREATE TABLE IF NOT EXISTS band_sky (
  lap   INTEGER NOT NULL,
  band  INTEGER NOT NULL,
  sky   TEXT NOT NULL,
  PRIMARY KEY (lap, band)
);
