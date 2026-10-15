// Passkeys (WebAuthn): load your player on any device with its fingerprint, face or PIN.
// (Ported from scoundrel.exe, which got it from the 88x31 cLuB.)
//
// No outside services and no libraries: the browser makes a key pair, keeps the private half (often
// synced through the player's Apple / Google / password manager) and gives us the public half.
// To log in, the browser signs a fresh challenge and we check the signature here with WebCrypto.
// The save code always stays as the backup way in.
//
// Adding: options (challenge, user handle, the passkeys they already have) -> browser create() ->
//   verifyRegistration checks the challenge, origin and site, reads the public key out of the
//   attestation (attestation itself isn't checked: "none" is fine for this), and stores it.
// Logging in: options (challenge, no user named: passkeys are "discoverable") -> browser get() ->
//   verifyLogin finds the passkey, checks challenge, origin, site and the signature, then logs them in.
const now = () => Math.floor(Date.now() / 1000);

const CHALLENGE_SECS = 300;
const enc = new TextEncoder();

export const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64url = (s) => {
  const t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(t + "===".slice((t.length + 3) % 4)), (c) => c.charCodeAt(0));
};
const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// ---------- a tiny CBOR reader (just what WebAuthn uses) ----------
export function cbor(bytes, pos = 0) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const head = () => {
    const b = bytes[pos++], major = b >> 5, info = b & 31;
    let n = info;
    if (info === 24) n = bytes[pos++];
    else if (info === 25) { n = dv.getUint16(pos); pos += 2; }
    else if (info === 26) { n = dv.getUint32(pos); pos += 4; }
    else if (info === 27) { n = Number(dv.getBigUint64(pos)); pos += 8; }
    else if (info > 27) throw new Error("cbor: unsupported length");
    return [major, n, info];
  };
  const item = () => {
    const [major, n, info] = head();
    switch (major) {
      case 0: return n;
      case 1: return -1 - n;
      case 2: { const v = bytes.slice(pos, pos + n); pos += n; return v; }
      case 3: { const v = new TextDecoder().decode(bytes.slice(pos, pos + n)); pos += n; return v; }
      case 4: { const a = []; for (let i = 0; i < n; i++) a.push(item()); return a; }
      case 5: { const m = new Map(); for (let i = 0; i < n; i++) { const k = item(); m.set(k, item()); } return m; }
      case 6: return item();   // tag: ignore it
      case 7: return info === 20 ? false : info === 21 ? true : null;
      default: throw new Error("cbor: bad item");
    }
  };
  const value = item();
  return { value, end: pos };
}

// authenticatorData: rpIdHash(32) flags(1) signCount(4) [aaguid(16) credIdLen(2) credId pubKey(COSE)]
function parseAuthData(a) {
  if (a.length < 37) throw new Error("short authenticator data");
  const flags = a[32];
  const out = { rpIdHash: a.slice(0, 32), up: !!(flags & 1), uv: !!(flags & 4), at: !!(flags & 64),
    signCount: new DataView(a.buffer, a.byteOffset + 33, 4).getUint32(0) };
  if (out.at) {
    const len = (a[53] << 8) | a[54];
    out.credId = a.slice(55, 55 + len);
    out.cose = cbor(a, 55 + len).value;
  }
  return out;
}

// COSE key -> { jwk, alg }  (ES256 / P-256, or RS256)
function coseToJwk(cose) {
  const kty = cose.get(1), alg = cose.get(3);
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) {
    return { alg, jwk: { kty: "EC", crv: "P-256", x: b64url(cose.get(-2)), y: b64url(cose.get(-3)), ext: true } };
  }
  if (kty === 3 && alg === -257) {
    return { alg, jwk: { kty: "RSA", n: b64url(cose.get(-1)), e: b64url(cose.get(-2)), alg: "RS256", ext: true } };
  }
  throw new Error("That kind of passkey isn't supported.");
}

// ECDSA signatures arrive DER-encoded; WebCrypto wants raw r||s (32 bytes each).
function derToRaw(der) {
  let p = 2;
  if (der[1] & 0x80) p += der[1] & 0x7f;
  const int = () => {
    if (der[p++] !== 2) throw new Error("bad signature");
    const len = der[p++];
    let v = der.slice(p, p + len); p += len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(32); out.set(v, 32 - v.length);
    return out;
  };
  const r = int(), s = int();
  const raw = new Uint8Array(64); raw.set(r, 0); raw.set(s, 32);
  return raw;
}

async function verifySig(alg, jwk, sig, data) {
  if (alg === -7) {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(sig), data);
  }
  if (alg === -257) {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data);
  }
  return false;
}

// Which site and origin this request is for (the Worker's own address, or localhost when testing).
export function siteOf(request) {
  const u = new URL(request.url);
  return { rpId: u.hostname, origin: u.origin };
}

async function newChallenge(env, kind, playerId = null) {
  const c = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM passkey_challenges WHERE expires_at < ?").bind(now()),
    env.DB.prepare("INSERT INTO passkey_challenges (challenge, player_id, kind, expires_at) VALUES (?, ?, ?, ?)")
      .bind(c, playerId, kind, now() + CHALLENGE_SECS),
  ]);
  return c;
}

// Use up a challenge once. Returns its row or null.
async function takeChallenge(env, challenge, kind) {
  const row = await env.DB.prepare("DELETE FROM passkey_challenges WHERE challenge = ? AND kind = ? AND expires_at >= ? RETURNING player_id")
    .bind(String(challenge || ""), kind, now()).first();
  return row || null;
}

// Check clientDataJSON: the right ceremony, our challenge, our origin.
async function checkClient(env, request, clientDataB64, type, kind) {
  const raw = unb64url(clientDataB64);
  let c;
  try { c = JSON.parse(new TextDecoder().decode(raw)); } catch { throw new Error("Couldn't read the passkey's answer."); }
  if (c.type !== type) throw new Error("That wasn't the right kind of passkey answer.");
  if (c.origin !== siteOf(request).origin) throw new Error("That passkey answer came from somewhere else.");
  const row = await takeChallenge(env, c.challenge, kind);
  if (!row) throw new Error("That took too long. Try again!");
  return { raw, row };
}

// ---------- adding a passkey to your player ----------
export async function registerOptions(env, request, user) {
  const { rpId } = siteOf(request);
  const { results } = await env.DB.prepare("SELECT cred_id FROM passkeys WHERE player_id = ?").bind(user.id).all();
  const label = `Band Baton player ${user.id}`;
  return {
    challenge: await newChallenge(env, "register", user.id),
    rp: { name: "Band Baton", id: rpId },
    user: { id: b64url(enc.encode("baton:" + user.id)), name: label, displayName: label },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
    authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "preferred" },
    excludeCredentials: results.map((r) => ({ type: "public-key", id: r.cred_id })),
    attestation: "none",
    timeout: CHALLENGE_SECS * 1000,
  };
}

// cred: { id, response: { clientDataJSON, attestationObject } } (base64url strings)
export async function verifyRegistration(env, request, user, cred, label) {
  const { row } = await checkClient(env, request, cred?.response?.clientDataJSON, "webauthn.create", "register");
  if (row.player_id !== user.id) throw new Error("That passkey answer was for someone else.");
  const att = cbor(unb64url(cred.response.attestationObject)).value;
  const auth = parseAuthData(att.get("authData"));
  if (!same(auth.rpIdHash, await sha256(enc.encode(siteOf(request).rpId)))) throw new Error("That passkey is for a different site.");
  if (!auth.up || !auth.at || !auth.credId) throw new Error("The passkey didn't finish. Try again!");
  const { jwk, alg } = coseToJwk(auth.cose);
  const credId = b64url(auth.credId);
  const t = now();
  try {
    await env.DB.prepare(
      "INSERT INTO passkeys (player_id, cred_id, public_key, alg, sign_count, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(user.id, credId, JSON.stringify(jwk), alg, auth.signCount, String(label || "").slice(0, 40) || null, t).run();
  } catch { throw new Error("That passkey is already saved."); }
  return { ok: true };
}

// ---------- logging in with a passkey ----------
export async function loginOptions(env, request) {
  return { challenge: await newChallenge(env, "login"), rpId: siteOf(request).rpId, userVerification: "preferred", timeout: CHALLENGE_SECS * 1000 };
}

// cred: { id, response: { clientDataJSON, authenticatorData, signature } }. Returns the player id.
export async function verifyLogin(env, request, cred) {
  const pk = await env.DB.prepare("SELECT * FROM passkeys WHERE cred_id = ?").bind(String(cred?.id || "")).first();
  if (!pk) throw new Error("That passkey isn't saved here (it may have been removed). Use your save code!");
  const { raw } = await checkClient(env, request, cred.response.clientDataJSON, "webauthn.get", "login");
  const authBytes = unb64url(cred.response.authenticatorData);
  const auth = parseAuthData(authBytes);
  if (!same(auth.rpIdHash, await sha256(enc.encode(siteOf(request).rpId)))) throw new Error("That passkey is for a different site.");
  if (!auth.up) throw new Error("The passkey didn't finish. Try again!");
  const data = new Uint8Array(authBytes.length + 32);
  data.set(authBytes, 0); data.set(await sha256(raw), authBytes.length);
  let ok = false;
  try { ok = await verifySig(pk.alg, JSON.parse(pk.public_key), unb64url(cred.response.signature), data); } catch { ok = false; }
  if (!ok) throw new Error("That passkey didn't check out.");
  // a counter that goes backwards means a copied key: refuse (synced passkeys just send 0)
  if (auth.signCount && pk.sign_count && auth.signCount <= pk.sign_count) throw new Error("That passkey looks copied. Use your save code!");
  await env.DB.prepare("UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE id = ?").bind(auth.signCount, now(), pk.id).run();
  return pk.player_id;
}
