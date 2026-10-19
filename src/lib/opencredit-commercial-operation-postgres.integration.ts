import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { assertOpenCreditCommercialOperationTestDatabase } from "./opencredit-commercial-operation-postgres.guard";

assertOpenCreditCommercialOperationTestDatabase(process.env);
const db = new PrismaClient({ log: [] });
after(async () => { await db.$disconnect(); });
const op = "OpenCreditCommercialOperation"; const event = op + "Event";
const companyFk = "OpenCreditCommercialOperation_companyId_fkey";
const identityFk = "OpenCreditCommercialOperation_remoteIdentityId_companyId_p_fkey";
const creatorFk = "OpenCreditCommercialOperation_createdByUserId_fkey";
const operationFk = "OpenCreditCommercialOperationEvent_operationId_companyId_p_fkey";
const actorFk = "OpenCreditCommercialOperationEvent_actorUserId_fkey";
const syntheticScope = () => "synthetic-" + randomUUID().replace(/\d/g, d => String.fromCharCode(103 + Number(d)));
const intent = () => "synthetic-intent-" + randomUUID();

async function fixture() {
  const [a, b, platform] = ["a", "b", "platform"].map(p => "oc-operation-ci-" + p + "-" + randomUUID());
  await db.company.createMany({ data: [a, b, platform].map(id => ({ id, name: "Synthetic operation storage fixture" })) });
  const user = () => db.user.create({ data: { companyId: platform, name: "Synthetic platform actor", email: randomUUID() + "@example.invalid", passwordHash: "NOT_A_REAL_PASSWORD_HASH", role: "ADMIN" } });
  const parentCreator = await user(); const creator = await user(); const actor = await user();
  const scope = syntheticScope();
  const identityFor = async (companyId: string, providerScope: string, normalizedCpf = "00000000000") => {
    await db.openCreditCommercialAccess.create({ data: { companyId, providerScope, changedByUserId: parentCreator.id } });
    const contact = await db.contact.create({ data: { companyId, name: "Synthetic fixture", phone: "SYNTHETIC_NOT_A_PHONE" } });
    // Invalid repeated-digit snapshot required only by the parent, never copied to ledger.
    return db.openCreditRemoteIdentity.create({ data: { companyId, providerScope, contactId: contact.id, normalizedCpf, createdByUserId: parentCreator.id } });
  };
  const identity = await identityFor(a, scope);
  const data = { companyId: a, remoteIdentityId: identity.id, providerScope: scope, operationKind: "CLIENT_PROFILE_UPSERT", intentKey: intent(), createdByUserId: creator.id };
  const eventData = (operationId: string) => ({ operationId, companyId: a, providerScope: scope, actorUserId: actor.id, action: "PREPARED", previousState: null, nextState: "PREPARED", revision: 0 });
  return { a, b, platform, parentCreator, creator, actor, scope, identity, identityFor, data, eventData };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function material(name: string, run: (f: Fixture) => Promise<void>) {
  test(name, async () => {
    try { await run(await fixture()); } catch (error) {
      const code = error instanceof Prisma.PrismaClientKnownRequestError && /^P\d{4}$/.test(error.code) ? error.code : "ASSERTION_OR_OTHER_FAILURE";
      throw new Error("OPENCREDIT_COMMERCIAL_OPERATION_MATERIAL_FAILED:" + code);
    }
    // No Event cleanup/deletion bypass. Fixtures remain only until disposable DB destruction.
  });
}
async function rejectsFk(run: () => Promise<unknown>, model: string, expected: string) {
  try { await run(); } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003"
      && (error.meta?.modelName === undefined || error.meta.modelName === model)
      && [expected, expected + " (index)"].includes(String(error.meta?.field_name))) return;
    if (error instanceof Prisma.PrismaClientUnknownRequestError && new RegExp("\\b" + expected + "\\b").test(error.message)
      && (/code:\s*"(?:23001|23503)"/.test(error.message) || error.message.includes("violates RESTRICT setting of foreign key constraint") || error.message.includes("violates foreign key constraint"))) return;
    throw new Error("UNEXPECTED_OPERATION_CONSTRAINT_ERROR");
  }
  throw new Error("OPERATION_CONSTRAINT_DID_NOT_REJECT");
}
material("migration applied exactly once", async () => {
  const rows = await db.$queryRaw<Array<{ count: number }>>`
    SELECT count(*)::int AS count FROM "_prisma_migrations"
    WHERE migration_name='20261016230000_add_opencredit_commercial_operation_foundation'
    AND finished_at IS NOT NULL AND rolled_back_at IS NULL
  `;
  assert.equal(rows[0].count, 1);
});
for (const table of [op, event]) material("exact columns/types/nullability/defaults and no PII for " + table, async () => {
  const columns = await db.$queryRaw<Array<{ name: string; type: string; nullable: string; default: string | null }>>`
    SELECT column_name AS name, data_type AS type, is_nullable AS nullable, column_default AS default
    FROM information_schema.columns WHERE table_schema='public' AND table_name=${table} ORDER BY ordinal_position
  `;
  const expected = table === op ? ["id", "companyId", "remoteIdentityId", "providerScope", "operationKind", "intentKey", "state", "revision", "createdByUserId", "createdAt", "updatedAt"] : ["id", "operationId", "companyId", "providerScope", "actorUserId", "action", "previousState", "nextState", "revision", "createdAt", "dispatchAuthorizationEventId"];
  assert.deepEqual(columns.map(c => c.name), expected);
  for (const c of columns) {
    assert.equal(c.type, c.name.endsWith("At") ? "timestamp without time zone" : c.name === "revision" ? "integer" : "text");
    assert.equal(c.nullable, ["previousState", "dispatchAuthorizationEventId"].includes(c.name) ? "YES" : "NO");
    if (c.name === "createdAt") assert.match(c.default ?? "", /CURRENT_TIMESTAMP/);
    else if (table === op && c.name === "state") assert.equal(c.default, "'PREPARED'::text");
    else if (table === op && c.name === "revision") assert.equal(c.default, "0");
    else assert.equal(c.default, null);
    assert.doesNotMatch(c.name, /cpf|payload|response|credential|password|token|hash|consent|evidence/i);
  }
});
material("both PKs, two uniques and six exact ordered indexes are valid and unconditional", async () => {
  const rows = await db.$queryRaw<Array<{ table: string; name: string; unique: boolean; primary: boolean; valid: boolean; partial: boolean; columns: string[] }>>`
    SELECT t.relname::text AS table, x.relname::text AS name, i.indisunique AS "unique", i.indisprimary AS "primary", i.indisvalid AS valid,
      (i.indpred IS NOT NULL OR i.indexprs IS NOT NULL) AS partial,
      ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(n,pos)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.n ORDER BY k.pos) AS columns
    FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_class x ON x.oid=i.indexrelid JOIN pg_namespace ns ON ns.oid=t.relnamespace
    WHERE ns.nspname='public' AND t.relname IN ('OpenCreditCommercialOperation','OpenCreditCommercialOperationEvent')
  `;
  const expected = [
    [op, op + "_pkey", true, true, ["id"]], [event, event + "_pkey", true, true, ["id"]],
    [op, "OCOperation_company_scope_intent_key", true, false, ["companyId", "providerScope", "intentKey"]],
    [op, "OCOperation_id_company_scope_key", true, false, ["id", "companyId", "providerScope"]],
    [op, "OCOperation_identity_created_id_idx", false, false, ["remoteIdentityId", "createdAt", "id"]],
    [op, "OCOperation_scope_state_created_id_idx", false, false, ["companyId", "providerScope", "state", "createdAt", "id"]],
    [op, "OCOperation_actor_idx", false, false, ["createdByUserId"]],
    [event, "OCOperationEvent_operation_created_id_idx", false, false, ["operationId", "createdAt", "id"]],
    [event, "OCOperationEvent_actor_idx", false, false, ["actorUserId"]],
    [event, "OCOperationEvent_dispatch_auth_idx", false, false, ["dispatchAuthorizationEventId"]]
  ] as const;
  assert.equal(rows.length, expected.length);
  for (const [table, name, unique, primary, columns] of expected) assert.ok(rows.some(r => r.table === table && r.name === name && r.unique === unique && r.primary === primary && r.valid && !r.partial && JSON.stringify(r.columns) === JSON.stringify(columns)));
});
material("six actual FKs have exact names/columns/references with RESTRICT and NO ACTION", async () => {
  const rows = await db.$queryRaw<Array<{ table: string; name: string; reference: string; columns: string[]; refs: string[]; del: string; upd: string; valid: boolean }>>`
    SELECT t.relname::text AS table, c.conname::text AS name, r.relname::text AS reference,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n,pos) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.pos) AS columns,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n,pos) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY k.pos) AS refs,
      c.confdeltype::text AS del, c.confupdtype::text AS upd, c.convalidated AS valid
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class r ON r.oid=c.confrelid JOIN pg_namespace ns ON ns.oid=t.relnamespace
    WHERE ns.nspname='public' AND c.contype='f' AND t.relname IN ('OpenCreditCommercialOperation','OpenCreditCommercialOperationEvent')
  `;
  assert.equal(rows.length, 6);
  for (const [table, name, reference, columns, refs] of [
    [op, companyFk, "Company", ["companyId"], ["id"]],
    [op, identityFk, "OpenCreditRemoteIdentity", ["remoteIdentityId", "companyId", "providerScope"], ["id", "companyId", "providerScope"]],
    [op, creatorFk, "User", ["createdByUserId"], ["id"]],
    [event, operationFk, op, ["operationId", "companyId", "providerScope"], ["id", "companyId", "providerScope"]],
    [event, actorFk, "User", ["actorUserId"], ["id"]],
    [event, "OCOperationEvent_dispatch_auth_fkey", "OpenCreditConsumerAuthorizationEvent", ["dispatchAuthorizationEventId", "companyId", "providerScope"], ["id", "companyId", "providerScope"]]
  ] as const) {
    assert.ok(name.length <= 63);
    assert.ok(rows.some(r => r.table === table && r.name === name && r.reference === reference && r.valid && r.del === "r" && r.upd === "a" && JSON.stringify(r.columns) === JSON.stringify(columns) && JSON.stringify(r.refs) === JSON.stringify(refs)));
  }
});
material("valid synthetic Operation uses PREPARED/revision 0 and platform actor from another Company", async f => {
  const row = await db.openCreditCommercialOperation.create({ data: f.data });
  assert.equal(row.state, "PREPARED"); assert.equal(row.revision, 0); assert.notEqual(f.creator.companyId, row.companyId);
  assert.equal(row.createdByUserId, f.creator.id); assert.ok(row.createdAt instanceof Date); assert.ok(row.updatedAt instanceof Date);
});
material("wrong Company with valid RemoteIdentity rejects by composite FK", async f => {
  await rejectsFk(() => db.openCreditCommercialOperation.create({ data: { ...f.data, companyId: f.b } }), op, identityFk);
});
material("wrong scope with valid RemoteIdentity rejects by composite FK", async f => {
  const other = syntheticScope(); await f.identityFor(f.a, other);
  await rejectsFk(() => db.openCreditCommercialOperation.create({ data: { ...f.data, providerScope: other } }), op, identityFk);
});
material("missing Operation creator rejects", async f => {
  await rejectsFk(() => db.openCreditCommercialOperation.create({ data: { ...f.data, createdByUserId: "missing-" + randomUUID() } }), op, creatorFk);
});
material("duplicate local Company/scope/intent rejects specifically the intended unique", async f => {
  const first = await db.openCreditCommercialOperation.create({ data: f.data });
  await assert.rejects(() => db.openCreditCommercialOperation.create({ data: f.data }), error => {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
    if (error.meta?.modelName !== undefined && error.meta.modelName !== op) return false;
    const target = error.meta?.target;
    return target === "OCOperation_company_scope_intent_key" || Array.isArray(target) && target.length === 3 && ["companyId", "providerScope", "intentKey"].every(k => target.includes(k));
  });
  assert.equal(await db.openCreditCommercialOperation.count({ where: { companyId: f.a, providerScope: f.scope, intentKey: f.data.intentKey } }), 1);
  assert.equal((await db.openCreditCommercialOperation.findUniqueOrThrow({ where: { id: first.id } })).revision, 0);
});
material("same intent in another valid scope is independent", async f => {
  const first = await db.openCreditCommercialOperation.create({ data: f.data }); const other = syntheticScope(); const parent = await f.identityFor(f.a, other);
  const second = await db.openCreditCommercialOperation.create({ data: { ...f.data, providerScope: other, remoteIdentityId: parent.id } });
  assert.notEqual(first.id, second.id); assert.equal(first.intentKey, second.intentKey);
});
material("same intent in another valid Company is independent", async f => {
  const first = await db.openCreditCommercialOperation.create({ data: f.data }); const parent = await f.identityFor(f.b, f.scope, "11111111111");
  const second = await db.openCreditCommercialOperation.create({ data: { ...f.data, companyId: f.b, remoteIdentityId: parent.id } });
  assert.notEqual(first.id, second.id); assert.equal(first.intentKey, second.intentKey);
});
material("valid Event persists only exact approved facts; platform actor need not share target Company", async f => {
  const operation = await db.openCreditCommercialOperation.create({ data: f.data }); const row = await db.openCreditCommercialOperationEvent.create({ data: f.eventData(operation.id) });
  assert.deepEqual(Object.keys(row).sort(), ["id", "operationId", "companyId", "providerScope", "actorUserId", "action", "previousState", "nextState", "revision", "createdAt", "dispatchAuthorizationEventId"].sort());
  assert.equal(row.dispatchAuthorizationEventId, null);
  assert.equal(row.previousState, null); assert.equal(row.revision, 0); assert.equal(row.actorUserId, f.actor.id); assert.notEqual(f.actor.companyId, row.companyId);
});
for (const wrong of ["company", "scope", "actor"] as const) material("Event rejects wrong " + wrong, async f => {
  const operation = await db.openCreditCommercialOperation.create({ data: f.data });
  const data = { ...f.eventData(operation.id), ...(wrong === "company" ? { companyId: f.b } : wrong === "scope" ? { providerScope: syntheticScope() } : { actorUserId: "missing-" + randomUUID() }) };
  await rejectsFk(() => db.openCreditCommercialOperationEvent.create({ data }), event, wrong === "actor" ? actorFk : operationFk);
  assert.equal(await db.openCreditCommercialOperationEvent.count({ where: { operationId: operation.id } }), 0);
});
material("Event prevents deleting its Operation without a cleanup bypass", async f => {
  const operation = await db.openCreditCommercialOperation.create({ data: f.data }); const row = await db.openCreditCommercialOperationEvent.create({ data: f.eventData(operation.id) });
  await rejectsFk(() => db.openCreditCommercialOperation.delete({ where: { id: operation.id } }), op, operationFk);
  assert.equal(await db.openCreditCommercialOperation.count({ where: { id: operation.id } }), 1); assert.equal(await db.openCreditCommercialOperationEvent.count({ where: { id: row.id } }), 1);
});
material("Operation prevents deleting its RemoteIdentity", async f => {
  const operation = await db.openCreditCommercialOperation.create({ data: f.data });
  await rejectsFk(() => db.openCreditRemoteIdentity.delete({ where: { id: f.identity.id } }), "OpenCreditRemoteIdentity", identityFk);
  assert.equal(await db.openCreditCommercialOperation.count({ where: { id: operation.id } }), 1);
});
material("Operation creator RESTRICT is isolated from parent and Event actor references", async f => {
  const operation = await db.openCreditCommercialOperation.create({ data: f.data });
  await rejectsFk(() => db.user.delete({ where: { id: f.creator.id } }), "User", creatorFk);
  assert.equal(await db.user.count({ where: { id: f.creator.id } }), 1); assert.equal(await db.openCreditCommercialOperation.count({ where: { id: operation.id } }), 1);
});
material("Event actor RESTRICT independently preserves actor and history", async f => {
  const operation = await db.openCreditCommercialOperation.create({ data: f.data }); const row = await db.openCreditCommercialOperationEvent.create({ data: f.eventData(operation.id) });
  await rejectsFk(() => db.user.delete({ where: { id: f.actor.id } }), "User", actorFk);
  assert.equal(await db.user.count({ where: { id: f.actor.id } }), 1); assert.equal(await db.openCreditCommercialOperationEvent.count({ where: { id: row.id } }), 1);
});
material("Operation FK NO ACTION blocks RemoteIdentity scope mutation despite a valid replacement access", async f => {
  const operation = await db.openCreditCommercialOperation.create({ data: f.data }); const other = syntheticScope();
  await db.openCreditCommercialAccess.create({ data: { companyId: f.a, providerScope: other, changedByUserId: f.parentCreator.id } });
  await rejectsFk(() => db.openCreditRemoteIdentity.update({ where: { id: f.identity.id }, data: { providerScope: other } }), "OpenCreditRemoteIdentity", identityFk);
  assert.equal((await db.openCreditCommercialOperation.findUniqueOrThrow({ where: { id: operation.id } })).providerScope, f.scope);
});
material("Event FK NO ACTION blocks Operation scope mutation despite a valid replacement identity", async f => {
  const operation = await db.openCreditCommercialOperation.create({ data: f.data }); const row = await db.openCreditCommercialOperationEvent.create({ data: f.eventData(operation.id) });
  const other = syntheticScope(); const parent = await f.identityFor(f.a, other);
  await rejectsFk(() => db.openCreditCommercialOperation.update({ where: { id: operation.id }, data: { providerScope: other, remoteIdentityId: parent.id } }), op, operationFk);
  assert.equal((await db.openCreditCommercialOperationEvent.findUniqueOrThrow({ where: { id: row.id } })).providerScope, f.scope);
});
material("synthetic states/revisions demonstrate storage ONLY, not an enforced state machine", async f => {
  for (const [i, state] of Array.from(["PREPARED", "IN_FLIGHT", "SUCCEEDED", "FAILED", "UNKNOWN", "SYNTHETIC_OTHER_STATE"].entries())) {
    const operation = await db.openCreditCommercialOperation.create({ data: { ...f.data, intentKey: intent(), state, revision: i } });
    const row = await db.openCreditCommercialOperationEvent.create({ data: { ...f.eventData(operation.id), action: "SYNTHETIC_STORAGE_ONLY", previousState: "PREPARED", nextState: state, revision: i } });
    assert.equal(row.nextState, state); assert.equal(row.revision, i); assert.equal(operation.state, state);
  }
});
material("real final Event FK failure rolls back previously inserted Operation and Event", async f => {
  const operationId = "rollback-operation-" + randomUUID(); const eventId = "rollback-event-" + randomUUID(); let observed = false;
  await rejectsFk(() => db.$transaction(async tx => {
    const operation = await tx.openCreditCommercialOperation.create({ data: { ...f.data, id: operationId } });
    await tx.openCreditCommercialOperationEvent.create({ data: { ...f.eventData(operation.id), id: eventId } });
    observed = await tx.openCreditCommercialOperation.count({ where: { id: operationId } }) === 1 && await tx.openCreditCommercialOperationEvent.count({ where: { id: eventId } }) === 1;
    await tx.openCreditCommercialOperationEvent.create({ data: { ...f.eventData(operation.id), actorUserId: "missing-" + randomUUID() } });
  }), event, actorFk);
  assert.equal(observed, true); assert.equal(await db.openCreditCommercialOperation.count({ where: { id: operationId } }), 0);
  assert.equal(await db.openCreditCommercialOperationEvent.count({ where: { operationId } }), 0);
});
