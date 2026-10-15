// Band Baton rules: pure functions, no I/O. The Worker and the tests both use these.
//
// 24 fixed solar bands, 15 degrees of longitude each. A band is named by its solar UTC offset
// (+12 ... -11). A lap starts at the +12 band's 06:00 solar sunrise and moves west one band an
// hour. In a lap, bands are numbered 0..23 in the order the baton reaches them:
//   index 0 = solar UTC+12 (date line), index 12 = UTC+0, index 23 = UTC-11.

export const HOUR = 3600 * 1000;
export const BANDS = 24;
export const WINDOW_H = 2;                 // placeholder: how long a band's catch window stays open
export const LAP_MS = BANDS * HOUR;

export const offsetOf = (index) => 12 - index;
export const indexOf = (offset) => 12 - offset;
export const bandLabel = (index) => { const o = offsetOf(index); return "solar UTC" + (o >= 0 ? "+" : "-") + Math.abs(o); };

// Longitude (degrees, -180..180) -> band index.
export function bandFromLon(lon) {
  let off = Math.round(lon / 15);
  if (off < -11) off += 24;                // -12 is the same band as +12
  if (off > 12) off -= 24;
  return indexOf(off);
}

export function bandFromOffset(off) {
  off = Math.round(Number(off));
  if (!Number.isFinite(off)) return null;
  if (off < -11) off += 24;
  if (off > 12) off -= 24;
  if (off < -11 || off > 12) return null;
  return indexOf(off);
}

// `launch` is the ms timestamp when lap 1 starts (the date-line band's sunrise).
export const lapStart = (launch, lap) => launch + (lap - 1) * LAP_MS;
export const opensAt = (launch, lap, index) => lapStart(launch, lap) + index * HOUR;
export const closesAt = (launch, lap, index) => opensAt(launch, lap, index) + WINDOW_H * HOUR;
// A lap is closed (its stamps can be revealed) when its last band's window has ended.
export const lapClosesAt = (launch, lap) => closesAt(launch, lap, BANDS - 1);
export const currentLap = (launch, t) => (t < launch ? 0 : Math.floor((t - launch) / LAP_MS) + 1);
export const lastClosedLap = (launch, t) => {
  let n = currentLap(launch, t);
  while (n >= 1 && t < lapClosesAt(launch, n)) n--;
  return n;
};

// The window a band is in right now (or null), and the next time it opens.
export function windowFor(launch, index, t) {
  const n = Math.floor((t - launch - index * HOUR) / LAP_MS) + 1;
  if (n >= 1 && t < closesAt(launch, n, index)) {
    return { lap: n, open: t >= opensAt(launch, n, index), opensAt: opensAt(launch, n, index), closesAt: closesAt(launch, n, index) };
  }
  const next = Math.max(1, n + 1);
  return { lap: next, open: false, opensAt: opensAt(launch, next, index), closesAt: closesAt(launch, next, index) };
}

// ---------- what a stamp can hold (indices only, never free text) ----------

export const COLORS = [
  { name: "ember", hsl: [8, 70, 55] }, { name: "amber", hsl: [28, 70, 55] }, { name: "straw", hsl: [48, 70, 55] },
  { name: "moss", hsl: [95, 70, 55] }, { name: "fern", hsl: [150, 70, 55] }, { name: "teal", hsl: [175, 70, 55] },
  { name: "sky", hsl: [200, 70, 55] }, { name: "ink", hsl: [225, 70, 55] }, { name: "violet", hsl: [260, 70, 55] },
  { name: "magenta", hsl: [290, 70, 55] }, { name: "rose", hsl: [325, 70, 55] }, { name: "frost", hsl: [0, 0, 92] },
];
export const NOTES = ["resolve", "tension"];
export const SKIES = ["clear", "cloud", "fog", "drizzle", "rain", "snow", "storm", "unknown"];
export const SKY_WORDS = { clear: "Clear", cloud: "Overcast", fog: "Fog", drizzle: "Drizzle", rain: "Rain", snow: "Snow", storm: "Storm", unknown: "Unknown sky" };

// WMO weather code -> one of SKIES
export function skyFromWmo(code) {
  if (code == null) return "unknown";
  const c = Number(code);
  if (c === 0 || c === 1) return "clear";
  if (c === 2 || c === 3) return "cloud";
  if (c === 45 || c === 48) return "fog";
  if (c >= 51 && c <= 57) return "drizzle";
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return "rain";
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "snow";
  if (c >= 95 && c <= 99) return "storm";
  return "unknown";
}

// Every slot may be left blank (null). Anything else must be a valid index/name.
export function checkStamp(body) {
  const color = body && body.color != null ? body.color : null;
  const note = body && body.note != null ? body.note : null;
  if (color !== null && !(Number.isInteger(color) && color >= 0 && color < COLORS.length)) return { error: "That color isn't in the palette." };
  if (note !== null && !NOTES.includes(note)) return { error: "That note isn't one of the choices." };
  return { color, note };
}

// A short day-of-year-free "solar calendar" line for the catch screen: sunrise and day length are
// computed in the browser with sky.js later; the server only knows the lap.
