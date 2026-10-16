import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { assertOpenCreditRemoteIdentityAuditTestDatabase } from "./opencredit-remote-identity-audit-postgres.guard";

assertOpenCreditRemoteIdentityAuditTestDatabase(process.env);
const db = new PrismaClient({ log: [] });
after(async () => { await db.$disconnect(); });
const eventTable = "OpenCreditRemoteIdentityEvent";
const identityFk = "OpenCreditRemoteIdentityEvent_remoteIdentityId_companyId_p_fkey";
const actorFk = "OpenCreditRemoteIdentityEvent_actorUserId_fkey";
const syntheticScope = () => "synthetic-" + randomUUID().replace(/\d/g, digit => String.fromCharCode(103 + Number(digit)));

// Fixtures remain only in the gated disposable DB until it is destroyed.
// No event deletion API, cleanup bypass or operational identity is introduced.
async function fixture() {
  const [a, b, platform] = ["a","b","platform"].map(p => "oc-remote-audit-ci-" + p + "-" + randomUUID());
  await db.company.createMany({ data: [a,b,platform].map(id => ({ id, name: "Synthetic remote audit fixture" })) });
  const user = () => db.user.create({ data: { companyId: platform, name: "Synthetic platform actor",
    email: randomUUID() + "@example.invalid", passwordHash: "NOT_A_REAL_PASSWORD_HASH", role: "ADMIN" } });
  const creator = await user(); const actor = await user();
  const scope = syntheticScope();
  const access = await db.openCreditCommercialAccess.create({ data: { companyId: a, providerScope: scope, changedByUserId: creator.id } });
  const contact = await db.contact.create({ data: { companyId: a, name: "Synthetic contact", phone: "00000000000" } });
  // Mathematically invalid repeated digits: never use a real person's identity.
  const identity = await db.openCreditRemoteIdentity.create({ data: { companyId: a, contactId: contact.id,
    providerScope: scope, normalizedCpf: "00000000000", createdByUserId: creator.id } });
  const data = { remoteIdentityId: identity.id, companyId: a, providerScope: scope, actorUserId: actor.id,
    action: "CLAIMED", previousEnabled: null, nextEnabled: false };
  return { a,b,platform,creator,actor,scope,access,contact,identity,data };
}
function material(name: string, run: () => Promise<void>) {
  test(name, async () => {
    try { await run(); } catch (error) {
      const code = error instanceof Prisma.PrismaClientKnownRequestError && /^P\d{4}$/.test(error.code) ? error.code : "ASSERTION_OR_OTHER_FAILURE";
      throw new Error("OPENCREDIT_REMOTE_IDENTITY_AUDIT_MATERIAL_FAILED:" + code);
    }
  });
}
async function rejectsFk(run: () => Promise<unknown>, model: string, expected: string) {
  try { await run(); } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003"
      && (error.meta?.modelName === undefined || error.meta.modelName === model)
      && [expected, expected + " (index)"].includes(String(error.meta?.field_name))) return;
    if (error instanceof Prisma.PrismaClientUnknownRequestError && new RegExp("\\b" + expected + "\\b").test(error.message)
      && (/code:\s*"(?:23001|23503)"/.test(error.message)
        || error.message.includes("violates RESTRICT setting of foreign key constraint")
        || error.message.includes("violates foreign key constraint"))) return;
    throw new Error("UNEXPECTED_REMOTE_AUDIT_CONSTRAINT_ERROR");
  }
  throw new Error("REMOTE_AUDIT_CONSTRAINT_DID_NOT_REJECT");
}
material("migration applied exactly once and event has exactly the required columns/types/nullability/defaults", async () => {
  const migrations = await db.$queryRaw<Array<{ count: number }>>`
    SELECT count(*)::int AS count FROM "_prisma_migrations"
    WHERE migration_name='20261016220000_add_opencredit_remote_identity_audit'
      AND finished_at IS NOT NULL AND rolled_back_at IS NULL
  `;
  assert.equal(migrations[0].count, 1);
  const columns = await db.$queryRaw<Array<{ name: string; type: string; nullable: string; default: string | null }>>`
    SELECT column_name AS name, data_type AS type, is_nullable AS nullable, column_default AS default
    FROM information_schema.columns WHERE table_schema='public' AND table_name='OpenCreditRemoteIdentityEvent'
    ORDER BY ordinal_position
  `;
  assert.deepEqual(columns.map(c => c.name), ["id","remoteIdentityId","companyId","providerScope","actorUserId","action","previousEnabled","nextEnabled","createdAt"]);
  for (const c of columns) {
    assert.equal(c.type, c.name === "createdAt" ? "timestamp without time zone" : c.name.endsWith("Enabled") ? "boolean" : "text");
    assert.equal(c.nullable, c.name === "previousEnabled" ? "YES" : "NO");
    if (c.name === "createdAt") assert.match(c.default ?? "", /CURRENT_TIMESTAMP/); else assert.equal(c.default, null);
  }
});
material("parent unique, event PK and both ordered index definitions match real PostgreSQL catalogs", async () => {
  const indexes = await db.$queryRaw<Array<{ table: string; name: string; unique: boolean; primary: boolean; valid: boolean; partial: boolean; columns: string[] }>>`
    SELECT t.relname::text AS table, x.relname::text AS name, i.indisunique AS "unique", i.indisprimary AS "primary",
      i.indisvalid AS valid, (i.indpred IS NOT NULL OR i.indexprs IS NOT NULL) AS partial,
      ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(n,pos)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.n ORDER BY k.pos) AS columns
    FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_class x ON x.oid=i.indexrelid
      JOIN pg_namespace ns ON ns.oid=t.relnamespace
    WHERE ns.nspname='public' AND t.relname IN ('OpenCreditRemoteIdentity','OpenCreditRemoteIdentityEvent')
  `;
  for (const [table, name, unique, primary, columns] of [
    ["OpenCreditRemoteIdentity","OCRemoteIdentity_id_company_scope_key",true,false,["id","companyId","providerScope"]],
    [eventTable,"OpenCreditRemoteIdentityEvent_pkey",true,true,["id"]],
    [eventTable,"OCRemoteEvent_identity_created_id_idx",false,false,["remoteIdentityId","createdAt","id"]],
    [eventTable,"OCRemoteEvent_actor_idx",false,false,["actorUserId"]]
  ] as const) {
    assert.ok(name.length <= 63);
    assert.ok(indexes.some(i => i.table === table && i.name === name && i.unique === unique && i.primary === primary
      && i.valid && !i.partial && JSON.stringify(i.columns) === JSON.stringify(columns)));
  }
});
material("exact identity and actor FKs have validated RESTRICT/NO ACTION definitions and stable names", async () => {
  const fks = await db.$queryRaw<Array<{ name: string; reference: string; columns: string[]; refs: string[]; del: string; upd: string; valid: boolean }>>`
    SELECT c.conname::text AS name, r.relname::text AS reference,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n,pos)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.pos) AS columns,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n,pos)
        JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY k.pos) AS refs,
      c.confdeltype::text AS del, c.confupdtype::text AS upd, c.convalidated AS valid
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class r ON r.oid=c.confrelid
      JOIN pg_namespace ns ON ns.oid=t.relnamespace
    WHERE ns.nspname='public' AND t.relname='OpenCreditRemoteIdentityEvent' AND c.contype='f'
  `;
  assert.equal(fks.length, 2);
  for (const [name, reference, columns, refs] of [
    [identityFk,"OpenCreditRemoteIdentity",["remoteIdentityId","companyId","providerScope"],["id","companyId","providerScope"]],
    [actorFk,"User",["actorUserId"],["id"]]
  ] as const) {
    assert.ok(name.length <= 63);
    assert.ok(fks.some(f => f.name === name && f.reference === reference && f.valid && f.del === "r" && f.upd === "a"
      && JSON.stringify(f.columns) === JSON.stringify(columns) && JSON.stringify(f.refs) === JSON.stringify(refs)));
  }
});
material("composite FK rejects the identity from Company A combined with existing Company B", async () => {
  const f = await fixture();
  await rejectsFk(() => db.openCreditRemoteIdentityEvent.create({ data: { ...f.data, companyId: f.b } }), eventTable, identityFk);
  assert.equal(await db.openCreditRemoteIdentityEvent.count({ where: { remoteIdentityId: f.identity.id } }), 0);
});
material("composite FK rejects an existing identity combined with a different scope", async () => {
  const f = await fixture(); const other = syntheticScope();
  await db.openCreditCommercialAccess.create({ data: { companyId: f.a, providerScope: other, changedByUserId: f.creator.id } });
  await rejectsFk(() => db.openCreditRemoteIdentityEvent.create({ data: { ...f.data, providerScope: other } }), eventTable, identityFk);
  assert.equal(await db.openCreditRemoteIdentityEvent.count({ where: { remoteIdentityId: f.identity.id } }), 0);
});
material("platform actor from another Company is structurally valid, not proof of authorization", async () => {
  const f = await fixture(); const row = await db.openCreditRemoteIdentityEvent.create({ data: f.data });
  assert.notEqual(f.actor.companyId, row.companyId); assert.equal(row.actorUserId, f.actor.id);
});
material("actor must exist", async () => {
  const f = await fixture();
  await rejectsFk(() => db.openCreditRemoteIdentityEvent.create({ data: { ...f.data, actorUserId: "missing-" + randomUUID() } }), eventTable, actorFk);
});
material("all three future transition shapes persist without modifying or copying sensitive parent fields", async () => {
  const f = await fixture();
  for (const [action, previousEnabled, nextEnabled] of [["CLAIMED",null,false],["ENABLED",false,true],["DISABLED",true,false]] as const) {
    const row = await db.openCreditRemoteIdentityEvent.create({ data: { ...f.data, action, previousEnabled, nextEnabled } });
    assert.equal(row.action, action); assert.equal(row.previousEnabled, previousEnabled); assert.equal(row.nextEnabled, nextEnabled);
    assert.deepEqual(Object.keys(row).sort(), ["id","remoteIdentityId","companyId","providerScope","actorUserId","action","previousEnabled","nextEnabled","createdAt"].sort());
    assert.ok(row.createdAt instanceof Date);
  }
  assert.equal(await db.openCreditRemoteIdentityEvent.count({ where: { remoteIdentityId: f.identity.id } }), 3);
  assert.deepEqual(await db.openCreditRemoteIdentity.findUniqueOrThrow({ where: { id: f.identity.id } }), f.identity);
});
material("history RESTRICT independently preserves identity and actor after each rejected delete", async () => {
  const f = await fixture(); const event = await db.openCreditRemoteIdentityEvent.create({ data: f.data });
  const intact = async () => {
    assert.equal(await db.openCreditRemoteIdentityEvent.count({ where: { id: event.id, remoteIdentityId: f.identity.id, companyId: f.a } }), 1);
    assert.equal(await db.openCreditRemoteIdentity.count({ where: { id: f.identity.id } }), 1);
    assert.equal(await db.user.count({ where: { id: f.actor.id } }), 1);
  };
  await rejectsFk(() => db.openCreditRemoteIdentity.delete({ where: { id: f.identity.id } }), "OpenCreditRemoteIdentity", identityFk);
  await intact();
  // Event actor is not the access.changedBy or identity.createdBy actor.
  await rejectsFk(() => db.user.delete({ where: { id: f.actor.id } }), "User", actorFk);
  await intact();
});
material("event NO ACTION rejects parent scope edits even when a valid access exists for the new scope", async () => {
  const f = await fixture(); const event = await db.openCreditRemoteIdentityEvent.create({ data: f.data }); const other = syntheticScope();
  await db.openCreditCommercialAccess.create({ data: { companyId: f.a, providerScope: other, changedByUserId: f.creator.id } });
  await rejectsFk(() => db.openCreditRemoteIdentity.update({ where: { id: f.identity.id }, data: { providerScope: other } }), "OpenCreditRemoteIdentity", identityFk);
  assert.equal((await db.openCreditRemoteIdentity.findUniqueOrThrow({ where: { id: f.identity.id } })).providerScope, f.scope);
  assert.equal((await db.openCreditRemoteIdentityEvent.findUniqueOrThrow({ where: { id: event.id } })).providerScope, f.scope);
});
material("transaction rollback discards the uncommitted event without a cleanup writer", async () => {
  const f = await fixture(); const id = "rollback-" + randomUUID(); const sentinel = new Error("SYNTHETIC_REMOTE_AUDIT_ROLLBACK");
  await assert.rejects(() => db.$transaction(async tx => {
    await tx.openCreditRemoteIdentityEvent.create({ data: { ...f.data, id } }); throw sentinel;
  }), error => error === sentinel);
  assert.equal(await db.openCreditRemoteIdentityEvent.count({ where: { id } }), 0);
  assert.equal(await db.openCreditRemoteIdentity.count({ where: { id: f.identity.id } }), 1);
});
