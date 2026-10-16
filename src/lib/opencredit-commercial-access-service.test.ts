import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module from "node:module";
import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import type { SessionUser } from "./auth";
import type { OpenCreditCommercialAccessInput, OpenCreditCommercialAccessServiceCode } from "./opencredit-commercial-access.service";
import { assertOpenCreditAccessServiceTestDatabase } from "./opencredit-commercial-access-service-postgres.guard";

let service: typeof import("./opencredit-commercial-access.service");
before(async () => {
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try { service = await import("./opencredit-commercial-access.service"); } finally { loader._load = original; }
});
const actor: SessionUser = { id: "synthetic-admin", companyId: "synthetic-platform", name: "Synthetic", email: "synthetic-admin@example.invalid", role: "ADMIN" };
const input = (changes: Partial<OpenCreditCommercialAccessInput> = {}): OpenCreditCommercialAccessInput => ({
  actor: { ...actor }, companyId: "synthetic-company",
  providerScope: "synthetic-unit" as OpenCreditCommercialAccessInput["providerScope"], ...changes
});
async function configured(run: () => Promise<void>, fallback = false) {
  const company = process.env.PLATFORM_COMPANY_ID; const emails = process.env.PLATFORM_ADMIN_EMAILS;
  if (fallback) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = actor.companyId;
  process.env.PLATFORM_ADMIN_EMAILS = actor.email;
  try { await run(); } finally {
    if (company === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = company;
    if (emails === undefined) delete process.env.PLATFORM_ADMIN_EMAILS; else process.env.PLATFORM_ADMIN_EMAILS = emails;
  }
}
type Access = { id: string; companyId: string; providerScope: string; enabled: boolean; changedByUserId: string; updatedAt: number };
function fake(initial?: boolean) {
  const state = { access: initial === undefined ? null as Access | null : { id: "synthetic-access", companyId: "synthetic-company",
    providerScope: "synthetic-unit", enabled: initial, changedByUserId: "synthetic-previous", updatedAt: 1 },
    events: [] as unknown[], currentActor: { ...actor } as SessionUser | null, company: true };
  const faults: unknown[] = []; const mutations: string[] = []; const options: unknown[] = [];
  let attempts = 0; let actorReads = 0; let eventFailure: unknown; let beforeAttempt: (() => void) | undefined;
  const transaction = async (run: (tx: unknown) => Promise<unknown>, opts: unknown) => {
    attempts++; options.push(opts); beforeAttempt?.();
    if (faults.length) throw faults.shift();
    let access = state.access ? { ...state.access } : null; const events = [...state.events];
    const tx = {
      user: { findUnique: async (args: unknown) => {
        actorReads++; assert.deepEqual(args, { where: { id: actor.id }, select: { id: true, companyId: true, name: true, email: true, role: true } });
        return state.currentActor;
      } },
      company: { findUnique: async (args: unknown) => { assert.deepEqual(args, { where: { id: "synthetic-company" }, select: { id: true } }); return state.company ? { id: "synthetic-company" } : null; } },
      openCreditCommercialAccess: {
        findUnique: async (args: { where: unknown }) => {
          assert.deepEqual(args.where, { companyId_providerScope: { companyId: "synthetic-company", providerScope: "synthetic-unit" } }); return access;
        },
        create: async ({ data }: { data: Omit<Access, "id" | "updatedAt"> }) => { mutations.push("access.create"); access = { ...data, id: "synthetic-access", updatedAt: 2 }; return { id: access.id }; },
        update: async ({ where, data }: { where: unknown; data: { enabled: boolean; changedByUserId: string } }) => {
          assert.deepEqual(where, { companyId_providerScope: { companyId: "synthetic-company", providerScope: "synthetic-unit" } });
          mutations.push("access.update"); assert.ok(access); access = { ...access, ...data, updatedAt: 2 }; return { id: access.id };
        }
      },
      openCreditCommercialAccessEvent: { create: async ({ data }: { data: unknown }) => {
        mutations.push("event.create"); if (eventFailure) throw eventFailure; events.push(data); return { id: "synthetic-event" };
      } }
    };
    const result = await run(tx);
    state.access = access; state.events = events; return result;
  };
  return { state, faults, mutations, options,
    db: { $transaction: transaction } as unknown as Parameters<typeof service.grantOpenCreditCommercialAccess>[0],
    attempts: () => attempts, actorReads: () => actorReads,
    failEvent: (error: unknown) => { eventFailure = error; }, onAttempt: (fn: () => void) => { beforeAttempt = fn; } };
}
const prismaError = (code: string, meta?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError("synthetic-private-error", { code, clientVersion: "5.22.0", meta });
async function denied(run: () => Promise<unknown>, code: OpenCreditCommercialAccessServiceCode) {
  await assert.rejects(run, error => {
    assert.ok(error instanceof service.OpenCreditCommercialAccessServiceError);
    assert.equal(error.code, code); assert.equal(error.message, "OPENCREDIT_COMMERCIAL_ACCESS_" + code);
    assert.equal("cause" in error, false); return true;
  });
}
for (const fallback of [false, true]) test("fresh platform actor accepted using " + (fallback ? "email allowlist" : "platform Company"), () => configured(async () => {
  const f = fake(); const result = await service.grantOpenCreditCommercialAccess(f.db, input());
  assert.deepEqual(result, { changed: true, enabled: true, accessId: "synthetic-access" });
  assert.deepEqual(f.state.events, [{ commercialAccessId: "synthetic-access", companyId: "synthetic-company", providerScope: "synthetic-unit",
    actorUserId: actor.id, action: "GRANTED", previousEnabled: null, nextEnabled: true }]);
  assert.equal(f.state.access?.changedByUserId, actor.id);
  assert.deepEqual(f.options, [{ isolationLevel: "Serializable", maxWait: 2000, timeout: 5000 }]);
}, fallback));
for (const [initial, granting, changed, enabled, action] of [
  [false, true, true, true, "GRANTED"], [true, true, false, true, null],
  [true, false, true, false, "REVOKED"], [false, false, false, false, null], [undefined, false, false, false, null]
] as const) test("state transition " + String(initial) + " -> " + String(enabled) + " changed=" + changed, () => configured(async () => {
  const f = fake(initial); const before = f.state.access && { ...f.state.access };
  const result = await (granting ? service.grantOpenCreditCommercialAccess : service.revokeOpenCreditCommercialAccess)(f.db, input());
  assert.deepEqual(result, { changed, enabled, accessId: initial === undefined ? null : "synthetic-access" });
  if (!changed) { assert.deepEqual(f.state.access, before); assert.deepEqual(f.mutations, []); assert.deepEqual(f.state.events, []); }
  else assert.deepEqual(f.state.events, [{ commercialAccessId: "synthetic-access", companyId: "synthetic-company", providerScope: "synthetic-unit",
    actorUserId: actor.id, action, previousEnabled: initial, nextEnabled: enabled }]);
}));
for (const role of ["ADMIN", "SUPERVISOR", "AGENT"] as const) for (const granting of [true, false]) test("Company " + role + " cannot " + (granting ? "grant" : "revoke"), () => configured(async () => {
  const f = fake(); await denied(() => (granting ? service.grantOpenCreditCommercialAccess : service.revokeOpenCreditCommercialAccess)(
    f.db, input({ actor: { ...actor, role, companyId: "synthetic-company" } })), "NOT_AUTHORIZED");
  assert.equal(f.attempts(), 0); assert.deepEqual(f.mutations, []);
}));
for (const [label, change] of [
  ["removed", null], ["id", { ...actor, id: "synthetic-other" }], ["Company", { ...actor, companyId: "synthetic-other" }],
  ["role", { ...actor, role: "AGENT" }], ["email", { ...actor, email: "synthetic-other@example.invalid" }]
] as const) test("stale actor rejects changed " + label, () => configured(async () => {
  const f = fake(); f.state.currentActor = change; await denied(() => service.grantOpenCreditCommercialAccess(f.db, input()), "NOT_AUTHORIZED");
  assert.equal(f.actorReads(), 1); assert.deepEqual(f.mutations, []);
}));
test("normalized email comparison accepts case-only changes; display name is not authority", () => configured(async () => {
  const f = fake(); f.state.currentActor = { ...actor, name: "Changed display name", email: actor.email.toUpperCase() };
  assert.equal((await service.grantOpenCreditCommercialAccess(f.db, input())).changed, true);
}, true));
test("platform condition is checked again against current configuration", () => configured(async () => {
  const f = fake(); f.onAttempt(() => { process.env.PLATFORM_COMPANY_ID = "synthetic-other"; });
  await denied(() => service.grantOpenCreditCommercialAccess(f.db, input()), "NOT_AUTHORIZED"); assert.deepEqual(f.mutations, []);
}));
test("missing Company is checked before Access mutation", () => configured(async () => {
  const f = fake(); f.state.company = false;
  await denied(() => service.revokeOpenCreditCommercialAccess(f.db, input()), "COMPANY_NOT_FOUND"); assert.deepEqual(f.mutations, []);
}));
for (const value of ["", " bad", "bad/path", "x".repeat(129), null, 1]) test("invalid Company rejected without transaction " + typeof value + ":" + String(value).length, () => configured(async () => {
  const f = fake(); await denied(() => service.grantOpenCreditCommercialAccess(f.db, input({ companyId: value as string })), "INVALID_COMPANY");
  assert.equal(f.attempts(), 0);
}));
for (const value of ["", "Synthetic-unit", "synthetic_unit", " synthetic-unit", null, {}, 1]) test("branded scope revalidated at runtime " + typeof value + ":" + String(value).length, () => configured(async () => {
  const f = fake(); await denied(() => service.grantOpenCreditCommercialAccess(f.db, input({ providerScope: value as OpenCreditCommercialAccessInput["providerScope"] })), "INVALID_PROVIDER_SCOPE");
  assert.equal(f.attempts(), 0);
}));
for (const key of ["action", "previousEnabled", "nextEnabled", "changedByUserId"]) test("caller cannot supply derived field " + key, () => configured(async () => {
  const f = fake(); await denied(() => service.grantOpenCreditCommercialAccess(f.db, { ...input(), [key]: true }), "INVALID_COMPANY"); assert.equal(f.attempts(), 0);
}));
for (const [label, fault] of [
  ["P2034", prismaError("P2034")],
  ["named unique", prismaError("P2002", { modelName: "OpenCreditCommercialAccess", target: "OCCommercial_company_scope_key" })],
  ["field unique", prismaError("P2002", { target: ["companyId", "providerScope"] })]
] as const) test("bounded local retry for " + label, () => configured(async () => {
  const f = fake(); f.faults.push(fault, fault);
  assert.equal((await service.grantOpenCreditCommercialAccess(f.db, input())).changed, true);
  assert.equal(f.attempts(), 3); assert.equal(f.state.events.length, 1);
}));
for (const fault of [prismaError("P2034"), prismaError("P2002", { target: "OCCommercial_company_scope_key" })]) test("retry exhaustion is sanitized", () => configured(async () => {
  const f = fake(); f.faults.push(fault, fault, fault);
  await denied(() => service.grantOpenCreditCommercialAccess(f.db, input()), "CONCURRENT_CONFLICT"); assert.equal(f.attempts(), 3);
}));
for (const fault of [
  prismaError("P2002"), prismaError("P2002", { target: ["id", "companyId", "providerScope"] }),
  prismaError("P2002", { modelName: "OpenCreditCommercialAccessEvent", target: "OCCommercial_company_scope_key" }),
  prismaError("P2003"), prismaError("P2028"), new Error("synthetic-private-error")
]) test("unexpected errors are sanitized and never retried " + (fault instanceof Prisma.PrismaClientKnownRequestError ? fault.code : "other"), () => configured(async () => {
  const f = fake(); f.faults.push(fault);
  await denied(() => service.grantOpenCreditCommercialAccess(f.db, input()), "STORAGE_ERROR"); assert.equal(f.attempts(), 1);
}));
test("retry revalidates actor rather than reusing previous authorized facts", () => configured(async () => {
  const f = fake(); f.failEvent(prismaError("P2034")); f.onAttempt(() => { if (f.attempts() === 2) f.state.currentActor = null; });
  await denied(() => service.grantOpenCreditCommercialAccess(f.db, input()), "NOT_AUTHORIZED");
  assert.equal(f.attempts(), 2); assert.equal(f.actorReads(), 2); assert.equal(f.state.access, null); assert.equal(f.state.events.length, 0);
}));
test("Event failure rolls back fake state too; raw errors never escape", () => configured(async () => {
  const f = fake(false); const before = { ...f.state.access }; f.failEvent(prismaError("P2003"));
  await denied(() => service.grantOpenCreditCommercialAccess(f.db, input()), "STORAGE_ERROR");
  assert.deepEqual(f.state.access, before); assert.deepEqual(f.state.events, []);
}));
test("service is server-only, scoped, contains no unrelated integration or mutable history", () => {
  const source = readFileSync(new URL("./opencredit-commercial-access.service.ts", import.meta.url), "utf8");
  assert.match(source, /^import "server-only";/); assert.match(source, /parseOpenCreditProviderScope/); assert.match(source, /isPlatformAdmin/);
  assert.doesNotMatch(source, /fetch\(|opencredit-api-client|NextResponse|console\.|\$executeRaw|\$queryRaw|setTimeout|openCreditRemoteIdentity|\.cpf\b/);
  assert.doesNotMatch(source, /openCreditCommercialAccessEvent\.(?:update|updateMany|delete|deleteMany|upsert)\(/);
  assert.deepEqual(Object.keys(service).sort(), ["OpenCreditCommercialAccessServiceError", "grantOpenCreditCommercialAccess", "revokeOpenCreditCommercialAccess"].sort());
});
const env = { CI: "true", GITHUB_ACTIONS: "true", OPENCREDIT_COMMERCIAL_ACCESS_SERVICE_POSTGRES_TEST: "1",
  DATABASE_URL: "postgresql://qevora_ci:qevora_ci_password@127.0.0.1:5432/qevora_ci?schema=public" };
test("material guard accepts only explicit disposable configurations", () => {
  for (const host of ["localhost", "127.0.0.1"]) for (const port of ["5432","55432"]) {
    assert.doesNotThrow(() => assertOpenCreditAccessServiceTestDatabase({ ...env, DATABASE_URL: env.DATABASE_URL.replace("127.0.0.1:5432", host + ":" + port) }));
  }
  for (const key of ["CI","GITHUB_ACTIONS","OPENCREDIT_COMMERCIAL_ACCESS_SERVICE_POSTGRES_TEST"]) for (const value of [undefined,"false","0",""]) {
    assert.throws(() => assertOpenCreditAccessServiceTestDatabase({ ...env, [key]: value }), { message: "OPENCREDIT_ACCESS_SERVICE_TEST_REQUIRES_DISPOSABLE_CI" });
  }
  for (const url of ["", "invalid", env.DATABASE_URL.replace("127.0.0.1","production.example.invalid"),
    env.DATABASE_URL.replace("postgresql:","postgres:"), env.DATABASE_URL.replace(":5432",":5433"),
    env.DATABASE_URL.replace("/qevora_ci?","/production?"), env.DATABASE_URL.replace("qevora_ci_password","other"),
    env.DATABASE_URL.replace("qevora_ci:","other:"), env.DATABASE_URL.replace("?schema=public",""),
    env.DATABASE_URL.replace("schema=public","schema=other"), env.DATABASE_URL + "&sslmode=disable", env.DATABASE_URL + "#fragment"]) {
    assert.throws(() => assertOpenCreditAccessServiceTestDatabase({ ...env, DATABASE_URL: url }), { message: "OPENCREDIT_ACCESS_SERVICE_TEST_REQUIRES_DISPOSABLE_CI" });
  }
});
test("CI preserves existing gates and adds dedicated service tests; material guard precedes client construction", () => {
  const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  for (const file of ["opencredit-commercial-access-service.test.ts", "opencredit-commercial-access-service-postgres.integration.ts",
    "opencredit-commercial-access-audit.test.ts", "opencredit-commercial-access-audit-postgres.integration.ts",
    "opencredit-commercial-identity-storage.test.ts", "chatbot-execution-engine.test.ts"]) assert.ok(ci.includes("src/lib/" + file));
  assert.match(ci, /OPENCREDIT_COMMERCIAL_ACCESS_SERVICE_POSTGRES_TEST: "1"/);
  const material = readFileSync(new URL("./opencredit-commercial-access-service-postgres.integration.ts", import.meta.url), "utf8");
  assert.ok(material.indexOf("assertOpenCreditAccessServiceTestDatabase(process.env)") < material.indexOf("new PrismaClient"));
  assert.doesNotMatch(material, /console\.|fetch\(/);
});
