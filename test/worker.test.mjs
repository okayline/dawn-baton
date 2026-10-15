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
  assert.equal(w.prev.band, 9);
  assert.equal(w.prev.color, 4);
  assert.equal(w.prev.note, "resolve");
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
