# dawn-baton: working notes

## This repo

Dawn Baton: a daily check-in game about connecting with people through the Sun's real position. A baton follows the sunrise west around the planet, one lap every 24 hours. Players pick one of 24 bands, add a little something when it reaches them and pass it on. It has an hourly hash-chained ledger and a daily checkpoint written to the public cross-game registry. Live at dawn.88x31.app. The live site redeploys from `main`, so a push is a release.

**Layout.** `engine/` (rules and `version.js`), `src/` (the Worker), `public/` (the page), `migrations/` and `schema.sql` (the D1 database `baton-db`), `test/`, `docs/`, `wrangler.jsonc`, `CHANGELOG.md`.

**Privacy.** The privacy rules are in the private dungeon-notes repo (`dawn-baton/privacy-rules.md`), written from what the code stores and shows. Update that file when a feature changes what is stored or shown.

**Testing.** `npm test` must pass before pushing.

**When kura says to push a batch**
- Bump `VERSION` in `engine/version.js`.
- Put a new entry at the top of `CHANGELOG.md`: plain, public, same style as the older entries. A test checks the newest heading matches `VERSION`.
- Add a detailed entry to the dev changelog `dawn-baton/changelog-v0.1.md` in the private dungeon-notes repo (decisions, then what changed in detail, migrations, test count), and push both repos.
- A database change needs a migration file in `migrations/`, `schema.sql` updated, and the live `baton-db` migrated *before* the push that needs it.
