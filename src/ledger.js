// The ledger: one SHA-256 hash chain, like the other games' ledgers.
//
//   kind "lap"   - a lap opened (its number and start time)
//   kind "stamp" - a band's stamp: lap, band, color, note, sky (indices), who held it (id, or bot)
//   kind "gap"   - a band's window closed with nobody holding the baton ("unheld")
//
// hash = SHA-256( prev_hash + "|" + record ). prev_hash is UNIQUE, so the chain can't fork.
// Never sealed: accounts, coarse location, raw weather. Records hold player ids, never names.
// Contents of a lap stay hidden by the API until the lap closes; the hash is checkable after.

export const GENESIS = "0".repeat(64);

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const lapRecord = ({ lap, startsAt }) => JSON.stringify({ kind: "lap", lap, starts_at: Math.floor(startsAt / 1000) });

// The sealed record is public once its lap is over, so it holds no player id. Who stamped is kept in the ledger table's
// own player_id column, which no endpoint publishes. (Stamps sealed before v0.15 still carry a `player` in the record.)
export const stampRecord = ({ lap, band, color, note, phrase, feeling, gesture, signoff, sky, bot, t }) =>
  JSON.stringify({ kind: "stamp", lap, band, color, note, phrase: phrase ?? null, feeling: feeling ?? null, gesture: gesture ?? null,
    signoff: signoff ?? null, sky, bot: bot ? 1 : 0, t });

export const gapRecord = ({ lap, band, t }) => JSON.stringify({ kind: "gap", lap, band, t });

export async function head(db) {
  const h = await db.prepare("SELECT hash FROM ledger ORDER BY id DESC LIMIT 1").first();
  return h ? h.hash : GENESIS;
}

export async function chainInserts(db, prev, entries) {
  const stmts = [];
  let p = prev;
  for (const e of entries) {
    const hash = await sha256(p + "|" + e.record);
    stmts.push(db.prepare(
      `INSERT INTO ledger (kind, lap, band, player_id, record, prev_hash, hash, created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .bind(e.kind, e.lap, e.band ?? null, e.playerId ?? null, e.record, p, hash, e.t));
    p = hash;
  }
  return stmts;
}

const chainClash = (e) => /UNIQUE/i.test(String(e && e.message)) && /ledger\.(prev_)?hash/.test(String(e.message));
const anyUnique = (e) => /UNIQUE/i.test(String(e && e.message));

// Seal one entry on the current head. Returns "sealed", or "duplicate" if that lap/band/player already
// has one (the unique indexes say no), retrying when someone else moved the head first.
export async function seal(db, entry) {
  for (let i = 0; i < 8; i++) {
    const stmts = await chainInserts(db, await head(db), [entry]);
    try { await db.batch(stmts); return "sealed"; }
    catch (e) {
      if (chainClash(e)) continue;
      if (anyUnique(e)) return "duplicate";
      throw e;
    }
  }
  throw new Error("The ledger is busy. Try again.");
}

// Check a list of rows (oldest first) forms an unbroken chain from GENESIS.
export async function verifyChain(rows) {
  let p = GENESIS;
  for (const r of rows) {
    if (r.prev_hash !== p) return { ok: false, at: r.id };
    if ((await sha256(p + "|" + r.record)) !== r.hash) return { ok: false, at: r.id };
    p = r.hash;
  }
  return { ok: true };
}
