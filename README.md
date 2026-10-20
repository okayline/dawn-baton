# Dawn Baton


A daily, asynchronous, persistent, cooperative, collaborative, real-world-clock-driven, server-authoritative, shared-world, planetary, time-gated, relay-style, check-in passing game with an hourly hash-chained ledger and a daily checkpoint written to a public cross-game registry.


A daily check-in game about connecting with people through the Sun's real position.

Every morning, a baton follows the sunrise around the planet. When it reaches your part of the world, you add a little something and pass it on to the next person, one band to the west.

## How it works

**The baton.** The sun rises somewhere on Earth every hour. The baton rides that sunrise line west, once around the planet, every 24 hours. One trip around is called a lap.

**Your band.** Earth is split into 24 bands, each one hour of sunrise wide (15 degrees of longitude). You pick yours in the Account tab. Bands follow the sun, not clock time zones, so yours stays the same all year.

**Your dawn.** The baton reaches your band at your sunrise, and your window stays open for 2 hours. The "Your dawn" panel on the Catch tab shows a countdown, your band and local time, today's sunrise, sunset and day length, and how many laps in a row you've caught.

**Catching it.** In your window, the Catch tab shows what the person before you sent. Then you add your own, and every part is optional:

- a color for your morning
- Settle or Lean for the tune (skip both and it's a rest)
- a reply, a vibe, what you're doing, and what you're bringing today

Then pass it on. You can pass the baton once per lap.

**The tune.** Each lap builds a 24-note tune from the Settle and Lean choices. You hear the last few notes before yours, and the notes you can pick change every day.

**Yesterday.** Once the baton has gone all the way around, the whole lap opens up: a gradient of everyone's colors, the tune, and the strand of words, with your own stamp marked. Tap a band or a stamp and the globe turns to it.

**The baton you keep.** When a lap closes, one of the people who passed the baton that lap gets it: a numbered copy of The Dawn Baton in the item registry shared by the 88x31.app games. Yesterday tells you if it was you.

**Empty bands.** If nobody is in a band, it stays dark. The gap is part of the record.

**Privacy.** Stamps are only picked from lists, so there's no free text. What you sent stays hidden until the lap is over. Your name, if you set one, is two friendly words, and you can hide it from your stamps.

## The screens

- **Catch:** your dawn, the globe and the stamp.
- **Yesterday:** the finished lap.
- **Planet:** the whole world right now.
- **Account:** your band, your name, and the ways to get back into your game from another device.
- **How to Play:** a short version of this page, linked at the bottom of every screen.

## The globe

Gold is the baton, white is you, and the ☀️ is where the sun is straight overhead right now. The baton follows sunrise, so it always trails the ☀️ by about six bands. The row of dots under the globe is the whole lap: tap one to turn the globe to that band, and tap the white one to come back home. On Catch you can also drag the globe sideways. It turns slowly by itself when you leave it alone.

## Getting back in

Your player is kept in this browser. In Account you can make a save code or add a passkey, and either one brings your band and stamps to another browser or device. They come from the accounts shared by all the 88x31.app games, so one passkey works on all of them.

---

# For developers

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
- The registry (`REGISTRY`, dungeon-items' `Registry` entrypoint): each closed lap that a person held makes one copy of The Dawn Baton (`batonCopy` in `src/worker.js`, `lap_copies` in `schema.sql`).
- Checkpoints (`ledgerCheckpoint` in `src/worker.js`): when a lap closes, the ledger up to its last band (entry count and that entry's fingerprint) goes into the shared registry with `REGISTRY.checkpoint`. The registry is timestamped on Bitcoin hourly by 88x31-anchors, which covers this ledger.
- `src/saves.js`: cookie tokens, extra-device sessions and rate limits. Save codes and passkeys come from the shared Accounts service (dungeon-items, bound as `ACCOUNTS`); old save codes move to the account the first time their player is seen.
- `public/index.html`: the screens (catch, yesterday, planet, account, how to play) and the globe.

## Not yet

The word codex, gated calendar words, the Dungeon connections.
