import { test } from "node:test";
import assert from "node:assert/strict";
import { sunDay, sunEvent, sunReport } from "../engine/sun.js";

const MIN = 60000;
const near = (a, b, mins, msg) => assert.ok(Math.abs(a - b) <= mins * MIN, `${msg}: off by ${((a - b) / MIN).toFixed(1)} min`);

test("sunrise and sunset match known values within a few minutes", () => {
  // London, summer solstice 2026: sunrise ~03:43 UTC, sunset ~20:21 UTC
  let d = sunDay(51.5, -0.13, Date.UTC(2026, 5, 21, 12));
  near(d.rise, Date.UTC(2026, 5, 21, 3, 43), 4, "London rise");
  near(d.set, Date.UTC(2026, 5, 21, 20, 21), 4, "London set");
  // Honolulu, Oct 15: solar noon ~12:17 HST, half-day ~5h50m: sunrise ~06:27 HST = 16:27 UTC, sunset ~18:07 HST = 04:07 UTC next day
  d = sunDay(21.3, -157.9, Date.UTC(2026, 9, 15, 22));
  near(d.rise, Date.UTC(2026, 9, 15, 16, 27), 4, "Honolulu rise");
  near(d.set, Date.UTC(2026, 9, 16, 4, 7), 4, "Honolulu set");
  // Sydney, Dec 21: sunrise ~05:41 AEDT = 18:41 UTC the day before
  d = sunDay(-33.87, 151.2, Date.UTC(2026, 11, 20, 20));
  near(d.rise, Date.UTC(2026, 11, 20, 18, 41), 5, "Sydney rise");
});

test("the day gets longer going into summer and shorter going into winter, and by a plausible amount", () => {
  const spring = sunReport(40, -100, Date.UTC(2026, 2, 28, 18));
  assert.ok(spring.delta > 90000 && spring.delta < 200000, "about 2-3 minutes longer a day at 40N in spring");
  const autumn = sunReport(40, -100, Date.UTC(2026, 9, 15, 18));
  assert.ok(autumn.delta < -90000 && autumn.delta > -200000);
});

test("polar day and polar night have no sunrise", () => {
  const night = sunDay(80, 15, Date.UTC(2026, 11, 21, 12));
  assert.deepEqual([night.polar, night.rise], ["night", null]);
  const day = sunDay(80, 15, Date.UTC(2026, 5, 21, 12));
  assert.deepEqual([day.polar, day.rise], ["day", null]);
  assert.equal(sunReport(80, 15, Date.UTC(2026, 5, 21, 12)).delta, null);
});

test("solstices and equinoxes are found on the right days, and not on ordinary ones", () => {
  assert.equal(sunEvent(0, Date.UTC(2026, 5, 21, 12)), "solstice");
  assert.equal(sunEvent(0, Date.UTC(2026, 11, 21, 12)), "solstice");
  assert.equal(sunEvent(0, Date.UTC(2026, 2, 20, 12)), "equinox");
  assert.equal(sunEvent(0, Date.UTC(2026, 8, 23, 12)), "equinox");
  assert.equal(sunEvent(0, Date.UTC(2026, 9, 15, 12)), null);
  assert.equal(sunEvent(0, Date.UTC(2026, 3, 10, 12)), null);
});
