# Working notes for Dawn Baton

- **Push only when the user says to.** Build and commit locally as asked; the live site redeploys from `main`, so a push is a release.
- **When pushing a batch:** bump `VERSION` in `engine/version.js`, put a new entry at the top of `CHANGELOG.md` (plain, public, same style as the older entries; a test checks the newest heading matches `VERSION`), add a detailed entry to the dev changelog `dawn-baton/changelog-v0.1.md` in the private dungeon-notes repo (decisions, then what changed in detail, migrations, test count), and push both repos. Times in both are Hawaii time (HST).
- A database change needs a migration file in `migrations/`, `schema.sql` updated, and the live `baton-db` migrated *before* the push that needs it.
- `npm test` must pass before pushing.
