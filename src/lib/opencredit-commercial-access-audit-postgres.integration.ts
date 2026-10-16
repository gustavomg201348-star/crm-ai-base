import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { assertOpenCreditAccessAuditTestDatabase } from "./opencredit-commercial-access-audit-postgres.guard";

assertOpenCreditAccessAuditTestDatabase(process.env);
const db = new PrismaClient({ log: [] });
after(async () => { await db.$disconnect(); });
const eventTable = "OpenCreditCommercialAccessEvent";
const accessFk = "OpenCreditCommercialAccessEvent_commercialAccessId_company_fkey";
const actorFk = "OpenCreditCommercialAccessEvent_actorUserId_fkey";

// Synthetic fixtures are retained only in the explicitly gated disposable database.
// No cleanup API, permission bypass or event deletion is provided.
async function fixture() {
  const [a, b, platform] = ["a", "b", "platform"].map(p => "oc-audit-ci-" + p + "-" + randomUUID());
  await db.company.createMany({ data: [a, b, platform].map(id => ({ id, name: "Synthetic audit fixture" })) });
  const actor = await db.user.create({ data: { companyId: platform, name: "Synthetic platform actor",
    email: randomUUID() + "@example.invalid", passwordHash: "NOT_A_REAL_PASSWORD_HASH", role: "ADMIN" } });
  const scope = "synthetic-" + randomUUID();
  const access = await db.openCreditCommercialAccess.create({ data: { companyId: a, providerScope: scope, changedByUserId: actor.id } });
  const data = { commercialAccessId: access.id, companyId: a, providerScope: scope, actorUserId: actor.id,
    action: "GRANTED", previousEnabled: null, nextEnabled: true };
  return { a, b, platform, actor, access, data };
}
function material(name: string, run: () => Promise<void>) {
  test(name, async () => {
    try { await run(); } catch (error) {
      const code = error instanceof Prisma.PrismaClientKnownRequestError && /^P\d{4}$/.test(error.code) ? error.code : "ASSERTION_OR_OTHER_FAILURE";
      throw new Error("OPENCREDIT_ACCESS_AUDIT_MATERIAL_FAILED:" + code);
    }
  });
}
async function rejectsFk(run: () => Promise<unknown>, model: string, expected: string) {
  try { await run(); } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003"
      && (error.meta?.modelName === undefined || error.meta.modelName === model)
      && [expected, expected + " (index)"].includes(String(error.meta?.field_name))) return;
    // Prisma 5 can surface native RESTRICT as an UnknownRequestError.
    if (error instanceof Prisma.PrismaClientUnknownRequestError && new RegExp("\\b" + expected + "\\b").test(error.message)
      && (/code:\s*"(?:23001|23503)"/.test(error.message)
        || error.message.includes("violates RESTRICT setting of foreign key constraint")
        || error.message.includes("violates foreign key constraint"))) return;
    throw new Error("UNEXPECTED_AUDIT_CONSTRAINT_ERROR");
  }
  throw new Error("AUDIT_CONSTRAINT_DID_NOT_REJECT");
}
material("audit migration finished and event columns, types, nullability and defaults are exact", async () => {
  const migrations = await db.$queryRaw<Array<{ count: number }>>`
    SELECT count(*)::int AS count FROM "_prisma_migrations"
    WHERE migration_name='20261016200000_add_opencredit_commercial_access_audit'
      AND finished_at IS NOT NULL AND rolled_back_at IS NULL
  `;
  assert.equal(migrations[0].count, 1);
  const columns = await db.$queryRaw<Array<{ name: string; type: string; nullable: string; default: string | null }>>`
    SELECT column_name AS name, data_type AS type, is_nullable AS nullable, column_default AS default
    FROM information_schema.columns WHERE table_schema='public' AND table_name='OpenCreditCommercialAccessEvent'
    ORDER BY ordinal_position
  `;
  const names = ["id", "commercialAccessId", "companyId", "providerScope", "actorUserId", "action", "previousEnabled", "nextEnabled", "createdAt"];
  assert.deepEqual(columns.map(c => c.name), names);
  for (const c of columns) {
    assert.equal(c.type, c.name === "createdAt" ? "timestamp without time zone" : c.name.endsWith("Enabled") ? "boolean" : "text");
    assert.equal(c.nullable, c.name === "previousEnabled" ? "YES" : "NO");
    if (c.name === "createdAt") assert.match(c.default ?? "", /CURRENT_TIMESTAMP/);
    else assert.equal(c.default, null);
  }
});
material("actual parent unique, event PK and both ordered indexes are valid and unconditional", async () => {
  const indexes = await db.$queryRaw<Array<{ table: string; name: string; unique: boolean; primary: boolean; valid: boolean; partial: boolean; columns: string[] }>>`
    SELECT t.relname::text AS table, x.relname::text AS name, i.indisunique AS "unique", i.indisprimary AS "primary",
      i.indisvalid AS valid, (i.indpred IS NOT NULL OR i.indexprs IS NOT NULL) AS partial,
      ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(n,pos)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.n ORDER BY k.pos) AS columns
    FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_class x ON x.oid=i.indexrelid
      JOIN pg_namespace ns ON ns.oid=t.relnamespace
    WHERE ns.nspname='public' AND t.relname IN ('OpenCreditCommercialAccess','OpenCreditCommercialAccessEvent')
  `;
  for (const [table, name, unique, primary, columns] of [
    ["OpenCreditCommercialAccess", "OCCommercial_id_company_scope_key", true, false, ["id","companyId","providerScope"]],
    [eventTable, "OpenCreditCommercialAccessEvent_pkey", true, true, ["id"]],
    [eventTable, "OCAccessEvent_access_created_id_idx", false, false, ["commercialAccessId","createdAt","id"]],
    [eventTable, "OCAccessEvent_actor_idx", false, false, ["actorUserId"]]
  ] as const) assert.ok(indexes.some(i => i.table === table && i.name === name && i.unique === unique && i.primary === primary
    && i.valid && !i.partial && JSON.stringify(i.columns) === JSON.stringify(columns)));
});
material("exact composite access and actor FKs have RESTRICT and NO ACTION", async () => {
  const fks = await db.$queryRaw<Array<{ name: string; reference: string; columns: string[]; refs: string[]; del: string; upd: string; valid: boolean }>>`
    SELECT c.conname::text AS name, r.relname::text AS reference,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n,pos)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.pos) AS columns,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n,pos)
        JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY k.pos) AS refs,
      c.confdeltype::text AS del, c.confupdtype::text AS upd, c.convalidated AS valid
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class r ON r.oid=c.confrelid
      JOIN pg_namespace ns ON ns.oid=t.relnamespace
    WHERE ns.nspname='public' AND t.relname='OpenCreditCommercialAccessEvent' AND c.contype='f'
  `;
  assert.equal(fks.length, 2);
  for (const [name, reference, columns, refs] of [
    [accessFk, "OpenCreditCommercialAccess", ["commercialAccessId","companyId","providerScope"], ["id","companyId","providerScope"]],
    [actorFk, "User", ["actorUserId"], ["id"]]
  ] as const) assert.ok(fks.some(f => f.name === name && f.reference === reference && f.valid && f.del === "r" && f.upd === "a"
    && JSON.stringify(f.columns) === JSON.stringify(columns) && JSON.stringify(f.refs) === JSON.stringify(refs)));
});
material("composite FK rejects wrong Company even when a different access exists there", async () => {
  const f = await fixture();
  await db.openCreditCommercialAccess.create({ data: { companyId: f.b, providerScope: f.data.providerScope, changedByUserId: f.actor.id } });
  await rejectsFk(() => db.openCreditCommercialAccessEvent.create({ data: { ...f.data, companyId: f.b } }), eventTable, accessFk);
  assert.equal(await db.openCreditCommercialAccessEvent.count({ where: { commercialAccessId: f.access.id } }), 0);
});
material("composite FK rejects wrong scope even when another access exists for that scope", async () => {
  const f = await fixture(); const other = "synthetic-other-" + randomUUID();
  await db.openCreditCommercialAccess.create({ data: { companyId: f.a, providerScope: other, changedByUserId: f.actor.id } });
  await rejectsFk(() => db.openCreditCommercialAccessEvent.create({ data: { ...f.data, providerScope: other } }), eventTable, accessFk);
  assert.equal(await db.openCreditCommercialAccessEvent.count({ where: { commercialAccessId: f.access.id } }), 0);
});
material("platform actor from another Company is structurally valid; historical null/boolean values survive reads", async () => {
  const f = await fixture();
  const grant = await db.openCreditCommercialAccessEvent.create({ data: f.data });
  const revoke = await db.openCreditCommercialAccessEvent.create({ data: { ...f.data, action: "REVOKED", previousEnabled: true, nextEnabled: false } });
  const rows = await db.openCreditCommercialAccessEvent.findMany({ where: { commercialAccessId: f.access.id, companyId: f.a },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  assert.equal(rows.length, 2); assert.notEqual(f.actor.companyId, f.a);
  assert.equal(grant.actorUserId, f.actor.id); assert.equal(grant.previousEnabled, null); assert.equal(grant.nextEnabled, true);
  assert.equal(revoke.previousEnabled, true); assert.equal(revoke.nextEnabled, false);
  assert.ok(rows.every(row => row.createdAt instanceof Date && !("updatedAt" in row)));
  // The foundation stores history; it does not execute a grant/revoke transition.
  assert.equal((await db.openCreditCommercialAccess.findUniqueOrThrow({ where: { id: f.access.id } })).enabled, false);
});
material("actor must actually exist", async () => {
  const f = await fixture();
  await rejectsFk(() => db.openCreditCommercialAccessEvent.create({ data: { ...f.data, actorUserId: "missing-" + randomUUID() } }), eventTable, actorFk);
});
material("event RESTRICT independently preserves access and actor after failed physical deletes", async () => {
  const f = await fixture();
  // Distinct state actor isolates the event's actor FK from access.changedBy.
  const stateActor = await db.user.create({ data: { companyId: f.platform, name: "Synthetic state actor",
    email: randomUUID() + "@example.invalid", passwordHash: "NOT_A_REAL_PASSWORD_HASH", role: "ADMIN" } });
  await db.openCreditCommercialAccess.update({ where: { id: f.access.id }, data: { changedByUserId: stateActor.id } });
  const event = await db.openCreditCommercialAccessEvent.create({ data: f.data });
  const intact = async () => {
    assert.equal(await db.openCreditCommercialAccessEvent.count({ where: { id: event.id, commercialAccessId: f.access.id, companyId: f.a } }), 1);
    assert.equal(await db.openCreditCommercialAccess.count({ where: { id: f.access.id } }), 1);
    assert.equal(await db.user.count({ where: { id: f.actor.id } }), 1);
  };
  await rejectsFk(() => db.openCreditCommercialAccess.delete({ where: { id: f.access.id } }), "OpenCreditCommercialAccess", accessFk);
  await intact();
  await rejectsFk(() => db.user.delete({ where: { id: f.actor.id } }), "User", actorFk);
  await intact();
});
material("NO ACTION prevents parent scope mutation with an existing event", async () => {
  const f = await fixture(); const event = await db.openCreditCommercialAccessEvent.create({ data: f.data });
  await rejectsFk(() => db.openCreditCommercialAccess.update({ where: { id: f.access.id }, data: { providerScope: "changed-" + randomUUID() } }),
    "OpenCreditCommercialAccess", accessFk);
  assert.equal((await db.openCreditCommercialAccess.findUniqueOrThrow({ where: { id: f.access.id } })).providerScope, f.data.providerScope);
  assert.equal((await db.openCreditCommercialAccessEvent.findUniqueOrThrow({ where: { id: event.id } })).providerScope, f.data.providerScope);
});
material("event insert participates in ordinary transaction rollback without an event deletion API", async () => {
  const f = await fixture(); const id = "rolled-back-" + randomUUID();
  const sentinel = new Error("SYNTHETIC_AUDIT_ROLLBACK");
  await assert.rejects(() => db.$transaction(async tx => {
    await tx.openCreditCommercialAccessEvent.create({ data: { ...f.data, id } });
    throw sentinel;
  }), error => error === sentinel);
  assert.equal(await db.openCreditCommercialAccessEvent.count({ where: { id } }), 0);
});
