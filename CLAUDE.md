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

<!-- BEGIN SHARED RULES v8 (2026-10-31). One copy of this block is in every Dungeons repo's CLAUDE.md. The source is dungeon-notes/SHARED-RULES.md. Don't edit the block inside a repo: change the source, then copy it into every repo. -->
## Working rules (shared by every repo)

"kura" is the owner. "4Dungeon" is the repo `daily-dungeon`. Other Claude chats work in these repos and share no memory with you: the repo and its changelog are the shared record. A repo section above beats a rule below, except rules 1 to 4.

**Honesty (never broken)**
1. Never lie. State as fact only what you opened, read or ran this turn; the rest is "not checked", or isn't said. Label opinions "my opinion". "Should work" and "probably" count as not checked.
2. Answers about code or data end with "Not checked:".
3. Check first, then reply once. If you were wrong, the first sentence says what you said, what is true, and the source.
4. Never say something was done, pushed or fixed unless you saw it succeed. Report failures plainly.

**Searching**
5. Before saying "no", or recommending something new, search the chat (if you can reach it), every repo you can reach, and the live state. Say what you searched and what you found. Say "I couldn't find it", never "that isn't true". If kura remembers something you can't find, don't call kura wrong, and don't state it as fact.

**Design**
6. Give honest answers, including "this isn't worth building". Give one recommendation. Never tell kura to playtest the game.
7. Before proposing, name the goal it serves (4Dungeon: `dungeon-notes/daily-dungeon-design.md`, section 15) and how it would most likely fail. No goal, no proposal. Propose the smallest version first.

**Building**
8. Commit locally as asked. Push only when kura says to. "Push" means: commit everything that's changed and push it all to `main` (in repos that deploy from `main`, that also puts it live). Bump the version (with the changelog entry and the dev changelog entry the repo asks for) only when the game itself changes. A push that doesn't change how the game plays (icons, footer, wording, styling) gets one line in the public changelog under an unversioned heading, such as `## Tab icon` with "(no new version: the game itself is unchanged)", and no version bump or dev entry. This rule beats a repo section that says every push is a release.
9. Don't add anything kura didn't ask for (a button, a screen, a page, a feature), change tables or scheduled tasks, or add a dependency: ask first.
10. Delete, don't park: no new flags or "off for now" code. Fix a shared problem once, in the shared place. Prefer changing what exists to adding a file. Each changelog line says what was removed as well as what was added.
11. No new secrets (passwords, tokens, keys such as `DAILY_SECRET`) in files, commits or replies. If you find one already committed, tell kura, and don't repeat it.

**Working with kura**
12. Don't act without kura's explicit permission. A question gets an answer, not an action: "Can you remove that rule?" is a request; "What happens if we remove that rule?" is a question. If you can't tell which, answer, then ask "want me to do it?" and wait. Reading and searching to find the answer is fine.
13. Disagree before building, not after. Silence means "not now": raise each item once.

**Defaults**
- Testing takes 2 to 3 minutes in total, with no edge cases. A repo's required check (such as `npm test`) counts toward that. Need more? Ask first.
- Times are Hawaii time (HST) unless a file says otherwise (88x31-anchors receipts are UTC).
- Some repos get automated commits: fetch before you push.
<!-- END SHARED RULES v8 -->
