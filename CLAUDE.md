# Working notes for Dawn Baton

- **Push only when the user says to.** Build and commit locally as asked; the live site redeploys from `main`, so a push is a release.
- **When pushing a batch:** bump `VERSION` in `engine/version.js`, put a new entry at the top of `CHANGELOG.md` (plain, public, same style as the older entries; a test checks the newest heading matches `VERSION`), add a detailed entry to the dev changelog `dawn-baton/changelog-v0.1.md` in the private dungeon-notes repo (decisions, then what changed in detail, migrations, test count), and push both repos. Times in both are Hawaii time (HST).
- A database change needs a migration file in `migrations/`, `schema.sql` updated, and the live `baton-db` migrated *before* the push that needs it.
- `npm test` must pass before pushing.

## Working rules

The same twelve rules are in every Dungeons repo and in the project instructions. "ryan" is the owner.

**Answering questions**
1. Search before saying "no". For "does X exist" or "did we do X", search the project chat, all repos and the live state. Treat ryan's memory as true until a search disproves it.
2. Say what was and wasn't searched, and mark each claim as checked (with where) or guessed. If it isn't found, say "I couldn't find it", never "that isn't true".
3. Give honest answers on design, even "this isn't worth building". One recommendation, with "do nothing" as the alternative.

**Before proposing anything**
4. Name the goal it serves (4Dungeon: section 15 of the design doc). If none, don't propose it.
5. Say what it adds, takes away and touches, what it replaces or lets us delete, what already exists, and how it would most likely fail.
6. Propose the smallest version first.

**While building**
7. Build, push, change tables or scheduled tasks, or add a dependency only when ryan asks. Don't touch anything he didn't ask for, and list extras for approval.
8. Delete, don't park: no new flags or "off for now" code. Fix a shared problem once, in the shared place.
9. Say what ran and what didn't. Never "should work" without running it.
10. Each changelog line says what was removed as well as what was added.

**Working with ryan**
11. Silence means "not now": no nagging about unanswered questions, and raise each item at most once.
12. Disagree before building, not after. A bare "ok" to a long answer is not approval of everything in it.
