// Dawn Baton rules: pure functions, no I/O. The Worker and the tests both use these.
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
  { name: "ember", hsl: [8, 62, 60] }, { name: "amber", hsl: [28, 62, 60] }, { name: "straw", hsl: [48, 62, 60] },
  { name: "moss", hsl: [95, 62, 60] }, { name: "fern", hsl: [150, 62, 60] }, { name: "teal", hsl: [175, 62, 60] },
  { name: "sky", hsl: [200, 62, 60] }, { name: "ink", hsl: [225, 62, 60] }, { name: "violet", hsl: [260, 62, 60] },
  { name: "magenta", hsl: [290, 62, 60] }, { name: "rose", hsl: [325, 62, 60] }, { name: "frost", hsl: [0, 0, 92] },
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

// Picked-from-list slots. A stamp stores the index, never the text, so the same stamp can be shown in any
// language later. Append new entries to the END of a list (indices are sealed in the ledger forever).
export const PHRASES = [
  "Morning to you too!", "Right back at you!", "Still half asleep, hi.", "Hi, hi, hi!",
  "Hope your coffee's hot.", "Same, honestly.", "Sunshine received.", "Okay that made me smile.",
  "Thanks for the light.", "Sending a warm wave.", "It's morning already??", "Look at you go.",
  "Rise and shine, you.", "Keep being you.", "Hello from the sunrise.", "Big hug from over here.",
  "Fresh day, let's go.", "Rooting for you.", "Right back at you, early bird.", "Onwards!!",
];
export const FEELINGS = [
  "sleepy", "hopeful", "restless", "calm",
  "curious", "soft", "cranky", "sparkly",
  "misty", "solid", "giddy", "fried",
  "thankful", "a bit off",
];
export const GESTURES = [
  "mid-yawn", "singing to myself", "stretching like a cat", "dancing like nobody's watching",
  "talking to my coffee", "smiling at nothing", "waving at the sun", "talking to a plant",
  "eating cereal standing up", "daydreaming", "squinting at the sunrise", "pretending to be productive",
];
export const SIGNOFFS = [
  "a good song", "snacks, obviously", "one (1) plan", "my comfy hoodie",
  "zero expectations", "main character energy", "a long walk", "clean socks",
  "questionable confidence", "a little sunshine",
];
export const LISTS = { phrase: PHRASES, feeling: FEELINGS, gesture: GESTURES, signoff: SIGNOFFS };

const index = (v, list) => (v === null || v === undefined ? null : Number.isInteger(v) && v >= 0 && v < list.length ? v : undefined);

// Every slot may be left blank (null). Anything else must be a valid index/name.
export function checkStamp(body) {
  const b = body || {};
  const color = b.color != null ? b.color : null;
  const note = b.note != null ? b.note : null;
  if (color !== null && !(Number.isInteger(color) && color >= 0 && color < COLORS.length)) return { error: "That color isn't in the palette." };
  if (note !== null && !NOTES.includes(note)) return { error: "That note isn't one of the choices." };
  const out = { color, note };
  for (const [key, list] of Object.entries(LISTS)) {
    const v = index(b[key], list);
    if (v === undefined) return { error: `That ${key} isn't one of the choices.` };
    out[key] = v;
  }
  return out;
}

// ---------- player names: two words from lists ----------
// A name is two word ids ("adj:3", "noun:7"). Names are unique: a taken pair is rerolled, never numbered.
// Ids point into these lists, so append new words to the END. Later, words from a player's codex can be
// accepted here too (an id like "codex:<word>"); the ledger never holds names, only player ids.
export const NAME_ADJECTIVES = [
  "Quiet", "Amber", "Early", "Gentle", "Bright", "Sleepy", "Golden", "Misty", "Rosy", "Brisk",
  "Hushed", "Warm", "Pale", "Slow", "Steady", "Wandering", "Soft", "Silver", "Crisp", "Drowsy",
  "Humble", "Eager", "Lucky", "Patient", "Little", "Cheerful", "Faint", "Glowing", "Distant", "Tender",
  "Rested", "Windy", "Dewy", "Calm", "Merry", "Shy", "Nimble", "Sunny", "Mellow", "Dappled",
];
export const NAME_NOUNS = [
  "Heron", "Lantern", "Sparrow", "Kettle", "Meadow", "Thistle", "Harbor", "Wren", "Compass", "Fern",
  "Moth", "Orchard", "Ferry", "Pebble", "Robin", "Willow", "Teapot", "Comet", "Lark", "Cedar",
  "Beacon", "Marmot", "Otter", "Clover", "Ember", "Finch", "Tide", "Bramble", "Lamp", "Poppy",
  "Swallow", "Sundial", "Quill", "Hedgehog", "Trellis", "Rooster", "Weathervane", "Kingfisher", "Pigeon", "Lighthouse",
];
export const NAME_LISTS = { adj: NAME_ADJECTIVES, noun: NAME_NOUNS };

// "adj:3" -> "Gentle", or null if it isn't a word we know.
export function nameWord(id) {
  const m = /^(adj|noun):(\d{1,3})$/.exec(String(id || ""));
  const w = m && NAME_LISTS[m[1]][Number(m[2])];
  return w || null;
}
export function nameText(a, b) {
  const x = nameWord(a), y = nameWord(b);
  return x && y ? `${x} ${y}` : null;
}
// First word must be an adjective and the second a noun for now (so every name reads well).
export const checkName = (a, b) => nameWord(a) && nameWord(b) && /^adj:/.test(a) && /^noun:/.test(b);

// ---------- weather for bands nobody held ----------
// A stand-in city for each band (index 0 = solar UTC+12 ... 23 = UTC-11), each one inside its band's 15 degrees of
// longitude, used only to colour a gap in a finished lap with "the weather somewhere in that band".
export const BAND_CITIES = [
  ["Auckland", -36.85, 174.76], ["Noumea", -22.27, 166.45], ["Sydney", -33.87, 151.21], ["Tokyo", 35.68, 139.69],
  ["Beijing", 39.9, 116.4], ["Bangkok", 13.75, 100.5], ["Dhaka", 23.8, 90.4], ["Tashkent", 41.3, 69.24],
  ["Dubai", 25.2, 55.27], ["Baghdad", 33.31, 44.36], ["Cairo", 30.04, 31.24], ["Berlin", 52.52, 13.4],
  ["London", 51.5, -0.13], ["Reykjavik", 64.15, -21.94], ["Fernando de Noronha", -3.85, -32.42], ["Sao Paulo", -23.55, -46.63],
  ["Manaus", -3.12, -60.02], ["Bogota", 4.71, -74.07], ["Chicago", 41.88, -87.63], ["Denver", 39.74, -104.99],
  ["Los Angeles", 34.05, -118.24], ["Whitehorse", 60.72, -135.05], ["Papeete", -17.54, -149.57], ["Pago Pago", -14.28, -170.7],
];
