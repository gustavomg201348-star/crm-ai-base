import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { ingestOpenCreditLead } from "./opencredit-lead.service";
import { parseOpenCreditAssignedLead } from "./opencredit-webhook-contract";
import { createOpenCreditWebhookHandler } from "./opencredit-webhook-handler";
import { createOpenCreditPublicWebhookId, prepareOpenCreditWebhookSecret, resolveOpenCreditWebhookSecret } from "./opencredit-secrets";

// Fail before constructing the client. Never print a URL, password or key.
function assertDisposableCiDatabase() {
  if (process.env.OPENCREDIT_POSTGRES_TEST !== "1" || process.env.CI !== "true" ||
      process.env.GITHUB_ACTIONS !== "true") throw new Error("OPENCREDIT_TEST_REQUIRES_EXPLICIT_GITHUB_CI");
  let url: URL;
  try { url = new URL(process.env.DATABASE_URL ?? ""); }
  catch { throw new Error("OPENCREDIT_TEST_DATABASE_URL_INVALID"); }
  assert.ok(url.protocol === "postgresql:", "PostgreSQL test protocol required");
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "Only loopback test host permitted");
  assert.ok(url.port === "5432" && url.pathname === "/qevora_ci", "Only disposable CI database permitted");
  assert.ok(url.username === "qevora_ci" && url.password === "qevora_ci_password", "Only fictitious CI credentials permitted");
  assert.ok(url.search === "?schema=public" && !url.hash, "Only public CI schema permitted");
}
assertDisposableCiDatabase();

const db = new PrismaClient({ log: [{ level: "query", emit: "event" }] });
// Query text only, in memory. Do not capture parameters or emit query logs.
let recordQueries: string[] | null = null;
db.$on("query", event => { recordQueries?.push(event.query); });
after(async () => { await db.$disconnect(); });
const encryption = { activeKeyId: "v1", keys: { v1: randomBytes(32) } };

type Fixture = Awaited<ReturnType<typeof createFixture>>;
async function createFixture(companyIds: string[]) {
  const [companyA, companyB] = companyIds;
  await db.company.createMany({ data: companyIds.map(id => ({ id, name: "OpenCredit synthetic CI fixture" })) });
  const secret = randomBytes(32).toString("hex");
  const integration = await db.openCreditIntegration.create({ data: {
    companyId: companyA, enabled: true, publicWebhookId: createOpenCreditPublicWebhookId(),
    webhookSecret: prepareOpenCreditWebhookSecret(secret, encryption)
  } });
  const integrationB = await db.openCreditIntegration.create({ data: {
    companyId: companyB, enabled: true, publicWebhookId: createOpenCreditPublicWebhookId(),
    webhookSecret: prepareOpenCreditWebhookSecret(secret, encryption)
  } });
  const payload = (overrides: Record<string, unknown> = {}) => ({
    event: "lead.assigned", contractVersion: 2, eventId: "synthetic-event", assignedAt: "2026-10-09T17:00:00Z",
    lead: { id: "synthetic-lead" }, client: { name: "Synthetic lead", phone: "11987654321", cpf: "12345678909" },
    ...overrides
  });
  const handler = createOpenCreditWebhookHandler({
    resolveIntegration: publicWebhookId => db.openCreditIntegration.findUnique({
      where: { publicWebhookId }, select: { id: true, companyId: true, enabled: true, webhookSecret: true }
    }),
    resolveSecret: stored => resolveOpenCreditWebhookSecret(stored, encryption),
    ingest: (binding, input, deadline) => ingestOpenCreditLead(db, binding, input, deadline)
  });
  async function send(input = payload(), target = integration) {
    const body = JSON.stringify(input);
    const signature = "sha256=" + createHmac("sha256", secret).update(Buffer.from(body)).digest("hex");
    return handler(new Request("http://localhost/ci-opencredit", {
      method: "POST", headers: { "content-type": "application/json", "x-creditcore-sig": signature }, body
    }), { params: Promise.resolve({ publicWebhookId: target.publicWebhookId }) });
  }
  async function counts() {
    return {
      contacts: await db.contact.count({ where: { companyId: companyA } }),
      leads: await db.openCreditLead.count({ where: { companyId: companyA } }),
      events: await db.openCreditEvent.count({ where: { companyId: companyA } })
    };
  }
  return { companyA, companyB, integration, integrationB, payload, send, counts };
}
async function withFixture(run: (fixture: Fixture) => Promise<void>) {
  const companyIds = ["oc-ci-a-" + randomUUID(), "oc-ci-b-" + randomUUID()];
  try { await run(await createFixture(companyIds)); }
  finally {
    recordQueries = null;
    // Explicit IDs only, reverse FK order. Never truncate or delete all rows.
    const where = { companyId: { in: companyIds } };
    await db.openCreditEvent.deleteMany({ where });
    await db.openCreditLead.deleteMany({ where });
    await db.openCreditIntegration.deleteMany({ where });
    await db.contact.deleteMany({ where });
    await db.company.deleteMany({ where: { id: { in: companyIds } } });
  }
}
async function rejectsPrismaCode(operation: () => Promise<unknown>, code: string) {
  await assert.rejects(operation, error => error instanceof Prisma.PrismaClientKnownRequestError && error.code === code);
}

test("OpenCredit migration and actual table/index/FK definitions", async () => {
  const migration = await db.$queryRaw<Array<{ count: number }>>`
    SELECT count(*)::int AS count FROM "_prisma_migrations"
    WHERE migration_name = '20261009190000_add_opencredit_lead_webhook'
      AND finished_at IS NOT NULL AND rolled_back_at IS NULL
  `;
  assert.equal(migration[0].count, 1);
  const failed = await db.$queryRaw<Array<{ count: number }>>`
    SELECT count(*)::int AS count FROM "_prisma_migrations"
    WHERE finished_at IS NULL AND rolled_back_at IS NULL
  `;
  assert.equal(failed[0].count, 0);
  const tables = await db.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
      AND table_name IN ('OpenCreditIntegration','OpenCreditLead','OpenCreditEvent')
  `;
  assert.equal(tables.length, 3);
  const indexes = await db.$queryRaw<Array<{ table_name: string; unique: boolean; valid: boolean; columns: string[] }>>`
    SELECT t.relname::text AS table_name, i.indisunique AS "unique", i.indisvalid AS valid,
      ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY AS k(n, pos)
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.n ORDER BY k.pos) AS columns
    FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace ns ON ns.oid = t.relnamespace
    WHERE ns.nspname = 'public' AND t.relname IN ('Contact','OpenCreditIntegration','OpenCreditLead','OpenCreditEvent')
      AND i.indpred IS NULL AND i.indexprs IS NULL
  `;
  for (const [table, columns] of [
    ["Contact", ["companyId", "id"]], ["OpenCreditIntegration", ["publicWebhookId"]],
    ["OpenCreditLead", ["companyId", "integrationId", "externalLeadId"]],
    ["OpenCreditEvent", ["integrationId", "eventId"]]
  ] as const) {
    assert.ok(indexes.some(i => i.table_name === table && i.unique && i.valid && JSON.stringify(i.columns) === JSON.stringify(columns)), "Missing required unique column definition");
  }
  const fks = await db.$queryRaw<Array<{ table_name: string; referenced_table: string; columns: string[]; referenced_columns: string[]; delete_action: string; validated: boolean }>>`
    SELECT t.relname::text AS table_name, r.relname::text AS referenced_table,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(n, pos)
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.n ORDER BY k.pos) AS columns,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY AS k(n, pos)
        JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum = k.n ORDER BY k.pos) AS referenced_columns,
      c.confdeltype::text AS delete_action, c.convalidated AS validated
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_class r ON r.oid = c.confrelid JOIN pg_namespace ns ON ns.oid = t.relnamespace
    WHERE ns.nspname = 'public' AND c.contype = 'f'
      AND t.relname IN ('OpenCreditIntegration','OpenCreditLead','OpenCreditEvent')
  `;
  const expected = [
    ["OpenCreditIntegration", ["companyId"], "Company", ["id"]],
    ["OpenCreditLead", ["companyId"], "Company", ["id"]],
    ["OpenCreditLead", ["companyId", "integrationId"], "OpenCreditIntegration", ["companyId", "id"]],
    ["OpenCreditLead", ["companyId", "contactId"], "Contact", ["companyId", "id"]],
    ["OpenCreditEvent", ["companyId"], "Company", ["id"]],
    ["OpenCreditEvent", ["companyId", "integrationId"], "OpenCreditIntegration", ["companyId", "id"]],
    ["OpenCreditEvent", ["companyId", "integrationId", "externalLeadId"], "OpenCreditLead", ["companyId", "integrationId", "externalLeadId"]]
  ] as const;
  for (const [table, columns, reference, referencedColumns] of expected) {
    assert.ok(fks.some(fk => fk.table_name === table && fk.referenced_table === reference && fk.validated &&
      fk.delete_action === "r" && JSON.stringify(fk.columns) === JSON.stringify(columns) &&
      JSON.stringify(fk.referenced_columns) === JSON.stringify(referencedColumns)), "Missing required RESTRICT FK column definition");
  }
});

test("composite tenant FKs reject cross-company Contact, Integration and Event links", async () => withFixture(async f => {
  const contact = await db.contact.create({ data: { companyId: f.companyA, name: "Synthetic A", phone: "11987654321" } });
  await rejectsPrismaCode(() => db.openCreditIntegration.create({ data: {
    companyId: "missing-ci-" + randomUUID(), publicWebhookId: createOpenCreditPublicWebhookId(),
    webhookSecret: f.integration.webhookSecret
  } }), "P2003");
  await rejectsPrismaCode(() => db.openCreditLead.create({ data: {
    companyId: f.companyB, integrationId: f.integrationB.id, externalLeadId: "cross-contact", contactId: contact.id
  } }), "P2003");
  const rejectedLeadScope = {
    companyId: f.companyB, integrationId: f.integrationB.id, externalLeadId: "cross-contact"
  };
  assert.equal(await db.openCreditLead.count({ where: rejectedLeadScope }), 0);
  assert.equal(await db.openCreditLead.count({ where: { ...rejectedLeadScope, contactId: contact.id } }), 0);
  assert.equal(await db.openCreditEvent.count({ where: rejectedLeadScope }), 0);
  assert.equal(await db.openCreditLead.count({ where: { companyId: f.companyB } }), 0);
  assert.equal(await db.openCreditEvent.count({ where: { companyId: f.companyB } }), 0);
  assert.deepEqual(await db.openCreditIntegration.findFirst({
    where: { id: f.integrationB.id, companyId: f.companyB },
    select: { id: true, companyId: true, enabled: true, publicWebhookId: true }
  }), {
    id: f.integrationB.id, companyId: f.companyB, enabled: true,
    publicWebhookId: f.integrationB.publicWebhookId
  });
  assert.deepEqual(await db.contact.findFirst({
    where: { id: contact.id, companyId: f.companyA }, select: { id: true, companyId: true }
  }), { id: contact.id, companyId: f.companyA });
  assert.equal(await db.contact.count({ where: { id: contact.id, companyId: f.companyB } }), 0);
  await rejectsPrismaCode(() => db.openCreditLead.create({ data: {
    companyId: f.companyA, integrationId: f.integrationB.id, externalLeadId: "cross-integration"
  } }), "P2003");
  await rejectsPrismaCode(() => db.openCreditEvent.create({ data: {
    companyId: f.companyA, integrationId: f.integrationB.id, externalLeadId: "missing-lead",
    eventId: "cross-event", eventType: "lead.assigned", contractVersion: 2,
    assignedAt: new Date(), processingStatus: "PROCESSED"
  } }), "P2003");
  await rejectsPrismaCode(() => db.openCreditEvent.create({ data: {
    companyId: f.companyA, integrationId: f.integration.id, externalLeadId: "missing-lead",
    eventId: "missing-reference", eventType: "lead.assigned", contractVersion: 2,
    assignedAt: new Date(), processingStatus: "PROCESSED"
  } }), "P2003");
  assert.deepEqual(await f.counts(), { contacts: 1, leads: 0, events: 0 });
}));

test("actual public ID, external lead and event uniques reject duplicates and permit different integrations", async () => withFixture(async f => {
  await rejectsPrismaCode(() => db.openCreditIntegration.create({ data: {
    companyId: f.companyB, publicWebhookId: f.integration.publicWebhookId, webhookSecret: f.integration.webhookSecret
  } }), "P2002");
  const lead = { companyId: f.companyA, integrationId: f.integration.id, externalLeadId: "unique-lead" };
  await db.openCreditLead.create({ data: lead });
  await rejectsPrismaCode(() => db.openCreditLead.create({ data: lead }), "P2002");
  await db.openCreditLead.create({ data: { ...lead, companyId: f.companyB, integrationId: f.integrationB.id } });
  const event = { ...lead, eventId: "unique-event", eventType: "lead.assigned", contractVersion: 2,
    assignedAt: new Date(), processingStatus: "PROCESSED" };
  await db.openCreditEvent.create({ data: event });
  await rejectsPrismaCode(() => db.openCreditEvent.create({ data: event }), "P2002");
  await db.openCreditEvent.create({ data: { ...event, companyId: f.companyB, integrationId: f.integrationB.id } });
  assert.equal(await db.openCreditEvent.count({ where: { companyId: { in: [f.companyA, f.companyB] } } }), 2);
}));

test("real signed handlers concurrently ingest the same event without duplication", async () => withFixture(async f => {
  const responses = await Promise.all([f.send(), f.send()]);
  const statuses = responses.map(r => r.status);
  console.log(JSON.stringify({ scenario: "opencredit-concurrency", httpStatuses: statuses }));
  assert.deepEqual(statuses, [200, 200]);
  const bodies = await Promise.all(responses.map(r => r.json())) as Array<{ ok: boolean; duplicate: boolean }>;
  assert.ok(bodies.every(b => b.ok));
  assert.equal(bodies.filter(b => b.duplicate).length, 1);
  assert.deepEqual(await f.counts(), { contacts: 1, leads: 1, events: 1 });
}));

test("same event with another lead conflicts; new event reuses existing external lead and Contact", async () => withFixture(async f => {
  assert.equal((await f.send()).status, 200);
  const before = await db.openCreditEvent.findUniqueOrThrow({ where: {
    integrationId_eventId: { integrationId: f.integration.id, eventId: "synthetic-event" }
  } });
  assert.equal((await f.send(f.payload({ lead: { id: "different-lead" } }))).status, 409);
  const afterEvent = await db.openCreditEvent.findUniqueOrThrow({ where: { id: before.id } });
  assert.deepEqual(afterEvent, before);
  assert.equal((await f.send(f.payload({ eventId: "new-event" }))).status, 200);
  assert.deepEqual(await f.counts(), { contacts: 1, leads: 1, events: 2 });
}));

test("real transaction rolls back successful Contact/Lead inserts when final event data fails", async () => withFixture(async f => {
  const input = parseOpenCreditAssignedLead(f.payload());
  // Deliberate fault injection at the service boundary, NOT a valid webhook.
  // Int overflow fails the final event operation after earlier real inserts.
  input.contractVersion = 2_147_483_648;
  const queries: string[] = [];
  recordQueries = queries;
  try {
    await assert.rejects(
      () => ingestOpenCreditLead(db, { id: f.integration.id, companyId: f.companyA }, input),
      error => {
        // Prisma 5.22 binds Prisma Int as INT8; PostgreSQL rejects storing it
        // in INTEGER with SQLSTATE 22003. The native connector wraps that
        // unmapped PostgresError in UnknownRequestError, not P2020/P2010.
        // Sources: prisma-engines/5.22.0/.../model_extensions/scalar_field.rs
        // and quaint/src/connector/postgres/error.rs. Check only the machine
        // code carried in the diagnostic, never generic/full error wording.
        return error instanceof Prisma.PrismaClientUnknownRequestError &&
          /PostgresError\s*\{\s*code:\s*"22003"\s*,/.test(error.message);
      }
    );
  }
  finally { recordQueries = null; }
  assert.ok(queries.some(q => q.includes('INSERT INTO "public"."Contact"')), "Contact insert must actually have run");
  assert.ok(queries.some(q => q.includes('INSERT INTO "public"."OpenCreditLead"')), "Lead insert must actually have run");
  assert.ok(queries.some(q => q.trim().toUpperCase() === "ROLLBACK"), "Database rollback must be observed");
  assert.deepEqual(await f.counts(), { contacts: 0, leads: 0, events: 0 });
}));

test("actual RESTRICT rejects deletion of linked Contact, Integration and Company", async () => withFixture(async f => {
  assert.equal((await f.send()).status, 200);
  const lead = await db.openCreditLead.findUniqueOrThrow({ where: {
    companyId_integrationId_externalLeadId: { companyId: f.companyA, integrationId: f.integration.id, externalLeadId: "synthetic-lead" }
  } });
  assert.ok(lead.contactId);
  await rejectsPrismaCode(() => db.contact.delete({ where: { id: lead.contactId! } }), "P2003");
  await rejectsPrismaCode(() => db.openCreditIntegration.delete({ where: { id: f.integration.id } }), "P2003");
  await rejectsPrismaCode(() => db.company.delete({ where: { id: f.companyA } }), "P2003");
  assert.deepEqual(await f.counts(), { contacts: 1, leads: 1, events: 1 });
}));

test("foreign DDIs preserve external leads without Brazilian Contacts", async () => withFixture(async f => {
  for (const [index, phone] of [[0, "+12125550199"], [1, "+351912345678"]] as const) {
    assert.equal((await f.send(f.payload({ eventId: "foreign-" + index, lead: { id: "foreign-" + index }, client: { phone } }))).status, 200);
  }
  const leads = await db.openCreditLead.findMany({ where: { companyId: f.companyA } });
  assert.equal(leads.length, 2);
  assert.ok(leads.every(l => l.contactId === null));
  assert.deepEqual(await f.counts(), { contacts: 0, leads: 2, events: 2 });
}));

test("real handler accepts valid calendar dates and rejects impossible dates before persistence", async () => withFixture(async f => {
  for (const [index, assignedAt] of [[0, "2026-02-29T17:00:00Z"], [1, "2026-02-30T17:00:00Z"]] as const) {
    assert.equal((await f.send(f.payload({ assignedAt, eventId: "invalid-date-" + index }))).status, 422);
  }
  assert.deepEqual(await f.counts(), { contacts: 0, leads: 0, events: 0 });
  for (const [index, assignedAt] of [[0, "2026-02-28T17:00:00Z"], [1, "2028-02-29T17:00:00Z"]] as const) {
    assert.equal((await f.send(f.payload({ assignedAt, eventId: "valid-date-" + index }))).status, 200);
  }
  assert.deepEqual(await f.counts(), { contacts: 1, leads: 1, events: 2 });
}));
