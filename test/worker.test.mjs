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


// A stand-in for the shared accounts (the Accounts entrypoint of dungeon-items, tested there): same answers, kept in maps.
// Codes are random; a "passkey" is any credential { id, account } that was registered. 10 wrong codes per address, then 429.
export function fakeAccounts() {
  let n = 0; const codes = new Map(), keys = new Map(), links = new Map(), tries = new Map(), imported = [];
  const acct = new Set(), err = (error, status = 400) => ({ error, status });
  const own = (id) => [...codes].filter(([, v]) => v.acct === id);
  return {
    imported, codes, links,
    async createAccount() { acct.add(++n); return { accountId: n }; },
    async addCode(id) {
      if (own(id).length >= 5) return err("You have 5 save codes already. Forget one first.");
      const A31 = "23456789ABCDEFGHJKMNPQRSTUVWXYZ", code = Array.from({ length: 5 }, () => Array.from({ length: 4 }, () => A31[Math.floor(Math.random() * 31)]).join("")).join("-");
      codes.set(code.replace(/-/g, ""), { acct: id, id: codes.size + 1 }); return { code };
    },
    async importCode(id, h) { imported.push([id, h]); return { ok: true }; },
    async removeCode(id, cid) { const e = [...codes].find(([, v]) => v.acct === id && v.id === cid); if (!e) return err("No such save code.", 404); codes.delete(e[0]); return { ok: true }; },
    async loginCode({ code, ip }) {
      const c = (tries.get(ip) || 0) + 1; tries.set(ip, c);
      if (c > 10) return err("Too many tries. Wait 15 minutes and try again.", 429);
      const v = codes.get(String(code).toUpperCase().replace(/[^A-Z0-9]/g, "")); return v ? { accountId: v.acct } : err("That save code didn't work. Check it and try again.", 404);
    },
    async info(id) { return { codes: own(id).map(([, v]) => ({ id: v.id, created_at: 1, last_used_at: null })), passkeys: [...keys].filter(([, v]) => v.acct === id).map(([k, v]) => ({ id: v.id, label: v.label })), games: [] }; },
    async waysIn(id) { return own(id).length + [...keys].filter(([, v]) => v.acct === id).length; },
    async playerFor(id, g) { return { playerId: links.get(id + "|" + g) ?? null }; },
    async link(id, g, p) {
      const taken = [...links].find(([k, v]) => k.endsWith("|" + g) && v === p);
      if (links.has(id + "|" + g)) return { playerId: links.get(id + "|" + g), linked: links.get(id + "|" + g) === p };
      if (taken) return { playerId: null, linked: false, taken: true };
      links.set(id + "|" + g, p); return { playerId: p, linked: true };
    },
    async accountOf(g, p) { const e = [...links].find(([k, v]) => k.endsWith("|" + g) && v === p); return { accountId: e ? Number(e[0].split("|")[0]) : null }; },
    async passkeyRegisterOptions({ accountId, origin }) { return { challenge: "c-" + accountId, origin }; },
    async passkeyRegister({ accountId, credential, label }) { keys.set(credential.id, { acct: accountId, id: keys.size + 1, label }); return { ok: true }; },
    async passkeyLoginOptions({ origin }) { return { challenge: "login", origin }; },
    async passkeyLogin({ credential }) { const k = keys.get(credential?.id); return k ? { accountId: k.acct } : err("That passkey isn't saved here.", 400); },
    async passkeyRemove(id, kid) { const e = [...keys].find(([, v]) => v.acct === id && v.id === kid); if (!e) return err("No such passkey.", 404); keys.delete(e[0]); return { ok: true }; },
  };
}
// A stand-in for the copy registry (the Registry entrypoint of dungeon-items, tested there): the baton is item 7, and a
// key always gives back the copy it made.
function fakeRegistry() {
  const births = [], byKey = new Map(), checkpoints = [];
  return {
    births, checkpoints,
    async checkpoint(a) { if (!checkpoints.some((c) => c.head === a.head)) checkpoints.push(a); return { ok: true, created: true }; },
    async itemIds(game, keys) { return game === "dawn-baton" && keys.includes("baton") ? { baton: 7 } : {}; },
    async birth(a) {
      if (byKey.has(a.key)) return { itemId: a.itemId, copy: byKey.get(a.key), created: false };
      births.push(a); byKey.set(a.key, births.length); return { itemId: a.itemId, copy: births.length, created: true };
    },
  };
}
const LAUNCH = "2026-01-01T18:00:00Z";
const L = Date.parse(LAUNCH);
let t = L;
function makeEnv(extra = {}) {
  t = L;
  return { DB: fakeD1(), ACCOUNTS: fakeAccounts(), REGISTRY: fakeRegistry(), LAUNCH_START: LAUNCH, BOTS: "0", clock: () => t, WEATHER: async () => "rain", ...extra };
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
  assert.deepEqual(w.prev, { color: 4, note: "resolve", phrase: null, feeling: null, gesture: null, signoff: null, sky: "rain", offset: 3, ago: "hours ago" });   // what they left, not who or when
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
  assert.equal((await b("/api/band", { offset: 3 })).status, 401);        // and can't make a new one until it logs in
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
  assert.ok(reg.challenge && reg.origin === "https://baton.example");   // the site rules (RP ID 88x31.app) belong to the Accounts service
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
  assert.deepEqual(prev, { color: 4, note: "resolve", phrase: 3, feeling: 1, gesture: 6, signoff: 2, sky: "rain", offset: 3, ago: "hours ago" });
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

test("a band can be fixed within the first hour, then is locked for a week", async () => {
  const env = makeEnv(); const me = browser(env);
  at(1); assert.equal((await me("/api/band", { offset: 3 })).status, 200);
  at(1.5); assert.equal((await me("/api/band", { offset: 4 })).status, 200);         // inside the grace hour: a free fix
  at(3); const locked = await me("/api/band", { offset: 5 });
  assert.equal(locked.status, 403);
  assert.equal((await me("/api/today")).data.band.offset, 4);
  const acc = (await me("/api/account")).data;
  assert.ok(acc.band.canChangeAt > t);                                              // the lock shows when it ends
  assert.equal((await me("/api/band", { offset: 4 })).status, 200);                  // the same band is never an error
  at(1 + 7 * 24 + 1); assert.equal((await me("/api/band", { offset: 5 })).status, 200);   // a week after the first pick
  at(1 + 7 * 24 + 5); assert.equal((await me("/api/band", { offset: 6 })).status, 403);   // and locked again
});

test("a first-time player is offered the band their rough location is in", async () => {
  const env = makeEnv({ GEO: { latitude: 19.7, longitude: -155.1 } }); const me = browser(env);   // Hilo
  assert.equal((await me("/api/today")).data.suggest, -10);
  await me("/api/band", { offset: -10 });
  assert.equal((await me("/api/today")).data.suggest, undefined);
});

test("the public ledger never shows who stamped, but you still find your own stamp and your name", async () => {
  const env = makeEnv(); const me = browser(env), other = browser(env);
  await me("/api/band", { offset: 0 }); await me("/api/name", { a: "adj:1", b: "noun:1", signs: true });
  await other("/api/band", { offset: 1 });
  at(12.5); await me("/api/stamp", { color: 9, note: "tension" });
  at(11.5); await other("/api/stamp", { color: 3 });
  at(26);
  const entries = (await other("/api/ledger?limit=200")).data.entries;
  const stamps = entries.filter((e) => e.kind === "stamp");
  assert.equal(stamps.length, 2);
  for (const e of entries) assert.ok(!("player" in JSON.parse(e.record || "{}")) && !("player_id" in e));   // nobody's id, public
  const lap = (await me("/api/lap")).data;
  assert.equal(lap.yours.band, 12);                                    // your own stamp is still found
  assert.ok(lap.stamps.some((s) => s.mine && s.name));                 // and so is your name, on your stamp
});

test("a save code from before accounts still works once, moves to the account, and the old rows go", async () => {
  const env = makeEnv(), a = browser(env);
  await a("/api/band", { offset: 0 });                                       // makes player 1
  const hash = "ab".repeat(32);
  env.DB.raw.prepare("INSERT INTO save_codes (player_id, code_hash, created_at) VALUES (1, ?, 1)").run(hash);
  await a("/api/account");                                                   // seeing the player moves the old code over
  assert.deepEqual(env.ACCOUNTS.imported, [[1, hash]]);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM save_codes").get().n, 0);
});

test("logging in reuses the account's player here, and a passkey adds to the account and logs a new browser in", async () => {
  const env = makeEnv(), a = browser(env);
  await a("/api/band", { offset: 0 });
  const { code } = (await a("/api/codes", { action: "new" })).data;          // player 1, account 1
  const other = browser(env);
  await other("/api/band", { offset: 0 });                                   // player 2, no account
  assert.equal((await other("/api/load", { code })).status, 200);            // account 1 already has player 1 here
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM players").get().n, 2);
  assert.equal(env.ACCOUNTS.links.get("1|dawn-baton"), 1);
  assert.equal((await a("/api/passkey", { action: "register", label: "k", credential: { id: "key1" } })).status, 200);
  const fresh = browser(env);
  assert.equal((await fresh("/api/passkey", { action: "login", credential: { id: "key1" } })).status, 200);
  assert.equal((await fresh("/api/account")).data.passkeys.length, 1);
  assert.equal((await browser({ ...env, ACCOUNTS: undefined })("/api/codes", { action: "new" })).status, 503);
});

test("a held lap makes one baton copy in the registry, for one of its stampers picked from the last band's hash", async () => {
  const env = makeEnv(); const a = browser(env), b = browser(env);
  await a("/api/band", { offset: 3 }); await b("/api/band", { offset: 0 });    // index 9, index 12
  at(9.5); await a("/api/stamp", { color: 1 });
  at(12.5); await b("/api/stamp", { color: 2 });
  at(24.5);                                                                   // lap 1 still open: no copy yet
  await a("/api/today");
  assert.equal(env.REGISTRY.births.length, 0);
  at(26);
  const la = (await a("/api/lap?n=1")).data, lb = (await b("/api/lap?n=1")).data;
  await a("/api/today");                                                      // asking again makes no second copy
  const raw = env.DB.raw;
  const people = raw.prepare("SELECT player_id FROM ledger WHERE lap = 1 AND kind = 'stamp' AND player_id IS NOT NULL ORDER BY band").all().map((r) => r.player_id);
  const end = raw.prepare("SELECT hash FROM ledger WHERE lap = 1 AND band = 23").get().hash;
  const holder = people[parseInt(end.slice(0, 8), 16) % people.length];
  assert.deepEqual(env.REGISTRY.births, [{ itemId: 7, game: "dawn-baton", playerId: holder, key: "lap:1" }]);
  const aId = raw.prepare("SELECT player_id FROM ledger WHERE lap = 1 AND band = 9").get().player_id;
  assert.deepEqual([la.baton, lb.baton], aId === holder ? [{ item: 7, copy: 1 }, null] : [null, { item: 7, copy: 1 }]);
  at(50);                                                                     // lap 2 had nobody: no copy
  await a("/api/today");
  assert.equal(env.REGISTRY.births.length, 1);
});

test("settle only goes to the database when a lap opens or a band's window closes", async () => {
  const env = makeEnv(); const log = [], real = env.DB;
  env.DB = { prepare: (sql) => { log.push(sql); return real.prepare(sql); }, batch: real.batch, raw: real.raw };
  const sweeps = () => log.filter((q) => q.startsWith("SELECT band FROM ledger WHERE lap = ?")).length;   // settle's look at which bands are sealed
  const me = browser(env);
  at(5); await me("/api/planet"); assert.equal(sweeps(), 1);
  at(5.5); await me("/api/planet"); assert.equal(sweeps(), 1);          // nothing closed in between: no trips
  at(7.5); await me("/api/planet"); assert.equal(sweeps(), 2);          // bands 0 to 5 closed in between: one more sweep
  await me("/api/planet"); assert.equal(sweeps(), 2);
});

test("when a lap closes, the ledger up to its last band is checkpointed in the shared registry, once", async () => {
  const env = makeEnv(); const me = browser(env);
  at(24.5); await me("/api/planet");
  assert.equal(env.REGISTRY.checkpoints.length, 0);                          // lap 1 still open
  at(26); await me("/api/planet"); await me("/api/planet");
  const rows = env.DB.raw.prepare("SELECT id, hash FROM ledger ORDER BY id").all();
  const end = env.DB.raw.prepare("SELECT id FROM ledger WHERE lap = 1 AND band = 23").get().id;
  const upTo = rows.filter((r) => r.id <= end);
  assert.deepEqual(env.REGISTRY.checkpoints, [{ game: "dawn-baton", entries: upTo.length, head: upTo[upTo.length - 1].hash,
    detail: { lap: 1, people: 0, unheld: 24, colors: Array(24).fill(null), tune: "-".repeat(24) } }]);
});

test("the lap's checkpoint detail: people, unheld (no bot count), the colours as hex and the tune", async () => {
  const env = makeEnv({ BOTS: "1" }); const me = browser(env);
  await me("/api/band", { offset: 0 }); at(12.5); await me("/api/stamp", { color: 0, note: "tension" });   // ember: hsl(8, 62%, 60%)
  at(26); await me("/api/planet");
  const d = env.REGISTRY.checkpoints[0].detail;
  assert.deepEqual([d.lap, d.people, d.unheld, "bots" in d], [1, 1, 0, false]);
  assert.equal(d.colors[12], "#d86b5a");     // hsl(8, 62%, 60%), worked out with Python colorsys
  assert.equal(d.tune[12], "l");
  assert.equal(d.tune.length, 24);
});
