import assert from "node:assert/strict";
import test from "node:test";
import {
  isSemMargemTagName,
  nextSemMargemReturnWindow,
  semMargemAutomaticTaskId,
  todaySemMargemReturnWindow
} from "./sem-margem-return";

test("recognizes only exact Sem margem tag name", () => {
  assert.equal(isSemMargemTagName("Sem margem"), true);
  assert.equal(isSemMargemTagName(" sem margem "), true);
  assert.equal(isSemMargemTagName("Sem margem manual"), false);
  assert.equal(isSemMargemTagName("Margem"), false);
});

test("new Sem margem before day 23 schedules next month day 23", () => {
  const result = nextSemMargemReturnWindow(new Date("2026-11-16T12:00:00Z"));
  assert.equal(result.dueAt.toISOString(), "2026-12-23T11:00:00.000Z");
  assert.equal(result.dayStart.toISOString(), "2026-12-23T03:00:00.000Z");
  assert.equal(result.nextDay.toISOString(), "2026-12-24T03:00:00.000Z");
});

test("new Sem margem on day 23 also schedules next month", () => {
  const result = nextSemMargemReturnWindow(new Date("2026-11-23T12:00:00Z"));
  assert.equal(result.dueAt.toISOString(), "2026-12-23T11:00:00.000Z");
});

test("new Sem margem after day 23 crosses year boundary", () => {
  const result = nextSemMargemReturnWindow(new Date("2026-12-30T12:00:00Z"));
  assert.equal(result.dueAt.toISOString(), "2027-01-23T11:00:00.000Z");
});

test("historical Sem margem backfill uses today in Sao Paulo", () => {
  const result = todaySemMargemReturnWindow(new Date("2026-11-23T12:00:00Z"));
  assert.equal(result.dueAt.toISOString(), "2026-11-23T11:00:00.000Z");
  assert.equal(result.dayStart.toISOString(), "2026-11-23T03:00:00.000Z");
  assert.equal(result.nextDay.toISOString(), "2026-11-24T03:00:00.000Z");
});

test("automatic task id is stable for the same client and turnover", () => {
  const dueAt = new Date("2026-12-23T11:00:00.000Z");
  const first = semMargemAutomaticTaskId("company-a", "contact-a", dueAt);
  const second = semMargemAutomaticTaskId("company-a", "contact-a", dueAt);
  assert.equal(first, second);
  assert.notEqual(first, semMargemAutomaticTaskId("company-a", "contact-b", dueAt));
});
