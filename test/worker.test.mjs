// End-to-end tests of the Worker API, with Node's built-in SQLite standing in for D1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/worker.js";
import { verifyChain } from "../src/ledger.js";
import * as B from "../engine/baton.js";

function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const prep = (sql, args = []) => ({
    sql, args, bind: (...a) => prep(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
  });
  const batch = async (stmts) => {
    db.exec("BEGIN");
    try { const out = stmts.map((st) => ({ meta: { changes: db.prepare(st.sql).run(...st.args).changes } })); db.exec("COMMIT"); return out; }
    catch (e) { db.exec("ROLLBACK"); throw e; }
  };
  return { prepare: (sql) => prep(sql), batch, raw: db };
}

const LAUNCH = "2026-01-01T18:00:00Z";
const L = Date.parse(LAUNCH);
let t = L;
function makeEnv(extra = {}) {
  t = L;
  return { DB: fakeD1(), LAUNCH_START: LAUNCH, BOTS: "0", clock: () => t, WEATHER: async () => "rain", ...extra };
}
const at = (hours) => { t = L + hours * B.HOUR; };

function browser(env) {
  let cookie = "";
  return async (path, body) => {
    const res = await worker.fetch(new Request("https://baton.example" + path, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }), env);
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: res.status, data: await res.json() };
  };
}

test("a player picks a band, waits for dawn, stamps once, and can't stamp twice", async () => {
  const env = makeEnv(); const me = browser(env);
  at(1);
  assert.equal((await me("/api/stamp", { color: 1 })).status, 400);        // no band yet
  const b = await me("/api/band", { offset: 0 });
  assert.equal(b.data.band.index, 12);
  assert.equal((await me("/api/stamp", { color: 1 })).status, 409);        // window opens at +12h
  at(12.5);
  const d = (await me("/api/today")).data;
  assert.equal(d.window.open, true);
  assert.equal(d.sky, "rain");
  assert.equal(d.prev, null);
  const ok = await me("/api/stamp", { color: 9, note: "tension" });
  assert.equal(ok.status, 200);
  assert.equal((await me("/api/stamp", { color: 2 })).status, 409);
  assert.equal((await me("/api/today")).data.stamped, true);
});

test("bad stamps are refused and blank stamps are fine", async () => {
  const env = makeEnv(); const me = browser(env);
  await me("/api/band", { offset: 0 }); at(12.5);
  assert.equal((await me("/api/stamp", { color: 99 })).status, 400);
  assert.equal((await me("/api/stamp", {})).status, 200);
});

test("the next band sees only the line before, and nobody else sees contents until the lap closes", async () => {
  const env = makeEnv(); const east = browser(env), west = browser(env), nosy = browser(env);
  await east.call(null, "/api/band", { offset: 3 });       // index 9
  await west.call(null, "/api/band", { offset: 2 });       // index 10
  await nosy.call(null, "/api/band", { offset: -5 });
  at(9.5); await east("/api/stamp", { color: 4, note: "resolve" });
  at(10.5);
  const w = (await west("/api/today")).data;
  assert.deepEqual(w.prev, { color: 4, note: "resolve", phrase: null, feeling: null, gesture: null, signoff: null, sky: "rain" });   // what they left, not who or when
  // a player outside their window sees nothing of it, and the ledger hides contents of an open lap
  const n = (await nosy("/api/today")).data;
  assert.equal(n.prev, null);
  const led = (await nosy("/api/ledger")).data.entries;
  const st = led.find((e) => e.kind === "stamp");
  assert.ok(st && !("record" in st));
  assert.equal((await nosy("/api/lap?n=1")).status, 404);
});

test("unheld bands seal as gaps, and the closed lap reads back with your stamp marked", async () => {
  const env = makeEnv(); const me = browser(env);
  await me("/api/band", { offset: 0 }); at(12.5);
  await me("/api/stamp", { color: 9, note: "tension" });
  at(26);
  const lap = (await me("/api/lap")).data;
  assert.equal(lap.lap, 1);
  assert.equal(lap.held, 1);
  assert.equal(lap.unheld, 23);
  assert.equal(lap.yours.band, 12);
  assert.equal(lap.yours.color, 9);
  assert.equal(lap.gradient[12], 9);
  assert.equal(lap.tally.tension, 1);
  assert.equal(lap.sky.rain, 1);
  const led = (await me("/api/ledger?limit=200")).data.entries;
  assert.ok(led.filter((e) => e.lap <= 1).every((e) => "record" in e));
});

test("with bots on, empty bands get a bot's stamp, the same one every time", async () => {
  const env = makeEnv({ BOTS: "1", BOT_SECRET: "x" }); const me = browser(env);
  at(26);
  const a = (await me("/api/lap")).data;
  assert.equal(a.bots, 24);
  assert.equal(a.unheld, 0);
  const again = (await me("/api/lap")).data;
  assert.deepEqual(a.gradient, again.gradient);
  assert.deepEqual(a.tune, again.tune);
});

test("the planet shows what's waiting, open, stamped, or unheld, without contents", async () => {
  const env = makeEnv(); const me = browser(env);
  await me("/api/band", { offset: 0 }); at(12.5);
  await me("/api/stamp", { color: 5 });
  at(15);
  const p = (await me("/api/planet")).data;
  assert.equal(p.bands[12].status, "stamped");
  assert.equal(p.bands[12].mine, true);
  assert.equal(p.bands[11].status, "unheld");
  assert.equal(p.bands[17].status, "waiting");
  assert.ok(!("color" in p.bands[12]));
});

test("the whole ledger is one unbroken chain", async () => {
  const env = makeEnv({ BOTS: "1" }); const a = browser(env), b = browser(env);
  await a("/api/band", { offset: 0 }); await b("/api/band", { offset: 1 });
  at(11.5); await b("/api/stamp", { color: 2, note: "resolve" });
  at(12.5); await a("/api/stamp", { color: 7 });
  at(60);
  await a("/api/today");
  const rows = env.DB.raw.prepare("SELECT * FROM ledger ORDER BY id").all();
  assert.ok(rows.length > 40);
  assert.deepEqual(await verifyChain(rows), { ok: true });
  rows[5].record = rows[5].record.replace("lap", "lop");
  assert.equal((await verifyChain(rows)).ok, false);
});

// ---------- save codes ----------

test("a save code brings your player (and band) to another browser", async () => {
  const env = makeEnv(); const phone = browser(env), laptop = browser(env);
  await phone("/api/band", { offset: 0 });
  const { data: { code } } = await phone("/api/codes", { action: "new" });
  assert.match(code, /^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){4}$/);
  assert.equal((await laptop("/api/today")).data.band, null);
  assert.equal((await laptop("/api/load", { code: code.toLowerCase().replace(/-/g, " ") })).status, 200);
  assert.equal((await laptop("/api/today")).data.band.index, 12);
  at(12.5);
  await laptop("/api/stamp", { color: 3 });
  assert.equal((await phone("/api/stamp", { color: 4 })).status, 409);   // same player: one stamp per lap
  const acct = (await phone("/api/account")).data;
  assert.equal(acct.devices, 2);
  assert.equal(acct.codes.length, 1);
  assert.ok(!JSON.stringify(acct).includes(code));
});

test("wrong codes are refused and guessing is rate limited", async () => {
  const env = makeEnv(); const b = browser(env);
  for (let i = 0; i < 10; i++) assert.equal((await b("/api/load", { code: "AAAA-AAAA-AAAA-AAAA-AAAA" })).status, 404);
  assert.equal((await b("/api/load", { code: "AAAA-AAAA-AAAA-AAAA-AAAA" })).status, 429);
});

test("up to five codes, removing one, and logging out needs a way back in", async () => {
  const env = makeEnv(); const b = browser(env);
  await b("/api/band", { offset: 3 });
  assert.equal((await b("/api/logout", {})).status, 400);                 // no way back in yet
  const ids = [];
  for (let i = 0; i < 5; i++) await b("/api/codes", { action: "new" });
  assert.equal((await b("/api/codes", { action: "new" })).status, 400);
  const list = (await b("/api/account")).data.codes;
  assert.equal(list.length, 5);
  assert.equal((await b("/api/codes", { action: "remove", id: list[0].id })).status, 200);
  assert.equal((await b("/api/codes", { action: "remove", id: list[0].id })).status, 404);
  assert.equal((await b("/api/logout", {})).status, 200);
  assert.equal((await b("/api/today")).data.band, null);                  // this browser forgot its player
});

test("a stranger can't remove someone else's code or passkey", async () => {
  const env = makeEnv(); const a = browser(env), s = browser(env);
  await a("/api/band", { offset: 1 }); await s("/api/band", { offset: 2 });
  await a("/api/codes", { action: "new" });
  const id = (await a("/api/account")).data.codes[0].id;
  assert.equal((await s("/api/codes", { action: "remove", id })).status, 404);
  assert.equal((await s("/api/passkey", { action: "remove", id: 1 })).status, 404);
});

test("passkey options come back with a challenge, for adding and for logging in", async () => {
  const env = makeEnv(); const b = browser(env);
  const reg = (await b("/api/passkey", { action: "register_options" })).data;
  assert.ok(reg.challenge && reg.rp.id === "baton.example" && reg.rp.name === "Dawn Baton");
  const login = (await b("/api/passkey", { action: "login_options" })).data;
  assert.ok(login.challenge);
  assert.equal((await b("/api/passkey", { action: "login", credential: { id: "nope", response: {} } })).status, 400);
});

test("the workers.dev address redirects to the canonical domain", async () => {
  const env = makeEnv({ CANONICAL_HOST: "dawn.example.app" });
  const res = await worker.fetch(new Request("https://dawn-baton.me.workers.dev/api/today?x=1"), env);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), "https://dawn.example.app/api/today?x=1");
  const ok = await worker.fetch(new Request("https://dawn.example.app/api/today"), env);
  assert.equal(ok.status, 200);
});

// ---------- stamp slots, sun, admin ----------

test("a stamp holds a phrase, feeling, gesture and sign-off, and the next band reads them back", async () => {
  const env = makeEnv(); const east = browser(env), west = browser(env);
  await east("/api/band", { offset: 3 }); await west("/api/band", { offset: 2 });
  at(9.5);
  assert.equal((await east("/api/stamp", { color: 4, note: "resolve", phrase: 3, feeling: 1, gesture: 6, signoff: 2 })).status, 200);
  at(10.5);
  const prev = (await west("/api/today")).data.prev;
  assert.deepEqual(prev, { color: 4, note: "resolve", phrase: 3, feeling: 1, gesture: 6, signoff: 2, sky: "rain" });
  const raw = JSON.stringify((await west("/api/today")).data);
  assert.ok(!/"band":9|"hash"|"player"|"t":/.test(raw.slice(raw.indexOf('"prev"'), raw.indexOf('"prev"') + 200)));   // not who, not when
  at(30);
  const lap = (await west("/api/lap")).data;
  assert.equal(lap.stamps.find((s) => s.band === 9).signoff, 2);            
});

test("slot indexes outside the lists are refused", async () => {
  const env = makeEnv(); const me = browser(env);
  await me("/api/band", { offset: 0 }); at(12.5);
  for (const bad of [{ phrase: 999 }, { feeling: -1 }, { gesture: "waves" }, { signoff: 1.5 }]) assert.equal((await me("/api/stamp", bad)).status, 400);
  assert.equal((await me("/api/stamp", { phrase: null, feeling: 0 })).status, 200);
});

test("today carries the word lists, and the sun line when the place is known", async () => {
  const env = makeEnv({ GEO: { latitude: 21.3, longitude: -157.9 } }); const me = browser(env);
  at(12.5);
  const d = (await me("/api/today")).data;
  assert.ok(d.lists.phrase.length > 10 && d.lists.signoff.length > 5);
  assert.ok(d.sun.rise < d.sun.set && d.sun.length > 10 * 3600000);
  assert.equal(typeof d.sun.delta, "number");
  const none = (await browser(makeEnv())("/api/today")).data;
  assert.equal(none.sun, null);
});

test("only an admin player is marked admin", async () => {
  const env = makeEnv(); const me = browser(env), other = browser(env);
  await me("/api/band", { offset: 0 }); await other("/api/band", { offset: 1 });
  assert.equal((await me("/api/account")).data.admin, false);
  env.DB.raw.prepare("UPDATE players SET admin = 1 WHERE id = 1").run();
  assert.equal((await me("/api/account")).data.admin, true);
  assert.equal((await other("/api/account")).data.admin, false);
});

// ---------- names ----------

test("a player picks two words, and the account says who they are", async () => {
  const env = makeEnv(); const me = browser(env);
  assert.equal((await me("/api/account")).data.name, null);
  const r = await me("/api/name", { a: "adj:0", b: "noun:0" });
  assert.equal(r.status, 200);
  assert.equal(r.data.name.text, "Quiet Heron");
  assert.ok(r.data.names.adj.length >= 40 && r.data.names.noun.length >= 40);
  assert.equal((await me("/api/name", { a: "adj:3", b: "noun:9" })).data.name.text, "Gentle Fern");
});

test("only one adjective and one noun from the lists are accepted", async () => {
  const env = makeEnv(); const me = browser(env);
  for (const bad of [{ a: "noun:0", b: "adj:0" }, { a: "adj:999", b: "noun:0" }, { a: "adj:0", b: "noun:0; DROP" }, { a: "Quiet", b: "Heron" }, { a: "adj:0" }, { a: "codex:sun", b: "noun:1" }])
    assert.equal((await me("/api/name", bad)).status, 400, JSON.stringify(bad));
});

test("a taken name is refused with a free one to try, never numbered", async () => {
  const env = makeEnv(); const a = browser(env), b = browser(env);
  assert.equal((await a("/api/name", { a: "adj:0", b: "noun:0" })).data.name.text, "Quiet Heron");
  const clash = await b("/api/name", { a: "adj:0", b: "noun:0" });
  assert.equal(clash.status, 409);
  assert.ok(clash.data.suggestion && !(clash.data.suggestion.a === "adj:0" && clash.data.suggestion.b === "noun:0"));
  assert.equal((await b("/api/account")).data.name, null);                          // nothing was saved
  const ok = await b("/api/name", clash.data.suggestion);
  assert.equal(ok.status, 200);
  assert.ok(!/\d/.test(ok.data.name.text));
  assert.equal((await a("/api/name", { a: "adj:0", b: "noun:0" })).status, 200);    // re-saving your own pair is fine
  await a("/api/name", { a: "adj:1", b: "noun:1" });                                // leaving a pair frees it
  assert.equal((await browser(env)("/api/name", { a: "adj:0", b: "noun:0" })).data.name.text, "Quiet Heron");
});

test("names show on a finished lap's stamps unless the player turns signing off; the ledger never holds a name", async () => {
  const env = makeEnv(); const a = browser(env), b = browser(env);
  await a("/api/band", { offset: 0 }); await b("/api/band", { offset: 1 });
  await a("/api/name", { a: "adj:7", b: "noun:7" });
  await b("/api/name", { a: "adj:2", b: "noun:2", signs: false });
  at(11.5); await b("/api/stamp", { color: 1 });
  at(12.5); await a("/api/stamp", { color: 2 });
  at(30);
  const lap = (await a("/api/lap")).data;
  assert.equal(lap.stamps.find((s) => s.band === 12).name, "Misty Wren");
  assert.equal(lap.stamps.find((s) => s.band === 11).name, null);             // signing off
  assert.equal(lap.stamps.find((s) => s.band === 5).name, null);              // nobody held it
  const rows = env.DB.raw.prepare("SELECT record FROM ledger").all().map((r) => r.record).join("");
  assert.ok(!/Misty|Wren|adj:|noun:/.test(rows));
  // turning signing back on is picked up the next time the lap is read
  await b("/api/name", { signs: true });
  assert.equal((await a("/api/lap")).data.stamps.find((s) => s.band === 11).name, "Early Sparrow");
});

// ---------- version ----------

test("today reports the version, and CHANGELOG.md's newest entry is that version", async () => {
  const { VERSION } = await import("../engine/version.js");
  const d = (await browser(makeEnv())("/api/today")).data;
  assert.equal(d.version, VERSION);
  const log = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  assert.equal(/^## v(\S+)/m.exec(log)[1], VERSION);
});

// ---------- strand details ----------

test("a closed lap's stamps carry their exact time and when their window opened", async () => {
  const env = makeEnv({ BOTS: "1" }); const me = browser(env);
  await me("/api/band", { offset: 0 }); at(12.5);
  t += 17 * 1000 + 300;                                                   // 12h30m17.3s into the lap
  await me("/api/stamp", { color: 2 });
  at(40);
  const lap = (await me("/api/lap")).data;
  const mine = lap.stamps.find((s) => s.mine);
  assert.equal(mine.t, Math.floor((L + 12.5 * B.HOUR + 17300) / 1000));
  assert.equal(mine.opensAt, L + 12 * B.HOUR);
  const bot = lap.stamps.find((s) => s.bot && s.band === 3);
  assert.equal(bot.t, Math.floor((L + 3 * B.HOUR + B.WINDOW_H * B.HOUR) / 1000));   // sealed when its window closed
});

test("earlier laps can be read, and the lap says where the first and last are", async () => {
  const env = makeEnv(); const me = browser(env);
  await me("/api/band", { offset: 0 });
  at(12.5); await me("/api/stamp", { color: 1 });
  at(36.5); await me("/api/stamp", { color: 5 });                           // lap 2's window for this band
  at(24 * 3 + 6);
  const one = (await me("/api/lap?n=1")).data, two = (await me("/api/lap?n=2")).data;
  assert.deepEqual([one.lap, one.first, one.last], [1, 1, 3]);
  assert.equal(one.yours.color, 1);
  assert.equal(two.yours.color, 5);
  assert.equal((await me("/api/lap?n=0")).status, 404);
  assert.equal((await me("/api/lap?n=4")).status, 404);
});

test("a closed lap tells a player who missed it when their band is next up", async () => {
  const env = makeEnv(); const me = browser(env), stranger = browser(env);
  await me("/api/band", { offset: 0 });                                     // band 12: window 12h-14h into each lap
  at(26);
  let lap = (await me("/api/lap")).data;
  assert.equal(lap.yours, null);
  assert.deepEqual([lap.next.open, lap.next.opensAt], [false, L + 36 * B.HOUR]);
  at(37);                                                                    // their next window is open now
  lap = (await me("/api/lap")).data;
  assert.deepEqual([lap.next.open, lap.next.closesAt], [true, L + 38 * B.HOUR]);
  await me("/api/stamp", { color: 1 });                                      // after stamping, "next" moves on to the next lap
  lap = (await me("/api/lap")).data;
  assert.deepEqual([lap.next.open, lap.next.opensAt], [false, L + 60 * B.HOUR]);
  assert.equal((await stranger("/api/lap")).data.next, null);                // no player, no band: nothing to say
});

// ---------- gaps tinted by the weather in the band ----------

test("a cell with no color is tinted by the stamper's sky, or by looked-up weather for the band, which is kept", async () => {
  let lookups = 0;
  const env = makeEnv({ BAND_WEATHER: async (wanted) => { lookups++; return Object.fromEntries(wanted.map((w) => [w.band, w.band % 2 ? "snow" : "fog"])); } });
  const me = browser(env);
  await me("/api/band", { offset: 0 }); at(12.5);
  await me("/api/stamp", { note: "resolve" });                              // stamped, but no color: its own sky is rain
  at(40);
  const lap = (await me("/api/lap")).data;
  assert.equal(lap.stamps.find((s) => s.band === 12).fillSky, "rain");     // the player's own sky
  assert.equal(lap.stamps.find((s) => s.band === 3).fillSky, "snow");      // nobody held it: weather for that band
  assert.equal(lap.stamps.find((s) => s.band === 4).fillSky, "fog");
  assert.equal(lookups, 1);
  await me("/api/lap");
  assert.equal(lookups, 1, "kept after the first look-up, not asked again");
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM band_sky").get().n, 23);
  assert.ok(!env.DB.raw.prepare("SELECT record FROM ledger").all().some((r) => /snow|fog/.test(r.record)));
});

test("a failed weather look-up leaves the cell untinted and is tried again next time", async () => {
  let ok = false, calls = 0;
  const env = makeEnv({ BAND_WEATHER: async (wanted) => { calls++; return ok ? Object.fromEntries(wanted.map((w) => [w.band, "clear"])) : {}; } });
  const me = browser(env); at(40);
  assert.equal((await me("/api/lap")).data.stamps.find((s) => s.band === 5).fillSky, null);
  ok = true;
  assert.equal((await me("/api/lap")).data.stamps.find((s) => s.band === 5).fillSky, "clear");
  assert.equal(calls, 2);
});

test("the stand-in cities fall inside their own bands", async () => {
  const { BAND_CITIES, bandFromLon } = await import("../engine/baton.js");
  assert.equal(BAND_CITIES.length, 24);
  BAND_CITIES.forEach(([name, , lon], i) => assert.equal(bandFromLon(lon), i, name));
});

// ---------- the last three notes ----------

test("the band after hears the last three notes before it, oldest first, silences included", async () => {
  const env = makeEnv(); const people = [];
  for (const off of [5, 4, 3, 2, 1]) { const b = browser(env); await b("/api/band", { offset: off }); people.push(b); }   // bands 7, 8, 9, 10, 11
  const notes = ["resolve", "tension", null, "resolve"];
  for (let i = 0; i < 4; i++) { at(7 + i + 0.5); await people[i]("/api/stamp", { note: notes[i] }); }
  at(11.5);
  const d = (await people[4]("/api/today")).data;
  assert.deepEqual(d.heard, ["tension", null, "resolve"]);                     // bands 8, 9, 10: only the last three
  assert.equal(d.prev.note, "resolve");                                     // band 10's note
  const first = browser(env); await first("/api/band", { offset: 12 }); at(0.5);
  assert.deepEqual((await first("/api/today")).data.heard, []);                 // nothing before the first band
});
