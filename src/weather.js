// The automatic sky report. Uses Cloudflare's rough location for the request (rounded to a degree),
// asks Open-Meteo for the current weather code, and falls back to "unknown" on any problem.
// Open-Meteo's free tier is non-commercial; check its terms before this earns money.
// The raw weather and the location are never stored: only the sky word is sealed.
import { skyFromWmo } from "../engine/baton.js";

export async function skyFor(env, req) {
  try {
    const cf = req.cf || {};
    const lat = Math.round(Number(cf.latitude)), lon = Math.round(Number(cf.longitude));
    if (env.WEATHER) return await env.WEATHER(lat, lon);          // tests plug in here
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "unknown";
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code`,
      { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return "unknown";
    const data = await res.json();
    return skyFromWmo(data && data.current && data.current.weather_code);
  } catch { return "unknown"; }
}
