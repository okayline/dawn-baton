// Save codes and devices: bring your player to another browser or device.
//
// A player is a cookie: the first device's token is players.token_hash, and every other device it's
// loaded on gets its own token in `sessions`. Only SHA-256 hashes of tokens and codes are stored.
// Save codes (ported from scoundrel.exe) look like K7QM-2XPA-9RTD-HV4C-8NBE: 20 characters, ~99 bits.

export const now = () => Math.floor(Date.now() / 1000);
export const MAX_CODES = 5;

// No 0/O, 1/I/L, so codes are easy to copy by hand. 31 symbols.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LEN = 20;

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Random code like K7QM-2XPA-9RTD-HV4C-8NBE (rejection sampling, no bias).
export function newSaveCode() {
  const out = [];
  const buf = new Uint8Array(64);
  while (out.length < CODE_LEN) {
    crypto.getRandomValues(buf);
    for (const b of buf) if (b < 248 && out.length < CODE_LEN) out.push(ALPHABET[b % 31]);   // 248 = 8 * 31
  }
  return out.join("").match(/.{1,4}/g).join("-");
}

// Accepts any spacing, case or dashes.
export const normalizeCode = (input) => String(input || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
export const hashCode = (code) => sha256("code:" + normalizeCode(code));

export function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Load a player on this device: a new token for it. Returns the token for the cookie.
export async function newSession(env, playerId) {
  const token = newToken();
  const t = now();
  await env.DB.prepare("INSERT INTO sessions (token_hash, player_id, created_at, seen_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), playerId, t, t).run();
  return token;
}

// Fixed window per hashed IP + action. Returns true if allowed.
export async function rateLimit(env, req, action, limit, windowSecs) {
  const ip = req.headers.get("cf-connecting-ip") || "unknown";
  const key = action + ":" + (await sha256("ip:" + ip)).slice(0, 32);
  const t = now();
  const windowStart = t - (t % windowSecs);
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1 RETURNING count`).bind(key, windowStart).first();
  if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(t - 86400).run();
  return row.count <= limit;
}
