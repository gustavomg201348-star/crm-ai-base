import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { assertOpenCreditCommercialOperationTestDatabase } from "./opencredit-commercial-operation-postgres.guard";

assertOpenCreditCommercialOperationTestDatabase(process.env);
async function main() {
  const { prisma: db } = await import("./db");
  const { hashPassword, createSessionToken } = await import("./auth");
  const routes = await import("../app/api/tasks/route");
  const patch = await import("../app/api/tasks/[id]/route");
  const contacts = await import("../app/api/tasks/contacts/route");
  const conversations = await import("../app/api/tasks/[id]/conversations/route");
  const exporter = await import("../app/api/tasks/export/route");
  const dashboard = await import("../app/api/dashboard/route");
  const { localDay, saoPauloDate, shiftDate } = await import("./agenda-policy");
  const { semMargemAutomaticTaskId } = await import("./sem-margem-return");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw Error("EXTERNAL_TRANSPORT_FORBIDDEN"); };
  after(async () => { globalThis.fetch = originalFetch; await db.$disconnect(); });
  const company = await db.company.create({ data: { name: "Agenda synthetic" } });
  const foreign = await db.company.create({ data: { name: "Foreign synthetic" } });
  const passwordHash = hashPassword("local-agenda-synthetic-password");
  const user = (role: string, companyId = company.id) => db.user.create({ data: {
    companyId, role, name: "Synthetic " + role, email: randomUUID() + "@invalid.test", passwordHash,
  } });
  const admin = await user("ADMIN"), supervisor = await user("SUPERVISOR"), agent = await user("AGENT"), other = await user("AGENT"), foreignAdmin = await user("ADMIN", foreign.id);
  const contact = await db.contact.create({ data: { companyId: company.id, ownerId: agent.id, name: "Cliente sintético", phone: "5511999999999" } });
  const otherContact = await db.contact.create({ data: { companyId: company.id, ownerId: other.id, name: "Outra carteira", phone: "5511888888888" } });
  const foreignContact = await db.contact.create({ data: { companyId: foreign.id, name: "Outro tenant", phone: "5511777777777" } });
  const dueAt = new Date(Date.now() + 3600000).toISOString(), key = randomUUID();
  type User = typeof admin;
  function req(path: string, who: User | null = admin, body?: unknown, extra: Record<string, string> = {}) {
    return new NextRequest("http://localhost:3000" + path, { method: body ? "POST" : "GET",
      headers: { ...(who ? { cookie: "crm_session=" + createSessionToken({ ...who, role: who.role as "ADMIN" }, who.passwordHash) } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}), ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  const payload = { contactId: contact.id, title: "Retorno: Proposta", note: "Observação sintética", dueAt, assigneeId: agent.id };
  const filters = () => new URLSearchParams({ view: "agenda", from: localDay(saoPauloDate()).toISOString(),
    to: localDay(shiftDate(saoPauloDate(), 32)).toISOString() });
  const listing = async (who = admin, extra = {}) => routes.GET(req("/api/tasks?" + new URLSearchParams({ ...Object.fromEntries(filters()), ...extra }), who));
  const update = (id: string, body: object, who = admin) => patch.PATCH(req("/api/tasks/" + id, who, body), { params: Promise.resolve({ id }) });
  let targetId = "";
  test("authenticated APIs deny unauthenticated requests and cross-origin mutations", async () => {
    assert.equal((await routes.GET(req("/api/tasks", null))).status, 401);
    assert.equal((await routes.POST(req("/api/tasks", null, payload))).status, 401);
    assert.equal((await routes.POST(req("/api/tasks", admin, payload, { origin: "https://evil.invalid" }))).status, 403);
    const { agendaBody } = await import("./agenda-http");
    assert.deepEqual(await agendaBody(req("/api/tasks", admin, payload, { origin: "https://agenda.invalid", host: "agenda.invalid" })), payload);
    await assert.rejects(() => agendaBody(req("/api/tasks", admin, payload, { origin: "https://evil.invalid", host: "agenda.invalid", "x-forwarded-host": "evil.invalid" })));
  });
  test("create and concurrent request replay persist one task and one activity", async () => {
    const results = await Promise.all([routes.POST(req("/api/tasks", admin, payload, { "Idempotency-Key": key })),
      routes.POST(req("/api/tasks", admin, payload, { "Idempotency-Key": key }))]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 201]);
    const result = await results[0].json(); targetId = result.task.id;
    assert.equal(await db.task.count({ where: { companyId: company.id } }), 1);
    assert.equal(await db.contactActivity.count({ where: { contactId: contact.id, type: "TASK_CREATED" } }), 1);
    assert.equal((await routes.POST(req("/api/tasks", admin, { ...payload, title: "Different" }, { "Idempotency-Key": key }))).status, 409);
  });
  test("agent visibility, assignee filters, contact search and tenant isolation are enforced", async () => {
    await db.task.create({ data: { companyId: company.id, contactId: otherContact.id, assigneeId: other.id, title: "Other task", dueAt: new Date(dueAt) } });
    const response = await listing(agent); const result = await response.json();
    assert.equal(result.total, 1); assert.equal(result.tasks[0].id, targetId);
    assert.equal((await (await listing(agent, { assigneeId: other.id })).json()).total, 0);
    assert.equal((await (await routes.GET(req("/api/tasks?status=ALL", agent))).json()).tasks.length, 1);
    assert.equal((await (await contacts.GET(req("/api/tasks/contacts", agent))).json()).contacts.length, 1);
    assert.equal((await update(targetId, { note: "not mine" }, other)).status, 404);
    assert.equal((await update(targetId, { note: "foreign" }, foreignAdmin)).status, 404);
    assert.equal((await routes.POST(req("/api/tasks", agent, { ...payload, contactId: foreignContact.id }))).status, 404);
    assert.equal((await routes.POST(req("/api/tasks", agent, { ...payload, assigneeId: other.id }))).status, 403);
    assert.equal((await (await listing(supervisor)).json()).total, 2);
  });
  test("edit, reschedule, complete and cancel use the same persisted record and preserve history", async () => {
    const before = await db.task.findUniqueOrThrow({ where: { id: targetId } });
    const response = await update(targetId, { title: "Retorno: Atualizado", dueAt: new Date(Date.now() + 7200000).toISOString(), expectedUpdatedAt: before.updatedAt.toISOString() }, agent);
    assert.equal(response.status, 200);
    assert.equal((await update(targetId, { note: "stale", expectedUpdatedAt: before.updatedAt.toISOString() })).status, 409);
    const current = await db.task.findUniqueOrThrow({ where: { id: targetId } });
    const results = await Promise.all([update(targetId, { status: "DONE", expectedUpdatedAt: current.updatedAt.toISOString() }),
      update(targetId, { status: "CANCELLED", expectedUpdatedAt: current.updatedAt.toISOString() })]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    assert.equal((await update(targetId, { status: "DONE" })).status, 200);
    const activities = await db.contactActivity.count({ where: { contactId: contact.id, type: "TASK_DONE" } });
    assert.equal((await update(targetId, { status: "DONE" })).status, 200);
    assert.equal(await db.contactActivity.count({ where: { contactId: contact.id, type: "TASK_DONE" } }), activities);
    assert.equal((await update(targetId, { status: "CANCELLED" })).status, 200);
    assert.equal(await db.task.count({ where: { id: targetId, status: "CANCELLED" } }), 1);
    assert.equal((await (await routes.GET(req("/api/tasks?status=PENDING", agent))).json()).tasks.length, 0);
  });
  test("automatic and legacy origins are distinguished without changing the automatic schedule", async () => {
    const date = new Date(dueAt);
    const id = semMargemAutomaticTaskId(company.id, contact.id, date);
    await db.task.create({ data: { id, companyId: company.id, contactId: contact.id, assigneeId: agent.id, title: "Retorno: Sem margem", dueAt: date } });
    const result = await (await listing()).json();
    assert.equal(result.tasks.find((t: { id: string }) => t.id === id).origin, "AUTOMATIC");
    assert(result.tasks.some((t: { origin: string }) => t.origin === "UNKNOWN"));
    assert.equal((await (await listing(admin, { origin: "AUTOMATIC" })).json()).total, 1);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id } })).dueAt.toISOString(), dueAt);
  });
  test("search, status, exact counters and keyset pagination operate over the same filters", async () => {
    const date = new Date(dueAt);
    await db.task.createMany({ data: Array.from({ length: 53 }, (_, i) => ({ companyId: company.id, contactId: contact.id,
      assigneeId: agent.id, title: "Synthetic page " + i, dueAt: date, status: "PENDING" })) });
    const first = await (await listing(admin, { search: "Cliente", status: "PENDING" })).json();
    assert.equal(first.tasks.length, 50); assert.equal(first.total, 54); assert(first.nextCursor);
    const second = await (await listing(admin, { search: "Cliente", status: "PENDING", cursor: first.nextCursor })).json();
    assert.equal(second.tasks.length, 4); assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.tasks, ...second.tasks].map(t => t.id)).size, 54);
    assert.equal(first.counters.completed, 0);
    assert.equal((await (await listing(admin, { status: "CANCELLED" })).json()).total, 1);
  });
  test("conversation navigation returns only authorized choices, with channel labels", async () => {
    const channel = await db.channel.create({ data: { companyId: company.id, name: "Canal sintético", provider: "meta", type: "whatsapp" } });
    const a = await db.conversation.create({ data: { contactId: contact.id, channelId: channel.id, agentId: agent.id } });
    await db.conversation.create({ data: { contactId: contact.id, channel: "WHATSAPP", agentId: other.id } });
    const context = { params: Promise.resolve({ id: targetId }) };
    const rows = await (await conversations.GET(req("/api/tasks/" + targetId + "/conversations", agent), context)).json();
    assert.equal(rows.conversations.length, 1); assert.equal(rows.conversations[0].id, a.id);
    assert.equal(rows.conversations[0].channelRef.name, "Canal sintético");
    assert.equal((await conversations.GET(req("/api/tasks/" + targetId + "/conversations", other), context)).status, 404);
  });
  test("export shares Agenda filters, remains administrative and neutralizes spreadsheet formulas", async () => {
    await db.task.update({ where: { id: targetId }, data: { title: "=1+1" } });
    const params = new URLSearchParams({ ...Object.fromEntries(filters()), status: "CANCELLED" });
    assert.equal((await exporter.GET(req("/api/tasks/export?" + params, agent))).status, 403);
    const result = await exporter.GET(req("/api/tasks/export?" + params, supervisor));
    assert.equal(result.status, 200);
    const workbook = XLSX.read(Buffer.from(await result.arrayBuffer()), { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[workbook.SheetNames[0]]);
    assert.equal(rows.length, 1); assert.notEqual(rows[0].Motivo, "=1+1");
  });
  test("Dashboard observes completed records and notification rows are preserved", async () => {
    const count = await db.notification.count({ where: { companyId: company.id } });
    const response = await dashboard.GET(req("/api/dashboard", admin));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.returns.totalPending, await db.task.count({ where: { companyId: company.id, status: "PENDING" } }));
    assert(!result.returns.items.some((item: { id: string }) => item.id === targetId));
    assert.equal(await db.notification.count({ where: { companyId: company.id } }), count);
  });
  test("invalid commands and foreign filters do not mutate records or reveal another tenant", async () => {
    const count = await db.task.count({ where: { companyId: company.id } });
    for (const body of [{ ...payload, title: "" }, { ...payload, dueAt: "bad" }, { ...payload, companyId: foreign.id },
      { ...payload, note: "a".repeat(4001) }]) assert.equal((await routes.POST(req("/api/tasks", admin, body))).status, 400);
    assert.equal((await update(targetId, { contactId: foreignContact.id })).status, 400);
    assert.equal((await (await listing(foreignAdmin)).json()).total, 0);
    assert.equal((await listing(admin, { from: "bad" })).status, 400);
    assert.equal(await db.task.count({ where: { companyId: company.id } }), count);
  });
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
