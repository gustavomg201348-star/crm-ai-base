import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionUser } from "./auth";
import { agendaDateLabel, agendaPeriod, agendaWhere, localDay, parseAgendaFilters, saoPauloDate, shiftDate, taskOrigin, taskScope } from "./agenda-policy";
const actor: SessionUser = { id: "agent", companyId: "company", name: "Synthetic", email: "synthetic@invalid.test", role: "AGENT" };
test("São Paulo date boundaries are independent of the terminal timezone", () => {
  assert.equal(saoPauloDate(new Date("2026-11-27T02:59:59Z")), "2026-11-26");
  assert.equal(saoPauloDate(new Date("2026-11-27T03:00:00Z")), "2026-11-27");
  assert.equal(localDay("2026-11-27").toISOString(), "2026-11-27T03:00:00.000Z");
  assert.equal(shiftDate("2026-12-31", 1), "2027-01-01");
  assert.throws(() => localDay("2026-02-30"));
});
test("daily, Monday-based weekly and monthly periods cover boundaries", () => {
  assert.deepEqual(agendaPeriod("2026-11-29", "week"), { from: "2026-11-23", to: "2026-11-30" });
  assert.deepEqual(agendaPeriod("2026-12-31", "month"), { from: "2026-12-01", to: "2027-01-01" });
  assert.deepEqual(agendaPeriod("2026-11-27", "day"), { from: "2026-11-27", to: "2026-11-28" });
});
test("calendar labels remain in São Paulo even when a different timezone is requested", () => {
  assert.equal(agendaDateLabel("2026-11-27", { day: "2-digit", timeZone: "Pacific/Kiritimati" }), "27");
  assert.match(agendaDateLabel("2026-11-27", { weekday: "long", timeZone: "Pacific/Kiritimati" }), /sexta/);
});
test("origin uses only the generated identifier convention, never title or note guesses", () => {
  assert.equal(taskOrigin("legacy"), "UNKNOWN");
  assert.equal(taskOrigin("agenda-" + "a".repeat(64)), "MANUAL");
  assert.equal(taskOrigin("sem-margem-" + "b".repeat(32)), "AUTOMATIC");
  assert.equal(taskOrigin("sem-margem-manual"), "UNKNOWN");
});
test("agent scope cannot be removed by a client assignee filter", () => {
  assert.deepEqual(taskScope(actor), { companyId: "company", contact: { companyId: "company" }, assigneeId: "agent" });
  const filters = parseAgendaFilters(new URLSearchParams({ from: "2026-11-01", to: "2026-12-01", assigneeId: "other" }));
  const conditions = agendaWhere(actor, filters).AND;
  assert.ok(Array.isArray(conditions));
  assert.deepEqual(conditions[0], taskScope(actor));
  assert.equal(taskScope({ ...actor, role: "SUPERVISOR" }).assigneeId, undefined);
});
test("invalid filters, dates, oversized range and forged cursor fail closed", () => {
  for (const override of <Record<string, string>[]>[{ from: "bad" }, { to: "2026-01-01" }, { to: "2030-01-01" }, { status: "BAD" },
    { type: "BAD" }, { origin: "BAD" }, { cursor: '{"id":"a","dueAt":"bad"}' }]) {
    assert.throws(() => parseAgendaFilters(new URLSearchParams({ from: "2026-11-01", to: "2026-12-01", ...override })));
  }
});
