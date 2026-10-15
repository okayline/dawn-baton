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
