import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "../engine/baton.js";

const L = Date.parse("2026-01-01T18:00:00Z");

test("bands come from longitude, with the date line joined up", () => {
  assert.equal(B.bandFromLon(0), 12);         // UTC+0
  assert.equal(B.bandFromLon(139.7), 3);      // Tokyo, UTC+9
  assert.equal(B.bandFromLon(-155.5), 22);    // Hilo, UTC-10
  assert.equal(B.bandFromLon(179), 0);        // +12
  assert.equal(B.bandFromLon(-179), 0);       // -12 is +12
  assert.equal(B.bandLabel(0), "solar UTC+12");
  assert.equal(B.bandLabel(23), "solar UTC-11");
  assert.equal(B.bandFromOffset(13), 23);     // wraps
  assert.equal(B.bandFromOffset("x"), null);
});

test("the baton moves west one band an hour and each window lasts two", () => {
  assert.equal(B.opensAt(L, 1, 0), L);
  assert.equal(B.opensAt(L, 1, 12), L + 12 * B.HOUR);
  assert.equal(B.closesAt(L, 1, 12), L + 14 * B.HOUR);
  assert.equal(B.lapClosesAt(L, 1), L + 25 * B.HOUR);
  assert.equal(B.currentLap(L, L - 1), 0);
  assert.equal(B.currentLap(L, L), 1);
  assert.equal(B.currentLap(L, L + 24 * B.HOUR), 2);
  assert.equal(B.lastClosedLap(L, L + 24 * B.HOUR), 0);
  assert.equal(B.lastClosedLap(L, L + 25 * B.HOUR), 1);
});

test("a band's window is found for any moment, including before launch and between laps", () => {
  const w = B.windowFor(L, 12, L + 13 * B.HOUR);
  assert.deepEqual([w.lap, w.open], [1, true]);
  const after = B.windowFor(L, 12, L + 15 * B.HOUR);
  assert.deepEqual([after.lap, after.open, after.opensAt], [2, false, L + 36 * B.HOUR]);
  const pre = B.windowFor(L, 12, L - 5 * B.HOUR);
  assert.deepEqual([pre.lap, pre.open], [1, false]);
  // band 0's window for lap 2 starts as lap 1's last bands are still finishing
  assert.equal(B.windowFor(L, 0, L + 24 * B.HOUR).lap, 2);
});

test("stamps are indices; every slot can be blank", () => {
  assert.deepEqual(B.checkStamp({}), { color: null, note: null });
  assert.deepEqual(B.checkStamp({ color: 3, note: "tension" }), { color: 3, note: "tension" });
  assert.ok(B.checkStamp({ color: 12 }).error);
  assert.ok(B.checkStamp({ color: "red" }).error);
  assert.ok(B.checkStamp({ note: "loud" }).error);
});

test("weather codes become plain sky words", () => {
  assert.equal(B.skyFromWmo(0), "clear");
  assert.equal(B.skyFromWmo(3), "cloud");
  assert.equal(B.skyFromWmo(61), "rain");
  assert.equal(B.skyFromWmo(73), "snow");
  assert.equal(B.skyFromWmo(99), "storm");
  assert.equal(B.skyFromWmo(null), "unknown");
});
