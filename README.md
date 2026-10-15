# Dawn Baton

A daily check-in game synced to the real sun. 24 fixed solar bands, one baton that travels west around the planet once a day, one picked-from-lists stamp per player per lap, all sealed on a SHA-256 hash chain. Companion to Daily Digital Demon Dungeon. Design notes: [docs/dawn-baton-design.md](docs/dawn-baton-design.md).

## Run it

    npm test                      # engine + Worker tests (Node 22+, built-in SQLite)
    npx wrangler d1 create baton-db   # paste the id into wrangler.jsonc
    npx wrangler d1 execute baton-db --local --file=schema.sql
    # already have a database from before save codes? run migrations/002_saves.sql too
    npx wrangler dev

Set `LAUNCH_START` in `wrangler.jsonc` to when lap 1 begins (18:00 UTC, the date-line band's sunrise). `BOTS=1` fills bands nobody holds with a deterministic bot stamp; otherwise they seal as `gap` ("unheld").

## What's here

- `engine/baton.js`: bands, laps, windows, palette, stamp checks. Pure.
- `src/ledger.js`: the hash chain (kinds `lap`, `stamp`, `gap`), with the same chaining as the other games.
- `src/worker.js`: the API. Lazily seals laps and unheld bands on each request.
- `src/weather.js`: automatic sky via Open-Meteo, falls back to "unknown". Check its terms before earning money.
- `src/saves.js`, `src/passkeys.js`: save codes and passkeys, ported from scoundrel.exe (log in on any device).
- `public/index.html`: the screens (catch, yesterday, planet, account).

## Not yet

Preset sentence phrases, the word codex, sunrise/day-length line (from the Dungeon's `sky.js`), hourly OpenTimestamps anchoring, the Dungeon connections.
