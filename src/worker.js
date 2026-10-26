// Dawn Baton Worker: the baton, cookie players, one stamp per player per lap, and the ledger.
//
// API (all JSON):
//   GET  /api/today          your band, your catch window, the line before yours (in your window), your sky
//   POST /api/band {offset}  set your band from your solar UTC offset (-11..+12); the browser sends its own
//   POST /api/stamp {color, note}   pass the baton: seal your stamp (blank slots are fine)
//   GET  /api/planet         the current lap: every band waiting / open / stamped / unheld (no contents)
//   GET  /api/lap?n=         a closed lap in full (default: the latest closed one), with your stamp marked, the lap's place in the ledger, and the lap's baton if it went to you
//   GET  /api/ledger?before=&limit=   newest first; contents of unfinished laps are hidden
//   GET  /api/account        your save codes and passkeys (never the codes themselves)
//   POST /api/codes {action: "new" | "remove", id}   make a save code (shown once) or forget one
//   POST /api/load {code}    become the player a save code belongs to on this device (log in)
//   POST /api/passkey {action: register_options | register | login_options | login | remove}
//   POST /api/name {a, b, signs}   pick your two-word name (ids like "adj:3", "noun:7") and whether stamps show it
//   POST /api/logout         this browser forgets its player (needs a save code or passkey first)

import * as B from "../engine/baton.js";
import { VERSION } from "../engine/version.js";
import { seal, lapRecord, stampRecord, gapRecord, sha256, verifyChain, GENESIS } from "./ledger.js";
import { skyFor, coarsePlace, bandSkies } from "./weather.js";
import { sunReport } from "../engine/sun.js";
import { hashCode, newSession, newToken, rateLimit } from "./saves.js";

const GAME = "dawn-baton";
const COOKIE = "bb";
const COOKIE_MAX_AGE = 400 * 86400;

class Oops extends Error { constructor(m, status = 400) { super(m); this.status = status; } }   // .extra: more fields for the reply

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
});

const ROUTES = {
  "GET /api/today": today, "POST /api/band": setBand, "POST /api/stamp": stamp,
  "GET /api/planet": planet, "GET /api/lap": lapView, "GET /api/ledger": ledger,
  "GET /api/copies": copies, "POST /api/pin": pinCopy,
  "GET /api/account": account, "POST /api/codes": codes, "POST /api/load": loadCode,
  "POST /api/passkey": passkey, "POST /api/name": setName, "POST /api/logout": logout,
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    // one home: the workers.dev address redirects to the real domain
    if (env.CANONICAL_HOST && url.hostname.endsWith(".workers.dev")) {
      return Response.redirect(`https://${env.CANONICAL_HOST}${url.pathname}${url.search}`, 301);
    }
    if (!url.pathname.startsWith("/api/")) return env.ASSETS ? env.ASSETS.fetch(req) : new Response("Not found", { status: 404 });
    try {
      const route = ROUTES[`${req.method} ${url.pathname}`];
      if (!route) return json({ error: "No such thing." }, 404);
      const ctx = { env, req, url, db: env.DB, t: clock(env), launch: Date.parse(env.LAUNCH_START), setCookie: null };
      if (!Number.isFinite(ctx.launch)) return json({ error: "The server has no LAUNCH_START set." }, 500);
      await settle(ctx);
      try { await batonCopy(ctx); } catch (e) { console.error(e); }   // the registry being away never stops the game
      try { await ledgerCheckpoint(ctx); } catch (e) { console.error(e); }
      const res = await route(ctx);
      return ctx.setCookie ? json(res.data ?? res, 200, { "set-cookie": ctx.setCookie }) : json(res.data ?? res);
    } catch (e) {
      if (e instanceof Oops) return json({ error: e.message, ...(e.extra || {}) }, e.status);
      console.error(e);
      return json({ error: "Something broke. Try again in a moment." }, 500);
    }
  },
};

const clock = (env) => (env.clock ? env.clock() : Date.now());
const sec = (ms) => Math.floor(ms / 1000);

// ---------- players ----------
// A player's first device uses players.token_hash; devices loaded later (save code or passkey) each get a
// row in sessions. Only hashes of tokens are stored.

const readCookie = (req) => { const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)bb=([A-Za-z0-9_-]{20,})/); return m ? m[1] : null; };
const cookieFor = (token) => `${COOKIE}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
const CLEAR_COOKIE = `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

// The player behind this request's cookie, or null. Never creates one (so crawlers don't make players).
async function player(ctx, create = false) {
  const { db } = ctx, token = readCookie(ctx.req), now = sec(ctx.t);
  if (token) {
    const h = await sha256(token);
    let p = await db.prepare("SELECT * FROM players WHERE token_hash = ?").bind(h).first();
    if (!p) {
      p = await db.prepare("SELECT p.* FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token_hash = ?").bind(h).first();
      if (p) await db.prepare("UPDATE sessions SET seen_at = ? WHERE token_hash = ?").bind(now, h).run();
    }
    if (p) { await db.prepare("UPDATE players SET seen_at = ? WHERE id = ?").bind(now, p.id).run(); return p; }
  }
  if (!create) return null;
  const fresh = newToken();
  const row = await db.prepare("INSERT INTO players (token_hash, created_at, seen_at) VALUES (?,?,?) RETURNING *").bind(await sha256(fresh), now, now).first();
  ctx.setCookie = cookieFor(fresh);
  return row;
}

// ---------- sealing what time itself decides ----------

// Lazily seal: laps opening, and every band whose window has ended with nobody holding it
// (a bot's stamp when BOTS=1, otherwise an "unheld" gap). Safe to run on every request.
// What settle() has already done in this Worker, per database: it only has work when a lap opens or a band's window closes,
// so a request in between skips its database trips. Sealing is safe to repeat, so a stale or missing memory only costs speed.
const settled = new WeakMap();
async function settle(ctx) {
  const { db, t, launch, env } = ctx;
  const cur = B.currentLap(launch, t);
  let closed = 0;
  for (let lap = Math.max(1, cur - 1); lap <= cur; lap++) for (let i = 0; i < B.BANDS; i++) if (t >= B.closesAt(launch, lap, i)) closed++;
  const key = cur + ":" + closed;
  if (settled.get(db) === key) return;
  for (let lap = Math.max(1, cur - 1); lap <= cur; lap++) {
    await seal(db, { kind: "lap", lap, record: lapRecord({ lap, startsAt: B.lapStart(launch, lap) }), t: sec(B.lapStart(launch, lap)) });
    const have = new Set((await db.prepare("SELECT band FROM ledger WHERE lap = ? AND kind IN ('stamp','gap')").bind(lap).all()).results.map((r) => r.band));
    for (let i = 0; i < B.BANDS; i++) {
      if (have.has(i) || t < B.closesAt(launch, lap, i)) continue;
      const when = sec(B.closesAt(launch, lap, i));
      if (env.BOTS === "1") {
        const b = await botStamp(env, lap, i);
        await seal(db, { kind: "stamp", lap, band: i, record: stampRecord({ lap, band: i, ...b, bot: true, t: when }), t: when });
      } else {
        await seal(db, { kind: "gap", lap, band: i, record: gapRecord({ lap, band: i, t: when }), t: when });
      }
    }
  }
  settled.set(db, key);
}

// ---------- the baton in the shared registry ----------

// Each closed lap that a person held makes one numbered copy of "The Dawn Baton" (a relic in dungeon-items, key "baton")
// for one of that lap's human stampers, picked from the hash of the lap's last band entry so anyone can check the pick.
// One lap per request, oldest first. The registry key lap:<n> means a retry never makes a second copy. A registry that's
// down, or doesn't have the baton yet, never stops the game: the next request tries again.
let batonItem = null;
const batonDone = new WeakMap();   // per database: the last closed lap that had no baton left to make (a closed lap never gains a stamper)
async function batonCopy(ctx) {
  const { db, env, launch, t } = ctx;
  const closedLap = B.lastClosedLap(launch, t);
  if (batonDone.get(db) === closedLap) return;
  const row = await db.prepare(
    `SELECT MIN(lap) AS lap FROM ledger WHERE kind = 'stamp' AND player_id IS NOT NULL AND lap <= ?
       AND lap IN (SELECT lap FROM ledger WHERE band = ? AND kind IN ('stamp','gap')) AND lap NOT IN (SELECT lap FROM lap_copies)`)
    .bind(closedLap, B.BANDS - 1).first();
  if (!row || row.lap == null) { batonDone.set(db, closedLap); return; }
  const lap = row.lap;
  const people = (await db.prepare("SELECT player_id FROM ledger WHERE lap = ? AND kind = 'stamp' AND player_id IS NOT NULL ORDER BY band").bind(lap).all()).results;
  const end = await db.prepare("SELECT hash FROM ledger WHERE lap = ? AND band = ? AND kind IN ('stamp','gap')").bind(lap, B.BANDS - 1).first();
  const holder = people[parseInt(end.hash.slice(0, 8), 16) % people.length].player_id;
  if (!batonItem) batonItem = (await env.REGISTRY.itemIds(GAME, ["baton"])).baton ?? null;
  if (!batonItem) return console.error("The shared registry has no Dawn Baton item yet.");
  // (v0.27) the copy the holder carried rides with the baton: marked before the baton is made, so it isn't the new baton itself
  await markCarry(env, holder, "rode_with_baton", "lap:" + lap);
  const r = await env.REGISTRY.birth({ itemId: batonItem, game: GAME, playerId: holder, key: "lap:" + lap });
  if (r.error) return console.error("The registry refused lap " + lap + "'s baton: " + r.error);
  // (v0.27) the relic carries its lap's dawn: the holder's band and their sky, as two deed marks (keys per lap, so a retry
  // makes no second ones). An unknown sky gets no sky mark.
  const mine = await db.prepare("SELECT band, record FROM ledger WHERE lap = ? AND kind = 'stamp' AND player_id = ?").bind(lap, holder).first();
  if (mine) {
    const sky = JSON.parse(mine.record).sky, copies = (k) => [{ itemId: batonItem, copy: r.copy, key: "lap:" + lap + ":" + k }];
    const marks = [{ kind: "deed", value: "dawn_band_" + mine.band, copies: copies("band") },
      ...(sky && sky !== "unknown" ? [{ kind: "deed", value: "dawn_sky_" + sky, copies: copies("sky") }] : [])];
    const m = await env.REGISTRY.addMarks({ holder: { game: GAME, playerId: holder }, marks });
    if (m && m.error) console.error("The registry refused lap " + lap + "'s baton marks: " + m.error);
  }
  await db.prepare("INSERT OR IGNORE INTO lap_copies (lap, item_id, copy, player_id, made_at) VALUES (?,?,?,?,?)").bind(lap, batonItem, r.copy, holder, sec(t)).run();
}

// Once a day, when a lap closes, the ledger up to that lap's last band goes into the shared registry as a checkpoint: its
// entry count and that entry's fingerprint, which covers every entry before it. The registry is timestamped on Bitcoin, so
// this ledger is too. The same lap always sends the same checkpoint, so a retry adds nothing there. Only a chain that
// checks out is sent.
// The finished lap in a few public facts for the registry's page (all of it shows on Yesterday already): how many people,
// bots and unheld bands, the 24 colours as hex (null = no colour), and the tune, one letter a band: s settle, l lean, - silent.
async function lapDetail(ctx, lap) {
  const items = await stampsOf(ctx, lap);
  const stamps = items.filter((r) => r.kind === "stamp");
  const hex = (i) => { const c = B.COLORS[i]; if (!c) return null; const [h, sa, l] = c.hsl, s1 = sa / 100, l1 = l / 100, a = s1 * Math.min(l1, 1 - l1);
    const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l1 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0"); };
    return "#" + f(0) + f(8) + f(4); };
  return { lap, people: stamps.filter((r) => !r.bot).length, unheld: items.length - stamps.length,
    colors: items.map((r) => (r.color == null ? null : hex(r.color))), tune: items.map((r) => (r.note === "resolve" ? "s" : r.note === "tension" ? "l" : "-")).join("") };
}
const checkpointed = new WeakMap();   // per database: the last lap whose checkpoint the registry took
async function ledgerCheckpoint(ctx) {
  const { db, env, launch, t } = ctx;
  const lap = B.lastClosedLap(launch, t);
  if (lap < 1 || checkpointed.get(db) === lap) return;
  const end = await db.prepare("SELECT id FROM ledger WHERE lap = ? AND band = ? AND kind IN ('stamp','gap')").bind(lap, B.BANDS - 1).first();
  if (!end) return;
  const rows = (await db.prepare("SELECT id, record, prev_hash, hash FROM ledger WHERE id <= ? ORDER BY id").bind(end.id).all()).results;
  const v = await verifyChain(rows);
  if (!v.ok) return console.error("The ledger is broken at entry " + v.at + ": no checkpoint sent.");
  const r = await env.REGISTRY.checkpoint({ game: GAME, entries: rows.length, head: rows[rows.length - 1].hash, detail: await lapDetail(ctx, lap) });
  if (r.error) return console.error("The registry refused lap " + lap + "'s checkpoint: " + r.error);
  checkpointed.set(db, lap);
}

// A bot's choices come from a hash of the lap and band: always the same, never random at read time.
async function botStamp(env, lap, band) {
  const h = await sha256(`${env.BOT_SECRET || "bot"}|${lap}|${band}`);
  const n = (k) => parseInt(h.slice(k * 4, k * 4 + 4), 16);
  return {
    color: n(0) % 12 === 11 && n(1) % 3 ? null : n(0) % B.COLORS.length,   // frost is a bot's "blank-ish" choice, kept rare
    note: n(2) % 9 === 0 ? null : B.NOTES[n(3) % 2],
    phrase: n(4) % 4 === 0 ? null : n(5) % B.PHRASES.length,
    feeling: n(6) % 3 === 0 ? null : n(7) % B.FEELINGS.length,
    gesture: n(8) % 3 === 0 ? null : n(9) % B.GESTURES.length,
    signoff: n(10) % 3 === 0 ? null : n(11) % B.SIGNOFFS.length,
    sky: "unknown", player: null,
  };
}

// ---------- reading stamps back ----------

const parse = (row) => ({ ...JSON.parse(row.record), player: row.player_id ?? null, id: row.id, hash: row.hash });   // who stamped comes from the private column, not the public record
const view = (r, mineId = null) => ({
  band: r.band, label: B.bandLabel(r.band), kind: r.kind, bot: !!r.bot,
  color: r.color ?? null, note: r.note ?? null, phrase: r.phrase ?? null, feeling: r.feeling ?? null,
  gesture: r.gesture ?? null, signoff: r.signoff ?? null, sky: r.sky ?? null, t: r.t ?? null, mine: mineId != null && r.player === mineId,
  hash: r.hash,
});

async function stampsOf(ctx, lap) {
  return (await ctx.db.prepare("SELECT * FROM ledger WHERE lap = ? AND kind IN ('stamp','gap') ORDER BY band").bind(lap).all()).results.map(parse);
}

// ---------- routes ----------

// Laps in a row this player has stamped, counting back from `last` (a lap number).
async function streakOf(ctx, playerId, last) {
  if (last < 1) return 0;
  const rows = (await ctx.db.prepare("SELECT DISTINCT lap FROM ledger WHERE player_id = ? AND kind = 'stamp' AND lap <= ? ORDER BY lap DESC").bind(playerId, last).all()).results;
  let n = 0; for (const r of rows) { if (r.lap !== last - n) break; n++; }
  return n;
}

async function today(ctx) {
  const me = await player(ctx);
  const { launch, t } = ctx;
  const place = coarsePlace(ctx.env, ctx.req);
  const out = { version: VERSION, now: t, launch, lap: B.currentLap(launch, t), band: null, window: null, stamped: false, prev: null, sky: null,
    palette: B.COLORS, notes: B.NOTES, lists: B.LISTS, sun: null, heard: [], lastClosedLap: B.lastClosedLap(launch, t) };
  if (place) out.sun = sunReport(place.lat, place.lon, t);
  if (!me || me.band == null) { if (place) out.suggest = B.offsetOf(B.bandFromLon(place.lon)); return out; }       // a first-time player is offered the band their rough location is in
  out.band = { index: me.band, offset: B.offsetOf(me.band), label: B.bandLabel(me.band) };
  const w = B.windowFor(launch, me.band, t);
  out.window = w;
  out.streak = await streakOf(ctx, me.id, w.open && (await ctx.db.prepare("SELECT 1 FROM ledger WHERE lap = ? AND player_id = ? AND kind = 'stamp'").bind(w.lap, me.id).first()) ? w.lap : w.lap - 1);
  if (w.open) {
    const mine = await ctx.db.prepare("SELECT 1 FROM ledger WHERE lap = ? AND player_id = ? AND kind = 'stamp'").bind(w.lap, me.id).first();
    out.stamped = !!mine;
    // the one line before yours: the nearest earlier band's stamp (skipping unheld bands)
    const before = (await stampsOf(ctx, w.lap)).filter((r) => r.kind === "stamp" && r.band < me.band).sort((a, b) => a.band - b.band);
    // what the last band left: the words, the colour, the sky and the notes. Who they were and exactly when stay hidden until the lap closes.
    if (before.length) {
      const last = before[before.length - 1];
      out.prev = { color: last.color ?? null, note: last.note ?? null, phrase: last.phrase ?? null, feeling: last.feeling ?? null,
        gesture: last.gesture ?? null, signoff: last.signoff ?? null, sky: last.sky ?? null,
        offset: B.offsetOf(last.band),                                  // just the band's number, no label
        ago: last.t == null ? null : (t - last.t < 15 * 60e3 ? "just now" : t - last.t < 3 * 3600e3 ? "a while ago" : "hours ago") };  // loose, never the exact time
    }
    out.heard = before.slice(-3).map((r) => r.note ?? null);       // the last three notes before you, oldest first (null = silence)
    if (!out.stamped) out.sky = await skyFor(ctx.env, ctx.req);
  }
  out.carry = carryView(await carried(ctx.env, me.id));   // (v0.27) the copy you carry: your account's pinned copy
  return out;
}

const BAND_LOCK = 7 * 86400, BAND_GRACE = 3600;     // seconds: a band changes once a week, with an hour to fix a first-pick mistake
// When this player may next change their band (ms), or null if they may now.
function bandChangeAt(me, t) {
  if (me.band == null || me.band_set_at == null) return null;
  const now = sec(t);
  if (now < me.band_set_at + BAND_GRACE || now >= me.band_set_at + BAND_LOCK) return null;
  return (me.band_set_at + BAND_LOCK) * 1000;
}

async function setBand(ctx) {
  const body = await ctx.req.json().catch(() => ({}));
  const idx = body.offset != null ? B.bandFromOffset(body.offset) : null;
  if (idx == null) throw new Oops("Pick a solar offset from -11 to +12.");
  const me = await player(ctx, true);
  const label = { band: { index: idx, offset: B.offsetOf(idx), label: B.bandLabel(idx) } };
  if (me.band === idx) return label;                                  // same band: nothing changes
  const at = bandChangeAt(me, ctx.t);
  if (at) throw new Oops(`You can change your band again in ${Math.ceil((at - ctx.t) / 86400000)} day(s).`, 403);
  const keep = me.band != null && me.band_set_at != null && sec(ctx.t) < me.band_set_at + BAND_GRACE;   // still fixing the first pick
  await ctx.db.prepare("UPDATE players SET band = ?, band_set_at = ?, seen_at = ? WHERE id = ?").bind(idx, keep ? me.band_set_at : sec(ctx.t), sec(ctx.t), me.id).run();
  return label;
}

async function stamp(ctx) {
  const me = await player(ctx);
  if (!me || me.band == null) throw new Oops("Pick your band first.");
  const body = await ctx.req.json().catch(() => ({}));
  const s = B.checkStamp(body);
  if (s.error) throw new Oops(s.error);
  const w = B.windowFor(ctx.launch, me.band, ctx.t);
  if (!w.open) throw new Oops("Your dawn window isn't open.", 409);
  const sky = await skyFor(ctx.env, ctx.req);
  const when = sec(ctx.t);
  const res = await seal(ctx.db, {
    kind: "stamp", lap: w.lap, band: me.band, playerId: me.id,
    record: stampRecord({ lap: w.lap, band: me.band, color: s.color, note: s.note, phrase: s.phrase, feeling: s.feeling, gesture: s.gesture, signoff: s.signoff, sky, bot: false, t: when }), t: when,
  });
  if (res === "duplicate") throw new Oops("You've already passed the baton this lap.", 409);
  return { ok: true, lap: w.lap, band: me.band, sealsAt: w.closesAt, message: "Passed. See the finished lap tomorrow morning." };
}

async function planet(ctx) {
  const me = await player(ctx);
  const { launch, t } = ctx;
  const lap = B.currentLap(launch, t);
  if (lap < 1) return { lap: 0, startsAt: launch, bands: [] };
  const rows = new Map((await stampsOf(ctx, lap)).map((r) => [r.band, r]));
  const bands = [];
  for (let i = 0; i < B.BANDS; i++) {
    const r = rows.get(i);
    const status = r ? (r.kind === "gap" ? "unheld" : r.bot ? "bot" : "stamped")
      : t >= B.opensAt(launch, lap, i) ? "open" : "waiting";
    bands.push({ band: i, label: B.bandLabel(i), status, mine: !!(me && me.band === i), opensAt: B.opensAt(launch, lap, i) });
  }
  return { lap, startsAt: B.lapStart(launch, lap), closesAt: B.lapClosesAt(launch, lap), bands };
}

async function lapView(ctx) {
  const me = await player(ctx);
  const { launch, t } = ctx;
  const last = B.lastClosedLap(launch, t);
  const n = ctx.url.searchParams.get("n") ? Number(ctx.url.searchParams.get("n")) : last;
  if (!Number.isInteger(n) || n < 1 || n > last) throw new Oops("That lap hasn't finished yet.", 404);
  const rows = await stampsOf(ctx, n);
  // t = when the stamp was sealed, in seconds (for a bot's stamp: when its band's window closed); opensAt = when that band's window opened
  const items = rows.map((r) => ({ ...view(r, me && me.id), opensAt: B.opensAt(launch, n, r.band) }));
  // a cell with no color of its own (nobody held the band, or they left the color blank) is tinted by the sky:
  // the stamper's own if we have it, else the weather in a stand-in city for that band, looked up once and kept
  const gaps = items.filter((it) => it.color == null);
  if (gaps.length) {
    const need = [];
    for (const it of gaps) { it.fillSky = it.sky && it.sky !== "unknown" ? it.sky : null; if (!it.fillSky) need.push(it); }
    if (need.length) {
      const have = new Map((await ctx.db.prepare("SELECT band, sky FROM band_sky WHERE lap = ?").bind(n).all()).results.map((r) => [r.band, r.sky]));
      const wanted = need.filter((it) => !have.has(it.band)).map((it) => ({ band: it.band, at: B.opensAt(launch, n, it.band) + B.HOUR }));
      const got = await bandSkies(ctx.env, wanted);
      for (const [band, sky] of Object.entries(got)) {
        have.set(Number(band), sky);
        await ctx.db.prepare("INSERT OR IGNORE INTO band_sky (lap, band, sky) VALUES (?,?,?)").bind(n, Number(band), sky).run();
      }
      for (const it of need) it.fillSky = have.get(it.band) ?? null;
    }
  }
  // when this player's band is next up (so a missed lap can say so): skips a window they've already stamped
  let next = null;
  if (me && me.band != null) {
    let w = B.windowFor(launch, me.band, t);
    if (w.open && await ctx.db.prepare("SELECT 1 FROM ledger WHERE lap = ? AND player_id = ? AND kind = 'stamp'").bind(w.lap, me.id).first()) w = B.windowFor(launch, me.band, w.closesAt);
    next = { open: w.open, opensAt: w.opensAt, closesAt: w.closesAt };
  }
  // names are looked up now, not sealed: the ledger only ever holds player ids
  const ids = [...new Set(rows.filter((r) => r.kind === "stamp" && r.player != null).map((r) => r.player))];
  if (ids.length) {
    const people = (await ctx.db.prepare(`SELECT id, name_a, name_b, name_tag, signs FROM players WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all()).results;
    const byId = new Map(people.map((p) => [p.id, p]));
    rows.forEach((r, i) => { const p = byId.get(r.player); items[i].name = p && p.signs && p.name_a ? B.nameText(p.name_a, p.name_b) : null; });
  }
  const stamps = items.filter((r) => r.kind === "stamp");
  // the lap's place in the ledger: its first entry, and its closing entry (the one the registry's checkpoint is made from). All public once the lap is over.
  const from = (await ctx.db.prepare("SELECT MIN(id) AS id FROM ledger WHERE lap = ?").bind(n).first())?.id ?? null;
  const end = await ctx.db.prepare("SELECT id, record, prev_hash, hash FROM ledger WHERE lap = ? AND band = ? AND kind IN ('stamp','gap')").bind(n, B.BANDS - 1).first();
  return {
    next, lap: n, first: 1, last, startsAt: B.lapStart(launch, n), closedAt: B.lapClosesAt(launch, n),
    held: stamps.filter((r) => !r.bot).length, bots: stamps.filter((r) => r.bot).length, unheld: items.length - stamps.length,
    gradient: items.map((r) => r.color),
    tune: items.map((r) => r.note),
    tally: { resolve: stamps.filter((r) => r.note === "resolve").length, tension: stamps.filter((r) => r.note === "tension").length, silent: items.filter((r) => r.note == null).length },
    sky: stamps.reduce((a, r) => (a[r.sky] = (a[r.sky] || 0) + 1, a), {}),
    stamps: items,
    ledger: { from, end: end || null },
    yours: items.find((r) => r.mine) || null,
    // the lap's baton in the shared registry, told only to the one who got it
    baton: me ? (await ctx.db.prepare("SELECT item_id AS item, copy FROM lap_copies WHERE lap = ? AND player_id = ?").bind(n, me.id).first()) : null,
  };
}

async function ledger(ctx) {
  const before = Number(ctx.url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER;
  const limit = Math.min(200, Math.max(1, Number(ctx.url.searchParams.get("limit")) || 50));
  const last = B.lastClosedLap(ctx.launch, ctx.t);
  const rows = (await ctx.db.prepare("SELECT * FROM ledger WHERE id < ? ORDER BY id DESC LIMIT ?").bind(before, limit).all()).results;
  return {
    genesis: GENESIS,
    entries: rows.map((r) => {
      const open = { id: r.id, kind: r.kind, lap: r.lap, band: r.band, prev_hash: r.prev_hash, hash: r.hash, created_at: r.created_at };
      // contents stay hidden until the lap is over
      return r.lap <= last || r.kind === "lap" ? { ...open, record: r.record } : open;
    }),
  };
}

// ---------- save codes and passkeys (kept by the shared Accounts service in dungeon-items) ----------
// This game keeps its own players and cookie. Save codes and passkeys belong to an account there; the account says which
// player here is yours (account_players). A player gets an account the first time they make a code or passkey.

const ACC = (env) => { if (!env.ACCOUNTS) throw new Oops("Accounts are unavailable right now. Try again in a moment.", 503); return env.ACCOUNTS; };
const ipOf = (req) => req.headers.get("cf-connecting-ip") || "unknown";
const originOf = (ctx) => new URL(ctx.req.url).origin;
const ok = (r) => { if (r && r.error) throw new Oops(r.error, r.status || 400); return r; };

// This player's account id (or null). Players from before accounts existed have save codes in this game's own table:
// the first time we see one, its codes move to the account and the table's rows are deleted.
async function accountFor(ctx, me, make = false) {
  const acc = ACC(ctx.env), { db } = ctx;
  let id = (await acc.accountOf(GAME, me.id)).accountId;
  const legacy = (await db.prepare("SELECT code_hash FROM save_codes WHERE player_id = ?").bind(me.id).all()).results;
  if (!id && !make && !legacy.length) return null;
  if (!id) {
    id = (await acc.createAccount()).accountId;
    const l = ok(await acc.link(id, GAME, me.id));
    if (!l.linked) throw new Oops("That didn't work. Try again.");
  }
  for (const r of legacy) await acc.importCode(id, r.code_hash);
  if (legacy.length) await db.prepare("DELETE FROM save_codes WHERE player_id = ?").bind(me.id).run();
  return id;
}

// Log this browser in as the account's player here: the one it already has, else this browser's own player (if it has no
// account yet), else a new one.
async function enter(ctx, accountId) {
  const { env, db } = ctx, acc = ACC(env), t = sec(ctx.t);
  let { playerId } = await acc.playerFor(accountId, GAME);
  if (!playerId) {
    const cur = await player(ctx);
    if (cur && !(await acc.accountOf(GAME, cur.id)).accountId) playerId = cur.id;
    else {
      if (!(await rateLimit(env, ctx.req, "new-player", 20, 3600))) throw new Oops("Too many new players from here. Try again later.", 429);
      playerId = (await db.prepare("INSERT INTO players (token_hash, created_at, seen_at) VALUES (?,?,?) RETURNING id").bind(await sha256(newToken()), t, t).first()).id;
    }
    const l = ok(await acc.link(accountId, GAME, playerId));
    playerId = l.playerId;
  }
  ctx.setCookie = cookieFor(await newSession(env, playerId));
}

const must = async (ctx, create = false) => { const p = await player(ctx, create); if (!p) throw new Oops("No player here.", 401); return p; };
const body = async (ctx) => { try { return await ctx.req.json(); } catch { throw new Oops("That request didn't make sense."); } };

async function account(ctx, known = null) {
  const me = known || await player(ctx);
  const names = B.NAME_LISTS;
  if (!me) return { player: false, admin: false, codes: [], passkeys: [], devices: 0, name: null, names };
  const { db } = ctx;
  const ways = async () => { const id = await accountFor(ctx, me); return id ? ok(await ACC(ctx.env).info(id)) : { codes: [], passkeys: [] }; };
  const [{ codes, passkeys }, others] = await Promise.all([ways(),      // the device count doesn't wait on the account
    db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE player_id = ?").bind(me.id).first()]);
  const devices = 1 + others.n;
  return { player: true, admin: !!me.admin, codes, passkeys, devices, names, signs: !!me.signs,
    name: me.name_a ? { a: me.name_a, b: me.name_b, text: B.nameText(me.name_a, me.name_b) } : null,
    band: me.band == null ? null : { offset: B.offsetOf(me.band), canChangeAt: bandChangeAt(me, ctx.t) } };
}

// Pick two words. Names are unique: if the pair is taken, nothing is saved and you get a free pair to try.
async function setName(ctx) {
  const b = await body(ctx), { db } = ctx;
  const me = await player(ctx, true);
  if (b.a != null || b.b != null) {
    if (!B.checkName(b.a, b.b)) throw new Oops("Pick one word from each list.");
    if (!(me.name_a === b.a && me.name_b === b.b)) {
      try { await db.prepare("UPDATE players SET name_a = ?, name_b = ? WHERE id = ?").bind(b.a, b.b, me.id).run(); }
      catch (e) {
        if (!/UNIQUE/i.test(String(e && e.message))) throw e;
        const res = new Oops("That name is taken. Here's another.", 409);
        res.extra = { suggestion: await freeName(db) };
        throw res;
      }
    }
  }
  if (b.signs != null) await db.prepare("UPDATE players SET signs = ? WHERE id = ?").bind(b.signs ? 1 : 0, me.id).run();
  // built from the row, not the cookie: a brand-new player doesn't have their cookie yet on this request
  return account(ctx, await db.prepare("SELECT * FROM players WHERE id = ?").bind(me.id).first());
}

// A random pair nobody has (tries a handful of times, which is plenty until the lists are nearly full).
async function freeName(db) {
  for (let i = 0; i < 30; i++) {
    const a = "adj:" + Math.floor(Math.random() * B.NAME_ADJECTIVES.length), n = "noun:" + Math.floor(Math.random() * B.NAME_NOUNS.length);
    if (!(await db.prepare("SELECT 1 FROM players WHERE name_a = ? AND name_b = ?").bind(a, n).first())) return { a, b: n };
  }
  return null;
}

async function codes(ctx) {
  const b = await body(ctx);
  if (b.action === "new") {
    const me = await player(ctx, true);
    return { code: ok(await ACC(ctx.env).addCode(await accountFor(ctx, me, true))).code };
  }
  if (b.action === "remove") {
    const me = await must(ctx), id = await accountFor(ctx, me);
    if (!id) throw new Oops("No such save code.", 404);
    ok(await ACC(ctx.env).removeCode(id, Number(b.id)));
    return { ok: true };
  }
  throw new Oops("Unknown action.");
}

// Type a save code: this device becomes that player. (The code is an account's; this game's player comes with it.)
async function loadCode(ctx) {
  const code = (await body(ctx)).code;
  const r = await ACC(ctx.env).loginCode({ code, ip: ipOf(ctx.req) });
  if (r.error) {
    if (r.status === 404) {
      // a code from before accounts: this game's own table still has it until its player is next seen
      if (!(await rateLimit(ctx.env, ctx.req, "load", 10, 900))) throw new Oops("Too many tries. Wait 15 minutes and try again.", 429);
      const old = await ctx.db.prepare("SELECT player_id FROM save_codes WHERE code_hash = ?").bind(await hashCode(code)).first();
      if (old) {
        const p = await ctx.db.prepare("SELECT * FROM players WHERE id = ?").bind(old.player_id).first();
        await enter(ctx, await accountFor(ctx, p, true));
        return { ok: true };
      }
    }
    ok(r);
  }
  await enter(ctx, r.accountId);
  return { ok: true };
}

async function passkey(ctx) {
  const b = await body(ctx), { env, req } = ctx, acc = ACC(env), origin = originOf(ctx);
  if (b.action === "login_options") return ok(await acc.passkeyLoginOptions({ origin, ip: ipOf(req) }));
  if (b.action === "login") {
    const r = ok(await acc.passkeyLogin({ origin, ip: ipOf(req), credential: b.credential }));
    await enter(ctx, r.accountId);
    return { ok: true };
  }
  if (b.action === "register_options" || b.action === "register") {
    const me = await player(ctx, true), accountId = await accountFor(ctx, me, true);
    if (b.action === "register_options") return ok(await acc.passkeyRegisterOptions({ accountId, origin }));
    return ok(await acc.passkeyRegister({ accountId, origin, credential: b.credential, label: b.label }));
  }
  if (b.action === "remove") {
    const me = await must(ctx), id = await accountFor(ctx, me);
    if (!id) throw new Oops("No such passkey.", 404);
    return ok(await acc.passkeyRemove(id, Number(b.id)));
  }
  throw new Oops("Unknown action.");
}

// Log out: this browser forgets its player, but only once there's a save code or passkey to get back in.
async function logout(ctx) {
  const me = await player(ctx), { db } = ctx;
  if (!me) { ctx.setCookie = CLEAR_COOKIE; return { ok: true }; }
  const id = await accountFor(ctx, me);
  const ways = id ? await ACC(ctx.env).waysIn(id) : 0;
  if (!ways) throw new Oops("Make a save code or passkey first, or you'd have no way back in.");
  const h = await sha256(readCookie(ctx.req));
  const s = await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(h).run();
  if (!s.meta.changes) await db.prepare("UPDATE players SET token_hash = ? WHERE id = ? AND token_hash = ?").bind(await sha256(newToken()), me.id, h).run();
  ctx.setCookie = CLEAR_COOKIE;
  return { ok: true };
}

export { verifyChain };

// ---------- the carried copy (copied from TILT.EXE v0.19) ----------
// Your account's pinned copy from any game (dungeon-items registry.js pinned: the pin, else your newest copy), read when
// a run starts so the page can show it, and read again when a memorable moment marks it (markCarried: a deed mark made
// in this game, keyed so a retry makes no second mark). A Moon-blessed copy (a 4Dungeon mark) shows in gold. A registry
// that's away, or no copy, carries nothing and never stops a run.
async function carried(env, playerId) {
  try {
    const c = env.REGISTRY && env.REGISTRY.pinned ? await env.REGISTRY.pinned(GAME, playerId) : null;
    return c && c.itemId ? { ...c, blessed: c.marks.some((m) => m.kind === "moon" && m.value === "blessed") ? 1 : 0 } : null;
  } catch (e) { console.error(e); return null; }
}
const carryView = (c) => c ? { name: c.item.name, copy: c.copy, blessed: c.blessed } : null;
async function markCarry(env, playerId, value, key) {
  const c = await carried(env, playerId);
  if (!c) return;
  try {
    const r = await env.REGISTRY.markCarried({ itemId: c.itemId, copy: c.copy, by: { game: GAME, playerId }, kind: "deed", value, key });
    if (r && r.error) console.error("The registry refused the mark: " + r.error);
  } catch (e) { console.error(e); }
}

// The picker (account panel): every copy your account holds in any game, newest first, and pinning one of them to carry.
//   GET  /api/copies              { copies: [{ itemId, copy, name, game, pinned }] } (up to 50)
//   POST /api/pin {itemId, copy}  pin it: every game carries it from your next run
async function copies(ctx) {
  const { env } = ctx, me = await player(ctx);
  if (!me || !env.REGISTRY || !env.REGISTRY.heldAcross) return { copies: [] };
  const list = await env.REGISTRY.heldAcross(GAME, me.id, 50);
  return { copies: list.map((c) => ({ itemId: c.itemId, copy: c.copy, name: c.item.name, game: c.game, pinned: c.pinned })) };
}
async function pinCopy(ctx) {
  const { env } = ctx, me = await player(ctx), b = await ctx.req.json().catch(() => ({}));
  if (!me) throw new Oops("Make a save code or passkey first.", 401);
  const r = await env.REGISTRY.pin({ game: GAME, playerId: me.id, itemId: Number(b.itemId), copy: Number(b.copy) });
  if (r && r.error) throw new Oops(r.error);
  return { ok: true };
}
