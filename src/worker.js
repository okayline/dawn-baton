// Band Baton Worker: the baton, cookie players, one stamp per player per lap, and the ledger.
//
// API (all JSON):
//   GET  /api/today          your band, your catch window, the line before yours (in your window), your sky
//   POST /api/band {offset}  set your band from your solar UTC offset (-11..+12); the browser sends its own
//   POST /api/stamp {color, note}   pass the baton: seal your stamp (blank slots are fine)
//   GET  /api/planet         the current lap: every band waiting / open / stamped / unheld (no contents)
//   GET  /api/lap?n=         a closed lap in full (default: the latest closed one), with your stamp marked
//   GET  /api/ledger?before=&limit=   newest first; contents of unfinished laps are hidden

import * as B from "../engine/baton.js";
import { seal, lapRecord, stampRecord, gapRecord, sha256, verifyChain, GENESIS } from "./ledger.js";
import { skyFor } from "./weather.js";

const COOKIE = "bb";
const COOKIE_MAX_AGE = 400 * 86400;

class Oops extends Error { constructor(m, status = 400) { super(m); this.status = status; } }

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
});

const ROUTES = {
  "GET /api/today": today, "POST /api/band": setBand, "POST /api/stamp": stamp,
  "GET /api/planet": planet, "GET /api/lap": lapView, "GET /api/ledger": ledger,
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS ? env.ASSETS.fetch(req) : new Response("Not found", { status: 404 });
    try {
      const route = ROUTES[`${req.method} ${url.pathname}`];
      if (!route) return json({ error: "No such thing." }, 404);
      const ctx = { env, req, url, db: env.DB, t: clock(env), launch: Date.parse(env.LAUNCH_START), setCookie: null };
      if (!Number.isFinite(ctx.launch)) return json({ error: "The server has no LAUNCH_START set." }, 500);
      await settle(ctx);
      const res = await route(ctx);
      return ctx.setCookie ? json(res.data ?? res, 200, { "set-cookie": ctx.setCookie }) : json(res.data ?? res);
    } catch (e) {
      if (e instanceof Oops) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Something broke. Try again in a moment." }, 500);
    }
  },
};

const clock = (env) => (env.clock ? env.clock() : Date.now());
const sec = (ms) => Math.floor(ms / 1000);

// ---------- players ----------

async function player(ctx, create = false) {
  const m = /(?:^|;\s*)bb=([^;]+)/.exec(ctx.req.headers.get("cookie") || "");
  if (m) {
    const row = await ctx.db.prepare("SELECT * FROM players WHERE token_hash = ?").bind(await sha256(m[1])).first();
    if (row) return row;
  }
  if (!create) return null;
  const token = crypto.randomUUID() + crypto.randomUUID();
  const now = sec(ctx.t);
  const r = await ctx.db.prepare("INSERT INTO players (token_hash, created_at, seen_at) VALUES (?,?,?)").bind(await sha256(token), now, now).run();
  ctx.setCookie = `${COOKIE}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
  return await ctx.db.prepare("SELECT * FROM players WHERE token_hash = ?").bind(await sha256(token)).first();
}

// ---------- sealing what time itself decides ----------

// Lazily seal: laps opening, and every band whose window has ended with nobody holding it
// (a bot's stamp when BOTS=1, otherwise an "unheld" gap). Safe to run on every request.
async function settle(ctx) {
  const { db, t, launch, env } = ctx;
  const cur = B.currentLap(launch, t);
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
}

// A bot's choices come from a hash of the lap and band: always the same, never random at read time.
async function botStamp(env, lap, band) {
  const h = await sha256(`${env.BOT_SECRET || "bot"}|${lap}|${band}`);
  const n = (k) => parseInt(h.slice(k * 4, k * 4 + 4), 16);
  return {
    color: n(0) % 12 === 11 && n(1) % 3 ? null : n(0) % B.COLORS.length,   // frost is a bot's "blank-ish" choice, kept rare
    note: n(2) % 9 === 0 ? null : B.NOTES[n(3) % 2],
    sky: "unknown", player: null,
  };
}

// ---------- reading stamps back ----------

const parse = (row) => ({ ...JSON.parse(row.record), id: row.id, hash: row.hash });
const view = (r, mineId = null) => ({
  band: r.band, label: B.bandLabel(r.band), kind: r.kind, bot: !!r.bot,
  color: r.color ?? null, note: r.note ?? null, sky: r.sky ?? null, mine: mineId != null && r.player === mineId,
  hash: r.hash,
});

async function stampsOf(ctx, lap) {
  return (await ctx.db.prepare("SELECT * FROM ledger WHERE lap = ? AND kind IN ('stamp','gap') ORDER BY band").bind(lap).all()).results.map(parse);
}

// ---------- routes ----------

async function today(ctx) {
  const me = await player(ctx);
  const { launch, t } = ctx;
  const out = { now: t, launch, lap: B.currentLap(launch, t), band: null, window: null, stamped: false, prev: null, sky: null,
    palette: B.COLORS, notes: B.NOTES, lastClosedLap: B.lastClosedLap(launch, t) };
  if (!me || me.band == null) return out;
  out.band = { index: me.band, offset: B.offsetOf(me.band), label: B.bandLabel(me.band) };
  const w = B.windowFor(launch, me.band, t);
  out.window = w;
  if (w.open) {
    const mine = await ctx.db.prepare("SELECT 1 FROM ledger WHERE lap = ? AND player_id = ? AND kind = 'stamp'").bind(w.lap, me.id).first();
    out.stamped = !!mine;
    // the one line before yours: the nearest earlier band's stamp (skipping unheld bands)
    const prev = (await stampsOf(ctx, w.lap)).filter((r) => r.kind === "stamp" && r.band < me.band).sort((a, b) => b.band - a.band)[0];
    if (prev) out.prev = view(prev);
    if (!out.stamped) out.sky = await skyFor(ctx.env, ctx.req);
  }
  return out;
}

async function setBand(ctx) {
  const body = await ctx.req.json().catch(() => ({}));
  const idx = body.offset != null ? B.bandFromOffset(body.offset) : null;
  if (idx == null) throw new Oops("Pick a solar offset from -11 to +12.");
  const me = await player(ctx, true);
  await ctx.db.prepare("UPDATE players SET band = ?, seen_at = ? WHERE id = ?").bind(idx, sec(ctx.t), me.id).run();
  return { band: { index: idx, offset: B.offsetOf(idx), label: B.bandLabel(idx) } };
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
    record: stampRecord({ lap: w.lap, band: me.band, color: s.color, note: s.note, sky, player: me.id, bot: false, t: when }), t: when,
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
  const items = rows.map((r) => view(r, me && me.id));
  const stamps = items.filter((r) => r.kind === "stamp");
  return {
    lap: n, startsAt: B.lapStart(launch, n), closedAt: B.lapClosesAt(launch, n),
    held: stamps.filter((r) => !r.bot).length, bots: stamps.filter((r) => r.bot).length, unheld: items.length - stamps.length,
    gradient: items.map((r) => r.color),
    tune: items.map((r) => r.note),
    tally: { resolve: stamps.filter((r) => r.note === "resolve").length, tension: stamps.filter((r) => r.note === "tension").length, silent: items.filter((r) => r.note == null).length },
    sky: stamps.reduce((a, r) => (a[r.sky] = (a[r.sky] || 0) + 1, a), {}),
    stamps: items,
    yours: items.find((r) => r.mine) || null,
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

export { verifyChain };
