import assert from "node:assert/strict";
import test from "node:test";
import { isSemMargemTagName, nextSemMargemReturnWindow } from "./sem-margem-return";

test("recognizes only exact Sem margem tag name", () => {
  assert.equal(isSemMargemTagName("Sem margem"), true);
  assert.equal(isSemMargemTagName(" sem margem "), true);
  assert.equal(isSemMargemTagName("Sem margem manual"), false);
  assert.equal(isSemMargemTagName("Margem"), false);
});

test("before day 24 schedules current month day 24 at 09:00 Sao Paulo", () => {
  const result = nextSemMargemReturnWindow(new Date("2026-11-16T12:00:00Z"));
  assert.equal(result.dueAt.toISOString(), "2026-11-24T12:00:00.000Z");
  assert.equal(result.dayStart.toISOString(), "2026-11-24T03:00:00.000Z");
  assert.equal(result.nextDay.toISOString(), "2026-11-25T03:00:00.000Z");
});

test("on day 24 schedules next month", () => {
  const result = nextSemMargemReturnWindow(new Date("2026-11-24T12:00:00Z"));
  assert.equal(result.dueAt.toISOString(), "2026-12-24T12:00:00.000Z");
});

test("after day 24 crosses year boundary", () => {
  const result = nextSemMargemReturnWindow(new Date("2026-12-30T12:00:00Z"));
  assert.equal(result.dueAt.toISOString(), "2027-01-24T12:00:00.000Z");
});
