-- admin flag: lets a player open the preview of every screen (X key). Additive.
--   npx wrangler d1 execute baton-db --remote --file=migrations/003_admin.sql
-- Then make yourself admin (find your id from your passkey or save code):
--   npx wrangler d1 execute baton-db --remote --command="UPDATE players SET admin = 1 WHERE id = 1"
ALTER TABLE players ADD COLUMN admin INTEGER NOT NULL DEFAULT 0;
