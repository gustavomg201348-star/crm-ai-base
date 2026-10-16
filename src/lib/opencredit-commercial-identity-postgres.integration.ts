import assert from "node:assert/strict";
import { test, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { assertOpenCreditIdentityTestDatabase } from "./opencredit-commercial-identity-postgres.guard";

assertOpenCreditIdentityTestDatabase(process.env);
const db = new PrismaClient({ log: [] });
after(async () => { await db.$disconnect(); });
const CA = "OpenCreditCommercialAccess";
const RI = "OpenCreditRemoteIdentity";
const FKS = {
  accessCompany: "OpenCreditCommercialAccess_companyId_fkey",
  accessActor: "OpenCreditCommercialAccess_changedByUserId_fkey",
  identityCompany: "OpenCreditRemoteIdentity_companyId_fkey",
  contact: "OpenCreditRemoteIdentity_companyId_contactId_fkey",
  access: "OpenCreditRemoteIdentity_companyId_providerScope_fkey",
  actor: "OpenCreditRemoteIdentity_createdByUserId_fkey"
};
// Even an unexpected failure must not let node:test print raw Prisma messages/PII.
function material(name: string, fn: () => Promise<void>) {
  test(name, async () => {
    try { await fn(); } catch (error) {
      const code = error instanceof Prisma.PrismaClientKnownRequestError && /^P\d{4}$/.test(error.code) ? error.code
        : error instanceof Error && /^UNEXPECTED_DELETE_[A-Z_0-9]+$/.test(error.message) ? error.message : "ASSERTION_OR_OTHER_FAILURE";
      throw new Error("OPENCREDIT_IDENTITY_MATERIAL_FAILED:" + code);
    }
  });
}
function hasExpectedError(error: unknown, code: "P2002" | "P2003", model: string, target: string, fields: string[] = []) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== code) return false;
  if (error.meta?.modelName !== undefined && error.meta.modelName !== model) return false;
  const actual = code === "P2002" ? error.meta?.target : error.meta?.field_name;
  return actual === target || actual === target + " (index)" ||
    (code === "P2002" && Array.isArray(actual) && actual.length === fields.length && fields.every(f => actual.includes(f)));
}
async function rejectsExpected(operation: () => Promise<unknown>, code: "P2002" | "P2003", model: string, target: string, fields: string[] = []) {
  try { await operation(); } catch (error) {
    if (hasExpectedError(error, code, model, target, fields)) return;
    throw new Error("UNEXPECTED_CONSTRAINT_ERROR");
  }
  throw new Error("EXPECTED_CONSTRAINT_DID_NOT_REJECT");
}
async function restrict(operation: () => Promise<unknown>, model: string, constraints: string[]) {
  try { await operation(); } catch (error) {
    if (constraints.some(c => hasExpectedError(error, "P2003", model, c))) return;
    // Prisma 5 can surface native PostgreSQL RESTRICT as UnknownRequestError.
    if (error instanceof Prisma.PrismaClientUnknownRequestError &&
      constraints.some(c => new RegExp("\\b" + c + "\\b").test(error.message)) &&
      (/code:\s*"(?:23001|23503)"/.test(error.message) || error.message.includes("violates RESTRICT setting of foreign key constraint") || error.message.includes("violates foreign key constraint"))) return;
    const kind = error instanceof Prisma.PrismaClientKnownRequestError ? error.code
      : error instanceof Prisma.PrismaClientUnknownRequestError ? "UNKNOWN_REQUEST" : "OTHER";
    throw new Error("UNEXPECTED_DELETE_" + model.toUpperCase() + "_" + kind);
  }
  throw new Error("DELETE_DID_NOT_REJECT");
}
type Fixture = Awaited<ReturnType<typeof createFixture>>;
async function createFixture(ids: string[]) {
  const [a, b, platform] = ids; const scope = "scope-" + randomUUID();
  await db.company.createMany({ data: ids.map(id => ({ id, name: "Synthetic identity fixture" })) });
  const actor = await db.user.create({ data: { companyId: platform, name: "Synthetic actor", email: randomUUID() + "@example.invalid", passwordHash: "NOT_A_REAL_PASSWORD_HASH", role: "ADMIN" } });
  const contactA = await db.contact.create({ data: { companyId: a, name: "Synthetic A", phone: "00000000000", cpf: "00000000000" } });
  const contactB = await db.contact.create({ data: { companyId: b, name: "Synthetic B", phone: "00000000000", cpf: "00000000000" } });
  const accessA = await db.openCreditCommercialAccess.create({ data: { companyId: a, providerScope: scope, changedByUserId: actor.id } });
  const accessB = await db.openCreditCommercialAccess.create({ data: { companyId: b, providerScope: scope, changedByUserId: actor.id } });
  const data = (companyId = a, contactId = contactA.id, providerScope = scope, normalizedCpf = "00000000000") =>
    ({ companyId, contactId, providerScope, normalizedCpf, createdByUserId: actor.id });
  return { a, b, platform, scope, actor, contactA, contactB, accessA, accessB, data };
}
async function fixture(run: (f: Fixture) => Promise<void>) {
  const ids = ["a", "b", "platform"].map(x => "oc-identity-ci-" + x + "-" + randomUUID());
  try { await run(await createFixture(ids)); } finally {
    // Exclusively IDs created by this invocation, reverse FK order. Never TRUNCATE.
    const where = { companyId: { in: ids } };
    await db.openCreditRemoteIdentity.deleteMany({ where });
    await db.openCreditCommercialAccess.deleteMany({ where });
    await db.contact.deleteMany({ where });
    await db.user.deleteMany({ where });
    await db.company.deleteMany({ where: { id: { in: ids } } });
  }
}

material("migration complete, columns/types/defaults, PKs, real unique/index definitions", async () => {
  const migrations = await db.$queryRaw<Array<{ count: number }>>`
    SELECT count(*)::int AS count FROM "_prisma_migrations"
    WHERE migration_name = '20261016190000_add_opencredit_commercial_identity'
      AND finished_at IS NOT NULL AND rolled_back_at IS NULL
  `;
  assert.equal(migrations[0].count, 1);
  const pending = await db.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
  assert.equal(pending[0].count, 0);
  const columns = await db.$queryRaw<Array<{ table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null }>>`
    SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('OpenCreditCommercialAccess','OpenCreditRemoteIdentity')
  `;
  for (const [table, names] of [[CA, ["id","companyId","providerScope","enabled","changedByUserId","createdAt","updatedAt"]],
    [RI, ["id","companyId","contactId","providerScope","normalizedCpf","enabled","createdByUserId","createdAt","updatedAt"]]] as const) {
    const selected = columns.filter(c => c.table_name === table);
    assert.equal(selected.length, names.length);
    for (const name of names) {
      const col = selected.find(c => c.column_name === name); assert.ok(col);
      assert.equal(col.is_nullable, "NO");
      assert.equal(col.data_type, name === "enabled" ? "boolean" : name.endsWith("At") ? "timestamp without time zone" : "text");
      if (name === "enabled") assert.equal(col.column_default, "false");
      else if (name === "createdAt") assert.match(col.column_default ?? "", /CURRENT_TIMESTAMP/);
      else assert.equal(col.column_default, null);
    }
  }
  const indexes = await db.$queryRaw<Array<{ table_name: string; name: string; unique: boolean; primary: boolean; valid: boolean; partial: boolean; columns: string[] }>>`
    SELECT t.relname::text AS table_name, x.relname::text AS name, i.indisunique AS "unique",
      i.indisprimary AS "primary", i.indisvalid AS valid, (i.indpred IS NOT NULL OR i.indexprs IS NOT NULL) AS partial,
      ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(n,pos)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.n ORDER BY k.pos) AS columns
    FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_class x ON x.oid=i.indexrelid
      JOIN pg_namespace ns ON ns.oid=t.relnamespace
    WHERE ns.nspname='public' AND t.relname IN ('OpenCreditCommercialAccess','OpenCreditRemoteIdentity')
  `;
  for (const [table, name, unique, cols] of [
    [CA,"OpenCreditCommercialAccess_pkey",true,["id"]], [RI,"OpenCreditRemoteIdentity_pkey",true,["id"]],
    [CA,"OCCommercial_company_scope_key",true,["companyId","providerScope"]],
    [RI,"OCRemote_scope_cpf_key",true,["providerScope","normalizedCpf"]],
    [RI,"OCRemote_company_scope_contact_key",true,["companyId","providerScope","contactId"]],
    [CA,"OCCommercial_actor_idx",false,["changedByUserId"]],
    [RI,"OCRemote_company_contact_idx",false,["companyId","contactId"]],
    [RI,"OCRemote_actor_idx",false,["createdByUserId"]]
  ] as const) {
    assert.ok(indexes.some(i => i.table_name === table && i.name === name && i.unique === unique && i.valid && !i.partial &&
      i.primary === name.endsWith("_pkey") && JSON.stringify(i.columns) === JSON.stringify(cols)));
  }
});
material("six actual FK definitions use expected columns, references, RESTRICT and NO ACTION", async () => {
  const fks = await db.$queryRaw<Array<{ name: string; table_name: string; referenced_table: string; columns: string[]; refs: string[]; del: string; upd: string; validated: boolean }>>`
    SELECT c.conname::text AS name, t.relname::text AS table_name, r.relname::text AS referenced_table,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n,pos)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.n ORDER BY k.pos) AS columns,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n,pos)
        JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum=k.n ORDER BY k.pos) AS refs,
      c.confdeltype::text AS del, c.confupdtype::text AS upd, c.convalidated AS validated
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class r ON r.oid=c.confrelid
      JOIN pg_namespace ns ON ns.oid=t.relnamespace
    WHERE ns.nspname='public' AND c.contype='f' AND t.relname IN ('OpenCreditCommercialAccess','OpenCreditRemoteIdentity')
  `;
  assert.equal(fks.length, 6);
  for (const [name, table, cols, reference, refs] of [
    [FKS.accessCompany,CA,["companyId"],"Company",["id"]], [FKS.accessActor,CA,["changedByUserId"],"User",["id"]],
    [FKS.identityCompany,RI,["companyId"],"Company",["id"]], [FKS.contact,RI,["companyId","contactId"],"Contact",["companyId","id"]],
    [FKS.access,RI,["companyId","providerScope"],CA,["companyId","providerScope"]], [FKS.actor,RI,["createdByUserId"],"User",["id"]]
  ] as const) assert.ok(fks.some(f => f.name === name && f.table_name === table && f.referenced_table === reference && f.validated &&
    f.del === "r" && f.upd === "a" && JSON.stringify(f.columns) === JSON.stringify(cols) && JSON.stringify(f.refs) === JSON.stringify(refs)));
});
material("defaults fail closed and platform actor may belong to another Company", () => fixture(async f => {
  const row = await db.openCreditRemoteIdentity.create({ data: f.data() });
  assert.equal(f.accessA.enabled, false); assert.equal(row.enabled, false);
  assert.equal(f.actor.companyId, f.platform); assert.notEqual(f.actor.companyId, row.companyId);
  assert.equal(row.createdByUserId, f.actor.id); assert.equal(f.accessA.changedByUserId, f.actor.id);
}));
material("access Company+scope unique and missing actor/Company FKs reject", () => fixture(async f => {
  await rejectsExpected(() => db.openCreditCommercialAccess.create({ data: { companyId: f.a, providerScope: f.scope, changedByUserId: f.actor.id } }),
    "P2002", CA, "OCCommercial_company_scope_key", ["companyId","providerScope"]);
  await rejectsExpected(() => db.openCreditCommercialAccess.create({ data: { companyId: "missing-" + randomUUID(), providerScope: f.scope, changedByUserId: f.actor.id } }),
    "P2003", CA, FKS.accessCompany);
  await rejectsExpected(() => db.openCreditCommercialAccess.create({ data: { companyId: f.a, providerScope: "new-" + randomUUID(), changedByUserId: "missing-" + randomUUID() } }),
    "P2003", CA, FKS.accessActor);
}));
material("same scope+CPF cannot belong to two Companies even when disabled", () => fixture(async f => {
  await db.openCreditRemoteIdentity.create({ data: f.data() });
  await rejectsExpected(() => db.openCreditRemoteIdentity.create({ data: f.data(f.b, f.contactB.id) }),
    "P2002", RI, "OCRemote_scope_cpf_key", ["providerScope","normalizedCpf"]);
  assert.equal(await db.openCreditRemoteIdentity.count({ where: { providerScope: f.scope } }), 1);
}));
material("independent scopes permit the same synthetic CPF", () => fixture(async f => {
  await db.openCreditRemoteIdentity.create({ data: f.data() });
  const other = "independent-" + randomUUID();
  await db.openCreditCommercialAccess.create({ data: { companyId: f.b, providerScope: other, changedByUserId: f.actor.id } });
  await db.openCreditRemoteIdentity.create({ data: f.data(f.b, f.contactB.id, other) });
  assert.equal(await db.openCreditRemoteIdentity.count({ where: { companyId: { in: [f.a,f.b] } } }), 2);
}));
material("same Contact+scope cannot be rebound with a different CPF", () => fixture(async f => {
  await db.openCreditRemoteIdentity.create({ data: f.data() });
  await rejectsExpected(() => db.openCreditRemoteIdentity.create({ data: f.data(f.a, f.contactA.id, f.scope, "11111111111") }),
    "P2002", RI, "OCRemote_company_scope_contact_key", ["companyId","providerScope","contactId"]);
}));
material("composite Contact FK rejects cross-company references", () => fixture(async f => {
  await rejectsExpected(() => db.openCreditRemoteIdentity.create({ data: f.data(f.a, f.contactB.id) }), "P2003", RI, FKS.contact);
  assert.equal(await db.openCreditRemoteIdentity.count({ where: { companyId: f.a } }), 0);
}));
material("composite access FK requires exactly Company+scope; identity actor must exist", () => fixture(async f => {
  const other = "missing-access-" + randomUUID();
  await db.openCreditCommercialAccess.create({ data: { companyId: f.b, providerScope: other, changedByUserId: f.actor.id } });
  await rejectsExpected(() => db.openCreditRemoteIdentity.create({ data: f.data(f.a,f.contactA.id,other) }), "P2003", RI, FKS.access);
  await rejectsExpected(() => db.openCreditRemoteIdentity.create({ data: { ...f.data(), createdByUserId: "missing-" + randomUUID() } }), "P2003", RI, FKS.actor);
}));
material("RESTRICT preserves Contact, access, Company and referenced actor after every delete", () => fixture(async f => {
  const row = await db.openCreditRemoteIdentity.create({ data: f.data() });
  const preserved = async () => {
    assert.equal(await db.openCreditRemoteIdentity.count({ where: { id: row.id, companyId: f.a, contactId: f.contactA.id, providerScope: f.scope } }), 1);
    assert.equal(await db.openCreditCommercialAccess.count({ where: { id: f.accessA.id } }), 1);
    assert.equal(await db.company.count({ where: { id: f.a } }), 1);
    assert.equal(await db.contact.count({ where: { id: f.contactA.id } }), 1);
    assert.equal(await db.user.count({ where: { id: f.actor.id } }), 1);
  };
  await restrict(() => db.contact.delete({ where: { id: f.contactA.id } }), "Contact", [FKS.contact]); await preserved();
  await restrict(() => db.openCreditCommercialAccess.delete({ where: { id: f.accessA.id } }), CA, [FKS.access]); await preserved();
  await restrict(() => db.company.delete({ where: { id: f.a } }), "Company", [FKS.accessCompany,FKS.identityCompany,"Contact_companyId_fkey"]); await preserved();
  await restrict(() => db.user.delete({ where: { id: f.actor.id } }), "User", [FKS.accessActor,FKS.actor]); await preserved();
  // Isolate the Company -> CommercialAccess restriction from Contact's older FK.
  await db.contact.delete({ where: { id: f.contactB.id } });
  await restrict(() => db.company.delete({ where: { id: f.b } }), "Company", [FKS.accessCompany]);
  assert.equal(await db.openCreditCommercialAccess.count({ where: { id: f.accessB.id } }), 1);
  assert.equal(await db.company.count({ where: { id: f.b } }), 1);
  await preserved();
}));
material("archival and Contact CPF edits neither release nor rewrite the identity snapshot", () => fixture(async f => {
  const row = await db.openCreditRemoteIdentity.create({ data: f.data() });
  await db.contact.update({ where: { id: f.contactA.id }, data: { archivedAt: new Date(), cpf: "22222222222" } });
  const stored = await db.openCreditRemoteIdentity.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(stored.normalizedCpf, "00000000000"); assert.equal(stored.contactId, f.contactA.id);
  await rejectsExpected(() => db.openCreditRemoteIdentity.create({ data: f.data(f.b,f.contactB.id) }),
    "P2002", RI, "OCRemote_scope_cpf_key", ["providerScope","normalizedCpf"]);
}));
material("transaction rollback removes only attempted synthetic inserts", () => fixture(async f => {
  await rejectsExpected(() => db.$transaction(async tx => {
    await tx.openCreditRemoteIdentity.create({ data: f.data() });
    await tx.openCreditRemoteIdentity.create({ data: f.data(f.b,f.contactB.id) });
  }), "P2002", RI, "OCRemote_scope_cpf_key", ["providerScope","normalizedCpf"]);
  assert.equal(await db.openCreditRemoteIdentity.count({ where: { providerScope: f.scope } }), 0);
  assert.equal(await db.openCreditCommercialAccess.count({ where: { providerScope: f.scope } }), 2);
}));
material("two real concurrent transactions: one unique winner, one unique loser", () => fixture(async f => {
  let ready = 0; let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const insert = (company: string, contact: string) => db.$transaction(async tx => {
    ready++; if (ready === 2) release();
    await barrier;
    return tx.openCreditRemoteIdentity.create({ data: f.data(company,contact) });
  }, { maxWait: 5000, timeout: 15000 });
  const results = await Promise.allSettled([insert(f.a,f.contactA.id),insert(f.b,f.contactB.id)]);
  assert.equal(ready, 2); assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  assert.equal(failures.length, 1);
  assert.ok(hasExpectedError(failures[0].reason, "P2002", RI, "OCRemote_scope_cpf_key", ["providerScope","normalizedCpf"]));
  assert.equal(await db.openCreditRemoteIdentity.count({ where: { providerScope: f.scope, normalizedCpf: "00000000000" } }), 1);
}));
