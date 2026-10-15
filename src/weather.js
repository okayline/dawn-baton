// The automatic sky report. Uses Cloudflare's rough location for the request (rounded to a degree),
// asks Open-Meteo for the current weather code, and falls back to "unknown" on any problem.
// Open-Meteo's free tier is non-commercial; check its terms before this earns money.
// The raw weather and the location are never stored: only the sky word is sealed.
import { skyFromWmo } from "../engine/baton.js";

// The request's rough place, rounded to a whole degree (Cloudflare's guess from the connection), or null.
// env.GEO lets tests and local dev pretend to be somewhere. Never stored.
export function coarsePlace(env, req) {
  const cf = env.GEO || (req && req.cf) || {};
  const lat = Math.round(Number(cf.latitude)), lon = Math.round(Number(cf.longitude));
  return cf.latitude != null && cf.longitude != null && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

export async function skyFor(env, req) {
  try {
    const place = coarsePlace(env, req);
    if (env.WEATHER) return await env.WEATHER(place && place.lat, place && place.lon);   // tests plug in here
    if (!place) return "unknown";
    const { lat, lon } = place;
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code`,
      { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return "unknown";
    const data = await res.json();
    return skyFromWmo(data && data.current && data.current.weather_code);
  } catch { return "unknown"; }
}

// Sky words for several bands at once, one request: `wanted` = [{ band, at }] where `at` is a UTC ms moment inside
// that band's window. Returns { [band]: sky } for the bands the service answered for (a failed lookup is left out,
// so it is tried again next time). env.BAND_WEATHER lets tests plug in. Nothing here is sealed in the ledger.
import { BAND_CITIES } from "../engine/baton.js";

export async function bandSkies(env, wanted) {
  if (!wanted.length) return {};
  if (env.BAND_WEATHER) return await env.BAND_WEATHER(wanted);
  try {
    const cities = wanted.map((w) => BAND_CITIES[w.band]);
    const oldest = Math.min(...wanted.map((w) => w.at));
    const pastDays = Math.min(92, Math.max(1, Math.ceil((Date.now() - oldest) / 86400000) + 1));
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${cities.map((c) => c[1]).join(",")}&longitude=${cities.map((c) => c[2]).join(",")}`
      + `&hourly=weather_code&past_days=${pastDays}&forecast_days=1&timezone=UTC`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return {};
    const data = await res.json();
    const list = Array.isArray(data) ? data : [data];
    const out = {};
    wanted.forEach((w, i) => {
      const h = list[i] && list[i].hourly;
      if (!h) return;
      const hour = new Date(Math.floor(w.at / 3600000) * 3600000).toISOString().slice(0, 13) + ":00";
      const at = h.time.indexOf(hour);
      out[w.band] = at >= 0 ? skyFromWmo(h.weather_code[at]) : "unknown";
    });
    return out;
  } catch { return {}; }
}
