import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { Prisma } from "@prisma/client";
import type { SessionUser } from "./auth";
import type { OpenCreditRemoteIdentityInput, OpenCreditRemoteIdentityServiceCode } from "./opencredit-remote-identity.service";
import { assertOpenCreditRemoteIdentityServiceTestDatabase } from "./opencredit-remote-identity-service-postgres.guard";

let service: typeof import("./opencredit-remote-identity.service");
before(async () => {
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try { service = await import("./opencredit-remote-identity.service"); } finally { loader._load = original; }
});
const actor: SessionUser = { id: "synthetic-admin", companyId: "synthetic-platform", name: "Synthetic", email: "synthetic@example.invalid", role: "ADMIN" };
const input = (changes: Partial<OpenCreditRemoteIdentityInput> = {}): OpenCreditRemoteIdentityInput => ({ actor: { ...actor }, companyId: "synthetic-company", contactId: "synthetic-contact", providerScope: "synthetic-unit" as OpenCreditRemoteIdentityInput["providerScope"], ...changes });
async function configured(run: () => Promise<void>) {
  const old = process.env.PLATFORM_COMPANY_ID; process.env.PLATFORM_COMPANY_ID = actor.companyId;
  try { await run(); } finally { if (old === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = old; }
}
type Identity = { id: string; companyId: string; contactId: string; providerScope: string; normalizedCpf: string; enabled: boolean; createdByUserId: string };
const identity = (enabled = false): Identity => ({ id: "synthetic-identity", companyId: "synthetic-company", contactId: "synthetic-contact", providerScope: "synthetic-unit", normalizedCpf: "00000000000", enabled, createdByUserId: "synthetic-previous" });
function fake(initial?: boolean) {
  const state = { currentActor: { ...actor } as SessionUser | null, company: true,
    contact: { id: "synthetic-contact", companyId: "synthetic-company", cpf: "00000000000" as string | null, archivedAt: null as Date | null },
    matches: [{ id: "synthetic-contact" }], access: { enabled: true } as { enabled: boolean } | null,
    current: initial === undefined ? null as Identity | null : identity(initial), byCpf: undefined as Identity | null | undefined, events: [] as Record<string, unknown>[] };
  const calls: string[] = []; const faults: unknown[] = []; const options: unknown[] = [];
  let attempts = 0; let eventFailure: unknown; let onAttempt: (() => void) | undefined;
  const transaction = async (run: (tx: unknown) => Promise<unknown>, opts: unknown) => {
    attempts++; options.push(opts); onAttempt?.();
    let current = state.current && { ...state.current }; const events = [...state.events];
    const tx = {
      user: { findUnique: async (args: unknown) => { calls.push("actor"); assert.deepEqual(args, { where: { id: actor.id }, select: { id: true, companyId: true, name: true, email: true, role: true } }); return state.currentActor; } },
      company: { findUnique: async (args: unknown) => { calls.push("company"); assert.deepEqual(args, { where: { id: "synthetic-company" }, select: { id: true } }); return state.company ? { id: "synthetic-company" } : null; } },
      contact: {
        findUnique: async (args: unknown) => { calls.push("contact"); assert.deepEqual(args, { where: { companyId_id: { companyId: "synthetic-company", id: "synthetic-contact" } }, select: { id: true, companyId: true, cpf: true, archivedAt: true } }); return state.contact; },
        findMany: async (args: unknown) => { calls.push("ambiguity"); assert.deepEqual(args, { where: { companyId: "synthetic-company", cpf: { in: ["00000000000", "000.000.000-00"] } }, take: 2, select: { id: true } }); return state.matches; }
      },
      openCreditCommercialAccess: { findUnique: async (args: unknown) => { calls.push("access"); assert.deepEqual(args, { where: { companyId_providerScope: { companyId: "synthetic-company", providerScope: "synthetic-unit" } }, select: { enabled: true } }); return state.access; } },
      openCreditRemoteIdentity: {
        findUnique: async (args: { where: Record<string, unknown> }) => { calls.push("binding");
          if (args.where.providerScope_normalizedCpf) { assert.deepEqual(args.where, { providerScope_normalizedCpf: { providerScope: "synthetic-unit", normalizedCpf: "00000000000" } }); return state.byCpf === undefined ? current : state.byCpf; }
          assert.deepEqual(args.where, { companyId_providerScope_contactId: { companyId: "synthetic-company", providerScope: "synthetic-unit", contactId: "synthetic-contact" } }); return current;
        },
        create: async ({ data }: { data: Omit<Identity, "id"> }) => { calls.push("identity.create"); if (faults.length) throw faults.shift(); current = { ...data, id: "synthetic-identity" }; return { id: current.id }; },
        update: async ({ data }: { data: { enabled: boolean } }) => { calls.push("identity.update"); assert.deepEqual(Object.keys(data), ["enabled"]); if (faults.length) throw faults.shift(); assert.ok(current); current = { ...current, ...data }; return { id: current.id }; }
      },
      openCreditRemoteIdentityEvent: { create: async ({ data }: { data: Record<string, unknown> }) => { calls.push("event.create"); if (eventFailure) throw eventFailure; events.push(data); return { id: "synthetic-event" }; } }
    };
    const result = await run(tx); state.current = current; state.events = events; return result;
  };
  return { state, calls, faults, options, attempts: () => attempts, failEvent: (e: unknown) => { eventFailure = e; }, onAttempt: (fn: () => void) => { onAttempt = fn; }, db: { $transaction: transaction } as unknown as Parameters<typeof service.claimOpenCreditRemoteIdentity>[0] };
}
const prismaError = (code: string, meta?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError("synthetic-private-error", { code, clientVersion: "5.22.0", meta });
async function denied(run: () => Promise<unknown>, code: OpenCreditRemoteIdentityServiceCode) {
  await assert.rejects(run, error => error instanceof service.OpenCreditRemoteIdentityServiceError && error.code === code
    && error.message === "OPENCREDIT_REMOTE_IDENTITY_" + code && !("cause" in error));
}
const modes = ["claim", "enable", "disable"] as const;
const op = (mode: typeof modes[number]) => mode === "claim" ? service.claimOpenCreditRemoteIdentity : mode === "enable" ? service.enableOpenCreditRemoteIdentity : service.disableOpenCreditRemoteIdentity;
for (const [mode, initial, changed, enabled, action] of [
  ["claim", undefined, true, false, "CLAIMED"], ["claim", false, false, false, null], ["claim", true, false, true, null],
  ["enable", false, true, true, "ENABLED"], ["enable", true, false, true, null], ["disable", true, true, false, "DISABLED"],
  ["disable", false, false, false, null], ["disable", undefined, false, false, null]
] as const) test(mode + " " + String(initial) + " -> " + enabled, () => configured(async () => {
  const f = fake(initial); const previous = f.state.current && { ...f.state.current };
  assert.deepEqual(await op(mode)(f.db, input()), { changed, enabled, identityId: initial === undefined && !changed ? null : "synthetic-identity" });
  assert.deepEqual(f.options, [{ isolationLevel: "Serializable", maxWait: 2000, timeout: 5000 }]);
  if (!changed) { assert.deepEqual(f.state.current, previous); assert.equal(f.calls.some(c => c.endsWith(".create") || c.endsWith(".update")), false); }
  else {
    assert.deepEqual(f.state.events, [{ remoteIdentityId: "synthetic-identity", companyId: "synthetic-company", providerScope: "synthetic-unit", actorUserId: actor.id, action, previousEnabled: initial ?? null, nextEnabled: enabled }]);
    assert.equal(f.state.current?.createdByUserId, initial === undefined ? actor.id : previous?.createdByUserId);
  }
}));
for (const mode of modes) for (const role of ["ADMIN", "SUPERVISOR", "AGENT"] as const) test(mode + " denies Company " + role, () => configured(async () => {
  const f = fake(); await denied(() => op(mode)(f.db, input({ actor: { ...actor, companyId: "synthetic-company", role } })), "NOT_AUTHORIZED"); assert.equal(f.attempts(), 0);
}));
for (const mode of modes) for (const changed of [null, { ...actor, id: "other" }, { ...actor, companyId: "other" }, { ...actor, role: "AGENT" as const }, { ...actor, email: "other@example.invalid" }]) test(mode + " stale actor " + (changed === null ? "removed" : Object.entries(changed).find(([k, v]) => actor[k as keyof SessionUser] !== v)?.[0]), () => configured(async () => {
  const f = fake(); f.state.currentActor = changed; await denied(() => op(mode)(f.db, input()), "NOT_AUTHORIZED"); assert.deepEqual(f.calls, ["actor"]);
}));
test("platform privilege rechecked within transaction", () => configured(async () => {
  const f = fake(); f.onAttempt(() => { process.env.PLATFORM_COMPANY_ID = "other"; }); await denied(() => op("claim")(f.db, input()), "NOT_AUTHORIZED");
}));
for (const key of ["companyId", "contactId"] as const) for (const v of ["", " leading", "a/b", "a\n", "a".repeat(129), 1, null]) test("strict " + key + " " + typeof v + String(v).length, () => configured(async () => {
  const f = fake(); await denied(() => op("claim")(f.db, input({ [key]: v } as unknown as Partial<OpenCreditRemoteIdentityInput>)), key === "companyId" ? "INVALID_COMPANY" : "INVALID_CONTACT"); assert.equal(f.attempts(), 0);
}));
for (const key of ["normalizedCpf", "enabled", "action", "previousEnabled", "nextEnabled", "createdByUserId", "actorUserId", "identityId", "consent", "owner"]) test("closed input rejects " + key, () => configured(async () => {
  const f = fake(); await denied(() => op("claim")(f.db, { ...input(), [key]: true }), "INVALID_COMPANY"); assert.equal(f.attempts(), 0);
}));
for (const v of ["", "Capital", "bad_scope", "00000000000", null, 1]) test("scope runtime validation " + typeof v + String(v).length, () => configured(async () => {
  const f = fake(); await denied(() => op("claim")(f.db, input({ providerScope: v as OpenCreditRemoteIdentityInput["providerScope"] })), "INVALID_PROVIDER_SCOPE"); assert.equal(f.attempts(), 0);
}));
for (const [label, setup, code] of [
  ["company", (f: ReturnType<typeof fake>) => { f.state.company = false; }, "COMPANY_NOT_FOUND"],
  ["archived", (f: ReturnType<typeof fake>) => { f.state.contact.archivedAt = new Date(); }, "CONTACT_ARCHIVED"],
  ["missing CPF", (f: ReturnType<typeof fake>) => { f.state.contact.cpf = null; }, "CONTACT_CPF_MISSING"],
  ["invalid CPF", (f: ReturnType<typeof fake>) => { f.state.contact.cpf = "bad"; }, "CONTACT_CPF_INVALID"],
  ["no match", (f: ReturnType<typeof fake>) => { f.state.matches = []; }, "CONTACT_CPF_INVALID"],
  ["ambiguous", (f: ReturnType<typeof fake>) => { f.state.matches.push({ id: "other" }); }, "CONTACT_AMBIGUOUS"],
  ["wrong match", (f: ReturnType<typeof fake>) => { f.state.matches = [{ id: "other" }]; }, "CONTACT_AMBIGUOUS"],
  ["missing access", (f: ReturnType<typeof fake>) => { f.state.access = null; }, "COMMERCIAL_ACCESS_MISSING"],
  ["disabled access", (f: ReturnType<typeof fake>) => { f.state.access = { enabled: false }; }, "COMMERCIAL_ACCESS_DISABLED"]
] as const) for (const mode of ["claim", "enable"] as const) test(mode + " rejects " + label, () => configured(async () => {
  const f = fake(false); setup(f); await denied(() => op(mode)(f.db, input()), code); assert.equal(f.calls.some(c => c.endsWith(".create") || c.endsWith(".update")), false);
}));
test("disable never reads Contact/CPF/access even when protective disable is needed", () => configured(async () => {
  const f = fake(true); f.state.contact.cpf = "bad"; f.state.contact.archivedAt = new Date(); f.state.matches = []; f.state.access = null;
  assert.equal((await op("disable")(f.db, input())).changed, true); assert.equal(f.calls.some(c => ["contact", "ambiguity", "access"].includes(c)), false);
}));
for (const [label, current, byCpf, code] of [
  ["different bindings", identity(), { ...identity(), id: "other" }, "IDENTITY_CONFLICT"],
  ["snapshot", { ...identity(), normalizedCpf: "11111111111" }, null, "IDENTITY_SNAPSHOT_MISMATCH"],
  ["other Company", null, { ...identity(), companyId: "other" }, "OWNERSHIP_CONFLICT"],
  ["other Contact", null, { ...identity(), contactId: "other" }, "OWNERSHIP_CONFLICT"],
  ["missing global", identity(), null, "IDENTITY_CONFLICT"]
] as const) test("reconcile " + label, () => configured(async () => {
  const f = fake(); f.state.current = current; f.state.byCpf = byCpf; await denied(() => op("claim")(f.db, input()), code);
}));
test("enable absent fails closed", () => configured(async () => { const f = fake(); await denied(() => op("enable")(f.db, input()), "IDENTITY_NOT_FOUND"); }));
const expectedTargets = ["OCRemote_scope_cpf_key", "OCRemote_company_scope_contact_key", ["providerScope", "normalizedCpf"], ["companyId", "providerScope", "contactId"]];
for (const [i, target] of Array.from(expectedTargets.entries())) test("claim retries only expected unique " + i, () => configured(async () => {
  const f = fake(); f.faults.push(prismaError("P2002", { modelName: "OpenCreditRemoteIdentity", target }));
  assert.equal((await op("claim")(f.db, input())).changed, true); assert.equal(f.attempts(), 2); assert.equal(f.state.events.length, 1);
}));
for (const mode of ["enable", "disable"] as const) test(mode + " never retries P2002", () => configured(async () => {
  const f = fake(mode === "disable"); f.faults.push(prismaError("P2002", { target: expectedTargets[0] }));
  await denied(() => op(mode)(f.db, input()), "STORAGE_ERROR"); assert.equal(f.attempts(), 1);
}));
for (const meta of [{ target: ["id"] }, { target: "unknown" }, { target: expectedTargets[0], modelName: "Contact" }, { target: expectedTargets[0], modelName: "OpenCreditRemoteIdentityEvent" }]) test("unexpected unique never retried " + JSON.stringify(meta), () => configured(async () => {
  const f = fake(); f.faults.push(prismaError("P2002", meta)); await denied(() => op("claim")(f.db, input()), "STORAGE_ERROR"); assert.equal(f.attempts(), 1);
}));
for (const mode of modes) test(mode + " retries entire transaction with fresh actor and bounded P2034", () => configured(async () => {
  const f = fake(mode === "claim" ? undefined : mode === "disable"); f.faults.push(prismaError("P2034"), prismaError("P2034"), prismaError("P2034"));
  await denied(() => op(mode)(f.db, input()), "CONCURRENT_CONFLICT"); assert.equal(f.attempts(), 3); assert.equal(f.calls.filter(c => c === "actor").length, 3); assert.equal(f.state.events.length, 0);
}));
test("retry rereads semantic ownership conflict", () => configured(async () => {
  const f = fake(); f.faults.push(prismaError("P2002", { target: expectedTargets[0] })); f.onAttempt(() => { if (f.attempts() === 2) f.state.byCpf = { ...identity(), companyId: "other" }; });
  await denied(() => op("claim")(f.db, input()), "OWNERSHIP_CONFLICT"); assert.equal(f.attempts(), 2);
}));
test("retry rejects newly stale actor", () => configured(async () => {
  const f = fake(); f.failEvent(prismaError("P2034")); f.onAttempt(() => { if (f.attempts() === 2) f.state.currentActor = null; });
  await denied(() => op("claim")(f.db, input()), "NOT_AUTHORIZED"); assert.equal(f.attempts(), 2); assert.equal(f.state.current, null);
}));
test("expected CLAIM P2002 exhaustion is bounded and sanitized", () => configured(async () => {
  const f = fake(); f.faults.push(...Array.from({ length: 3 }, () => prismaError("P2002", { target: expectedTargets[0] })));
  await denied(() => op("claim")(f.db, input()), "CONCURRENT_CONFLICT"); assert.equal(f.attempts(), 3); assert.equal(f.state.events.length, 0);
}));
for (const fact of ["company", "contact", "access", "snapshot"] as const) test("retry revalidates changed " + fact, () => configured(async () => {
  const f = fake(); f.faults.push(prismaError("P2034")); f.onAttempt(() => {
    if (f.attempts() !== 2) return;
    if (fact === "company") f.state.company = false;
    if (fact === "contact") f.state.contact.archivedAt = new Date();
    if (fact === "access") f.state.access = { enabled: false };
    if (fact === "snapshot") f.state.current = { ...identity(), normalizedCpf: "11111111111" };
  });
  await denied(() => op("claim")(f.db, input()), fact === "company" ? "COMPANY_NOT_FOUND" : fact === "contact" ? "CONTACT_ARCHIVED" : fact === "access" ? "COMMERCIAL_ACCESS_DISABLED" : "IDENTITY_SNAPSHOT_MISMATCH");
  assert.equal(f.attempts(), 2); assert.equal(f.calls.filter(c => c === "actor").length, 2); assert.equal(f.state.events.length, 0);
}));
for (const mode of modes) test(mode + " Event failure rolls back identity state", () => configured(async () => {
  const f = fake(mode === "claim" ? undefined : mode === "disable"); const previous = f.state.current && { ...f.state.current }; f.failEvent(prismaError("P2003"));
  await denied(() => op(mode)(f.db, input()), "STORAGE_ERROR"); assert.deepEqual(f.state.current, previous); assert.equal(f.state.events.length, 0);
}));
const env = { CI: "true", GITHUB_ACTIONS: "true", OPENCREDIT_REMOTE_IDENTITY_SERVICE_POSTGRES_TEST: "1", DATABASE_URL: "postgresql://qevora_ci:qevora_ci_password@127.0.0.1:5432/qevora_ci?schema=public" };
test("material guard accepts only dedicated disposable configuration", () => {
  for (const host of ["localhost", "127.0.0.1"]) for (const port of [5432, 55432]) assert.doesNotThrow(() => assertOpenCreditRemoteIdentityServiceTestDatabase({ ...env, DATABASE_URL: env.DATABASE_URL.replace("127.0.0.1:5432", host + ":" + port) }));
  for (const key of Object.keys(env)) for (const value of [undefined, "", "false", "unsafe"]) assert.throws(() => assertOpenCreditRemoteIdentityServiceTestDatabase({ ...env, [key]: value }));
  for (const url of [env.DATABASE_URL.replace("127.0.0.1", "production.invalid"), env.DATABASE_URL.replace(":5432", ":5433"), env.DATABASE_URL.replace("/qevora_ci?", "/other?"), env.DATABASE_URL.replace("schema=public", "schema=other"), env.DATABASE_URL + "&sslmode=disable", env.DATABASE_URL + "#fragment", env.DATABASE_URL.replace("postgresql:", "postgres:")]) assert.throws(() => assertOpenCreditRemoteIdentityServiceTestDatabase({ ...env, DATABASE_URL: url }));
});
test("service boundary, exact exports, CI and sole human admin runtime caller", () => {
  const source = readFileSync(new URL("./opencredit-remote-identity.service.ts", import.meta.url), "utf8");
  assert.match(source, /^import "server-only";/); assert.match(source, /canonicalizeOpenCreditOwnershipCpf/);
  assert.doesNotMatch(source, /findFirst|fetch\(|console\.|\$executeRaw|\$queryRaw|setTimeout|opencredit-api-client|consent:\s*true|\.delete\(|\.upsert\(/);
  assert.match(source, /data: \{ enabled \}/);
  assert.deepEqual(Object.keys(service).sort(), ["OpenCreditRemoteIdentityServiceError", "claimOpenCreditRemoteIdentity", "disableOpenCreditRemoteIdentity", "enableOpenCreditRemoteIdentity"].sort());
  function scan(dir: URL) { for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = new URL(e.name + (e.isDirectory() ? "/" : ""), dir); if (e.isDirectory()) scan(path);
    else if (/\.(tsx?|m?js|cjs)$/.test(e.name) && !/\.(test|integration)\./.test(e.name) && e.name !== "opencredit-remote-identity.service.ts" && path.href !== new URL("./opencredit-remote-identity-admin-handler.ts", import.meta.url).href) assert.doesNotMatch(readFileSync(path, "utf8"), /(?:import|require)[\s\S]{0,250}["'][^"']*opencredit-remote-identity\.service["']/);
  } }
  scan(new URL("../", import.meta.url)); scan(new URL("../../scripts/", import.meta.url));
  const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(ci, /tsx@4\.20\.6 src\/lib\/opencredit-remote-identity-service.test.ts/);
  assert.match(ci, /OPENCREDIT_REMOTE_IDENTITY_SERVICE_POSTGRES_TEST: "1"/);
  const material = readFileSync(new URL("./opencredit-remote-identity-service-postgres.integration.ts", import.meta.url), "utf8");
  assert.ok(material.indexOf("assertOpenCreditRemoteIdentityServiceTestDatabase(process.env)") >= 0);
  assert.ok(material.indexOf("new PrismaClient") > material.indexOf("assertOpenCreditRemoteIdentityServiceTestDatabase(process.env)"));
});
