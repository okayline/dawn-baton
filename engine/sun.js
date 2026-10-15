// Sunrise, sunset and day length for a coarse place and moment (NOAA's general solar calculation).
// Pure functions. (The Dungeon's sky.js has the same sun math for its sky view; this is the small piece
// the baton needs: rise/set times, and whether today is a solstice or equinox.)

const RAD = Math.PI / 180;
const DAY = 86400000;

// Solar declination (radians) and equation of time (minutes) at a UTC moment.
function sunAt(ms) {
  const jd = ms / DAY + 2440587.5;
  const g = (357.52911 + 0.98560028 * (jd - 2451545)) * RAD;                       // mean anomaly
  const q = (280.46646 + 0.98564736 * (jd - 2451545)) % 360;                        // mean longitude (deg)
  const L = (q + 1.914602 * Math.sin(g) + 0.019993 * Math.sin(2 * g)) * RAD;        // true longitude
  const eps = (23.439291 - 0.0000004 * (jd - 2451545)) * RAD;                       // obliquity
  const decl = Math.asin(Math.sin(eps) * Math.sin(L));
  const y = Math.tan(eps / 2) ** 2;
  const q0 = q * RAD;
  const eqt = 4 / RAD * (y * Math.sin(2 * q0) - 2 * 0.016708634 * Math.sin(g) + 4 * 0.016708634 * y * Math.sin(g) * Math.cos(2 * q0)
    - 0.5 * y * y * Math.sin(4 * q0) - 1.25 * 0.016708634 ** 2 * Math.sin(2 * g));
  return { decl, eqt };
}

// Rise and set for the local solar day that `ms` falls in, at (lat, lon) in degrees.
// Returns { rise, set, length (ms), polar: null | "day" | "night" } with rise/set as UTC ms (null when polar).
export function sunDay(lat, lon, ms) {
  const shifted = new Date(ms + (lon / 15) * 3600000);                              // local solar date
  const midnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  const noonGuess = midnight + DAY / 2 - (lon / 15) * 3600000;                      // local noon, roughly, in UTC
  const { decl, eqt } = sunAt(noonGuess);
  const cosH = (Math.cos(90.833 * RAD) - Math.sin(lat * RAD) * Math.sin(decl)) / (Math.cos(lat * RAD) * Math.cos(decl));
  if (cosH > 1) return { rise: null, set: null, length: 0, polar: "night" };
  if (cosH < -1) return { rise: null, set: null, length: DAY, polar: "day" };
  const H = Math.acos(cosH) / RAD;                                                  // half the day, in degrees of hour angle
  const noonUtcMin = 720 - 4 * lon - eqt;
  const rise = midnight + (noonUtcMin - 4 * H) * 60000;
  const set = midnight + (noonUtcMin + 4 * H) * 60000;
  return { rise: Math.round(rise), set: Math.round(set), length: Math.round(set - rise), polar: null };
}

// "equinox" or "solstice" if today (the local solar day) holds one, else null.
export function sunEvent(lon, ms) {
  const shifted = new Date(ms + (lon / 15) * 3600000);
  const start = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - (lon / 15) * 3600000;
  const d0 = sunAt(start).decl, d1 = sunAt(start + DAY).decl;
  if (d0 === 0 || (d0 < 0) !== (d1 < 0)) return "equinox";
  const before = sunAt(start - DAY).decl, mid = sunAt(start + DAY / 2).decl, after = sunAt(start + 1.5 * DAY).decl;
  const slopeIn = mid - sunAt(start - DAY / 2).decl, slopeOut = after - mid;
  if ((slopeIn < 0) !== (slopeOut < 0) || Math.abs(slopeIn) < 1e-6) return "solstice";
  return null;
}

// Everything the catch screen needs about today's sun.
export function sunReport(lat, lon, ms) {
  const today = sunDay(lat, lon, ms), yesterday = sunDay(lat, lon, ms - DAY);
  return {
    rise: today.rise, set: today.set, length: today.length, polar: today.polar,
    delta: today.polar || yesterday.polar ? null : today.length - yesterday.length,   // ms longer (+) or shorter (-) than yesterday
    event: sunEvent(lon, ms),
  };
}
