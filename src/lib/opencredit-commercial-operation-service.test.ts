import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { Prisma } from "@prisma/client";
import * as ts from "typescript";
import type { OpenCreditCreateClientObservation } from "./opencredit-create-client-outcome";
import type { SessionUser } from "./auth";
import type { OpenCreditPrepareClientProfileInput, OpenCreditOperationTransitionInput, OpenCreditCommercialOperationServiceCode } from "./opencredit-commercial-operation.service";
import { assertOpenCreditCommercialOperationServiceTestDatabase } from "./opencredit-commercial-operation-service-postgres.guard";

let service: typeof import("./opencredit-commercial-operation.service");
let serializerFailure = false;
before(async () => {
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown }; const original = loader._load;
  loader._load = (specifier, ...args) => {
    if (specifier === "server-only") return {};
    const value = original.call(loader, specifier, ...args);
    if (specifier === "./opencredit-client-profile-contract") {
      const contract = value as typeof import("./opencredit-client-profile-contract");
      return { ...contract, serializeOpenCreditClientProfilePayload: (input: unknown) => {
        if (serializerFailure) throw Error("synthetic serializer fault");
        return contract.serializeOpenCreditClientProfilePayload(input);
      } };
    }
    return value;
  };
  try { service = await import("./opencredit-commercial-operation.service"); } finally { loader._load = original; }
});
const actor: SessionUser = { id: "synthetic-admin", companyId: "synthetic-platform", role: "ADMIN", name: "Synthetic", email: "synthetic@example.invalid" };
test("module-stable operation error reader accepts all existing closed domain codes", () => {
  const source = readFileSync("src/lib/opencredit-commercial-operation.service.ts", "utf8");
  const ast = ts.createSourceFile("service.ts", source, ts.ScriptTarget.Latest, true);
  const declarations = ast.statements.filter(ts.isVariableStatement).flatMap(n => [...n.declarationList.declarations]);
  const initializer = declarations.find(n => n.name.getText(ast) === "CODES")!.initializer!;
  assert(ts.isAsExpression(initializer) && ts.isArrayLiteralExpression(initializer.expression));
  for (const node of initializer.expression.elements) {
    assert(ts.isStringLiteral(node)); const code = node.text as OpenCreditCommercialOperationServiceCode;
    assert.equal(service.readOpenCreditCommercialOperationServiceErrorCode(new service.OpenCreditCommercialOperationServiceError(code)), code);
  }
});
test("operation error reader rejects forged codes/names/messages, plain or inherited records", () => {
  const read = service.readOpenCreditCommercialOperationServiceErrorCode;
  for (const code of ["__proto__", "constructor", "toString", "OTHER"]) assert.equal(read(Object.assign(new Error("OPENCREDIT_COMMERCIAL_OPERATION_" + code), { name: "OpenCreditCommercialOperationServiceError", code })), null);
  for (const error of [null, {}, { name: "OpenCreditCommercialOperationServiceError", code: "NOT_AUTHORIZED", message: "OPENCREDIT_COMMERCIAL_OPERATION_NOT_AUTHORIZED" },
    Object.assign(new Error("wrong"), { name: "OpenCreditCommercialOperationServiceError", code: "NOT_AUTHORIZED" }),
    Object.assign(new Error("OPENCREDIT_COMMERCIAL_OPERATION_NOT_AUTHORIZED"), { name: "wrong", code: "NOT_AUTHORIZED" }),
    Object.create(new service.OpenCreditCommercialOperationServiceError("NOT_AUTHORIZED"))]) assert.equal(read(error), null);
});
for (const key of ["name", "code", "message"]) test("operation error reader requires own data " + key + " without accessors", () => {
  let calls = 0;
  for (const descriptor of [{ get() { calls++; throw Error("private"); } }, { set(_value: unknown) { calls++; } }]) {
    const error = new service.OpenCreditCommercialOperationServiceError("NOT_AUTHORIZED"); Object.defineProperty(error, key, descriptor);
    assert.equal(service.readOpenCreditCommercialOperationServiceErrorCode(error), null);
  }
  const missing = new service.OpenCreditCommercialOperationServiceError("NOT_AUTHORIZED"); Reflect.deleteProperty(missing, key);
  assert.equal(service.readOpenCreditCommercialOperationServiceErrorCode(missing), null); assert.equal(calls, 0);
});
test("operation error reader does not inspect stack, cause, raw response, headers or body", () => {
  const error = new service.OpenCreditCommercialOperationServiceError("CONSUMER_AUTHORIZATION_INACTIVE"); let calls = 0;
  for (const key of ["stack", "cause", "body", "headers", "credentials", "response"]) Object.defineProperty(error, key, { get() { calls++; throw Error("private"); } });
  assert.equal(service.readOpenCreditCommercialOperationServiceErrorCode(error), "CONSUMER_AUTHORIZATION_INACTIVE"); assert.equal(calls, 0);
  const { proxy, revoke } = Proxy.revocable(new Error(), {}); revoke(); assert.equal(service.readOpenCreditCommercialOperationServiceErrorCode(proxy), null);
});
const scope = "synthetic-service" as OpenCreditPrepareClientProfileInput["providerScope"];
const intentKey = "00000000-0000-4000-8000-000000000000";
const prepare = (changes: Partial<OpenCreditPrepareClientProfileInput> = {}): OpenCreditPrepareClientProfileInput => ({ actor: { ...actor }, companyId: "synthetic-company", contactId: "synthetic-contact", providerScope: scope, intentKey, ...changes });
const transition = (expectedRevision = 0, changes: Partial<OpenCreditOperationTransitionInput> = {}): OpenCreditOperationTransitionInput => ({ actor: { ...actor }, companyId: "synthetic-company", operationId: "synthetic-operation", providerScope: scope, expectedRevision, ...changes });
async function configured(run: () => Promise<void>) {
  const company = process.env.PLATFORM_COMPANY_ID; const emails = process.env.PLATFORM_ADMIN_EMAILS;
  process.env.PLATFORM_COMPANY_ID = actor.companyId; process.env.PLATFORM_ADMIN_EMAILS = actor.email;
  try { await run(); } finally {
    if (company === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = company;
    if (emails === undefined) delete process.env.PLATFORM_ADMIN_EMAILS; else process.env.PLATFORM_ADMIN_EMAILS = emails;
  }
}
type Operation = { id: string; companyId: string; providerScope: string; remoteIdentityId: string; operationKind: string; state: string; revision: number; intentKey: string; createdByUserId: string; updatedAt: number };
const operation = (state = "PREPARED", revision = 0): Operation => ({ id: "synthetic-operation", companyId: "synthetic-company", providerScope: scope, remoteIdentityId: "synthetic-identity", operationKind: "CLIENT_PROFILE_UPSERT", state, revision, intentKey, createdByUserId: "synthetic-original", updatedAt: 1 });
function fake(initial?: string, revision = 0) {
  const state = {
    actor: { ...actor } as SessionUser | null, company: true, operation: initial === undefined ? null as Operation | null : operation(initial, revision),
    contact: { id: "synthetic-contact", companyId: "synthetic-company", name: " Synthetic profile ", phone: "0007A", email: " Fixture@Example.Invalid " as string | null, cpf: "00000000000" as string | null, archivedAt: null as Date | null } as { id: string; companyId: string; name: string; phone: string; email: string | null; cpf: string | null; archivedAt: Date | null } | null,
    identity: { id: "synthetic-identity", companyId: "synthetic-company", contactId: "synthetic-contact", providerScope: scope, normalizedCpf: "00000000000", enabled: true } as { id: string; companyId: string; contactId: string; providerScope: string; normalizedCpf: string; enabled: boolean } | null,
    access: { enabled: true } as { enabled: boolean } | null, matches: [{ id: "synthetic-contact" }], globalIdentity: true, events: [] as Record<string, unknown>[],
    authorization: { id: "synthetic-authorization", companyId: "synthetic-company", providerScope: scope, contactId: "synthetic-contact", purpose: "CLIENT_PROFILE_UPSERT", remoteIdentityId: "synthetic-identity", active: true, revision: 0, evidenceInboundEventId: "synthetic-evidence" } as { id: string; companyId: string; providerScope: string; contactId: string; purpose: string; remoteIdentityId: string; active: boolean; revision: number; evidenceInboundEventId: string } | null,
    authorizationEvent: { id: "synthetic-granted", authorizationId: "synthetic-authorization", companyId: "synthetic-company", providerScope: scope, revision: 0, action: "GRANTED", nextActive: true, evidenceInboundEventId: "synthetic-evidence" } as { id: string; authorizationId: string; companyId: string; providerScope: string; revision: number; action: string; nextActive: boolean; evidenceInboundEventId: string } | null
  };
  const calls: string[] = []; const faults: unknown[] = []; const options: unknown[] = []; let attempts = 0;
  let eventFailure: unknown; let commitFailure: unknown; let casCount: number | undefined; let onAttempt: (() => void) | undefined;
  const transaction = async (run: (tx: unknown) => Promise<unknown>, opts: unknown) => {
    attempts++; options.push(opts); onAttempt?.();
    let current = state.operation && { ...state.operation }; const events = [...state.events];
    const tx = {
      user: { findUnique: async (args: unknown) => { calls.push("actor"); assert.deepEqual(args, { where: { id: actor.id }, select: { id: true, companyId: true, role: true, email: true, name: true } }); return state.actor; } },
      company: { findUnique: async () => { calls.push("company"); return state.company ? { id: "synthetic-company" } : null; } },
      contact: {
        findUnique: async (args: unknown) => { calls.push("contact"); assert.deepEqual(args, { where: { companyId_id: { companyId: "synthetic-company", id: "synthetic-contact" } }, select: { id: true, companyId: true, name: true, phone: true, email: true, cpf: true, archivedAt: true } }); return state.contact; },
        findMany: async (args: unknown) => { calls.push("ambiguity"); assert.deepEqual(args, { where: { companyId: "synthetic-company", cpf: { in: ["00000000000", "000.000.000-00"] } }, take: 2, select: { id: true } }); return state.matches; }
      },
      openCreditCommercialAccess: { findUnique: async (args: unknown) => { calls.push("access"); assert.deepEqual(args, { where: { companyId_providerScope: { companyId: "synthetic-company", providerScope: scope } }, select: { enabled: true } }); return state.access; } },
      openCreditRemoteIdentity: { findUnique: async (args: { where: Record<string, unknown> }) => {
        if (args.where.providerScope_normalizedCpf) { calls.push("global"); return state.globalIdentity && state.identity ? { id: state.identity.id } : null; }
        calls.push("identity");
        if (args.where.id_companyId_providerScope) assert.deepEqual(args.where, { id_companyId_providerScope: { id: "synthetic-identity", companyId: "synthetic-company", providerScope: scope } });
        else assert.deepEqual(args.where, { companyId_providerScope_contactId: { companyId: "synthetic-company", providerScope: scope, contactId: "synthetic-contact" } });
        return state.identity;
      } },
      openCreditConsumerAuthorization: { findUnique: async (args: { where: unknown }) => {
        calls.push("authorization.read"); assert.deepEqual(args.where, { companyId_providerScope_contactId_purpose: { companyId: "synthetic-company", providerScope: scope, contactId: "synthetic-contact", purpose: "CLIENT_PROFILE_UPSERT" } }); return state.authorization;
      } },
      openCreditConsumerAuthorizationEvent: { findUnique: async (args: { where: unknown }) => {
        calls.push("authorization-event.read"); assert.deepEqual(args.where, { authorizationId_revision: { authorizationId: state.authorization!.id, revision: state.authorization!.revision } }); return state.authorizationEvent;
      } },
      openCreditCommercialOperation: {
        findUnique: async (args: { where: Record<string, unknown> }) => { calls.push("operation.read");
          const key = args.where.companyId_providerScope_intentKey ?? args.where.id_companyId_providerScope;
          assert.deepEqual(args.where, args.where.companyId_providerScope_intentKey
            ? { companyId_providerScope_intentKey: { companyId: "synthetic-company", providerScope: scope, intentKey } }
            : { id_companyId_providerScope: { id: "synthetic-operation", companyId: "synthetic-company", providerScope: scope } });
          assert.ok(key); return current;
        },
        create: async ({ data }: { data: Omit<Operation, "id" | "updatedAt"> }) => { calls.push("operation.create"); if (faults.length) throw faults.shift(); current = { ...data, id: "synthetic-operation", updatedAt: 2 }; return { id: current.id }; },
        updateMany: async ({ where, data }: { where: { id: string; companyId: string; providerScope: string; state: string; revision: number }; data: { state: string; revision: number } }) => {
          calls.push("operation.cas"); assert.deepEqual(Object.keys(data).sort(), ["revision", "state"]);
          assert.deepEqual(where, { id: "synthetic-operation", companyId: "synthetic-company", providerScope: scope, state: current!.state, revision: current!.revision });
          assert.equal(data.revision, where.revision + 1); if (faults.length) throw faults.shift(); if (casCount !== undefined) return { count: casCount };
          assert.ok(current); current = { ...current, ...data, updatedAt: 2 }; return { count: 1 };
        }
      },
      openCreditCommercialOperationEvent: { create: async ({ data }: { data: Record<string, unknown> }) => {
        calls.push("event.create"); if (eventFailure) throw eventFailure;
        assert.deepEqual(Object.keys(data).sort(), ["operationId", "companyId", "providerScope", "actorUserId", "action", "previousState", "nextState", "revision", ...(data.action === "RESERVED_FOR_DISPATCH" ? ["dispatchAuthorizationEventId"] : [])].sort());
        events.push(data); return { id: "synthetic-event" };
      } }
    };
    const result = await run(tx); if (commitFailure) throw commitFailure; state.operation = current; state.events = events; return result;
  };
  return { state, calls, faults, options, attempts: () => attempts, failEvent: (e: unknown) => { eventFailure = e; }, failCommit: (e: unknown) => { commitFailure = e; }, casCount: (n: number) => { casCount = n; }, onAttempt: (fn: () => void) => { onAttempt = fn; }, db: { $transaction: transaction } as unknown as Parameters<typeof service.prepareOpenCreditClientProfileOperation>[0] };
}
const prismaError = (code: string, meta?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError("private-fixture", { code, clientVersion: "5.22.0", meta });
async function denied(run: () => Promise<unknown>, code: OpenCreditCommercialOperationServiceCode) {
  await assert.rejects(run, error => {
    assert.ok(error instanceof service.OpenCreditCommercialOperationServiceError); assert.equal(error.code, code);
    assert.equal(error.message, "OPENCREDIT_COMMERCIAL_OPERATION_" + code); assert.equal("cause" in error, false); assert.equal("profile" in error, false);
    assert.doesNotMatch(error.message + JSON.stringify(error), /00000000000|synthetic-|Fixture@|private-fixture/); return true;
  });
}
const observed = (success = true, created = true, status = 201): OpenCreditCreateClientObservation => ({ kind: "PARSED_RESPONSE", status, result: { success, created } });
const modes = ["prepare", "reserve", "unknown", "settle"] as const;
async function invoke(mode: typeof modes[number], f: ReturnType<typeof fake>, supplied?: unknown) {
  return mode === "prepare" ? service.prepareOpenCreditClientProfileOperation(f.db, (supplied ?? prepare()) as OpenCreditPrepareClientProfileInput)
    : mode === "reserve" ? service.reserveOpenCreditClientProfileOperationForDispatch(f.db, (supplied ?? transition()) as OpenCreditOperationTransitionInput)
    : mode === "unknown" ? service.markOpenCreditCommercialOperationUnknown(f.db, (supplied ?? transition(1)) as OpenCreditOperationTransitionInput)
    : service.applyOpenCreditCreateClientObservation(f.db, (supplied ?? transition(1)) as OpenCreditOperationTransitionInput, observed());
}
test("prepare creates exactly one PREPARED event atomically, returning no profile/PII", () => configured(async () => {
  const f = fake(); assert.deepEqual(await invoke("prepare", f), { changed: true, operationId: "synthetic-operation", state: "PREPARED", revision: 0 });
  assert.deepEqual(f.state.events, [{ operationId: "synthetic-operation", companyId: "synthetic-company", providerScope: scope, actorUserId: actor.id, action: "PREPARED", previousState: null, nextState: "PREPARED", revision: 0 }]);
  assert.equal(f.state.operation!.createdByUserId, actor.id); assert.deepEqual(f.options, [{ isolationLevel: "Serializable", maxWait: 2000, timeout: 5000 }]);
}));
for (const state of ["PREPARED", "IN_FLIGHT", "SUCCEEDED", "FAILED", "UNKNOWN"]) test("same intent " + state + " precedes freshness and is a true no-op", () => configured(async () => {
  const f = fake(state, 2); f.state.contact = null; f.state.access = null; f.state.identity!.enabled = false; const before = { ...f.state.operation };
  assert.deepEqual(await invoke("prepare", f), { changed: false, operationId: "synthetic-operation", state, revision: 2 });
  assert.deepEqual(f.state.operation, before); assert.deepEqual(f.state.events, []); assert.deepEqual(f.calls, ["actor", "company", "operation.read", "identity"]);
}));
for (const kind of ["SIMULATION", "PROPOSAL", "OTHER"]) test("prepare rejects arbitrary kind of existing intention " + kind, () => configured(async () => { const f = fake("PREPARED"); f.state.operation!.operationKind = kind; await denied(() => invoke("prepare", f), "INTENT_CONFLICT"); }));
test("existing intent with another Contact is conflict", () => configured(async () => { const f = fake("PREPARED"); f.state.identity!.contactId = "other"; await denied(() => invoke("prepare", f), "INTENT_CONFLICT"); }));
test("unrecognized stored state is not interpreted", () => configured(async () => { const f = fake("OTHER"); await denied(() => invoke("prepare", f), "OPERATION_STATE_INVALID"); }));
test("reserve returns freshly mapped memory-only profile only after commit", () => configured(async () => {
  const f = fake("PREPARED"); const result = await invoke("reserve", f); const profile = { cpf: "00000000000", nome: f.state.contact!.name, celular: f.state.contact!.phone, email: f.state.contact!.email };
  assert.deepEqual(result, { operationId: "synthetic-operation", state: "IN_FLIGHT", revision: 1, profile, profileJson: JSON.stringify(profile), dispatchAuthorization: { authorizationId: "synthetic-authorization", authorizationRevision: 0, authorizationEventId: "synthetic-granted" } });
  assert.deepEqual(f.state.events.map(e => [e.action, e.previousState, e.nextState, e.revision]), [["RESERVED_FOR_DISPATCH", "PREPARED", "IN_FLIGHT", 1]]);
}));
test("serialization fault after authorization aborts before CAS and Event", () => configured(async () => {
  const f = fake("PREPARED"); serializerFailure = true;
  try { await denied(() => invoke("reserve", f), "PROFILE_INVALID"); }
  finally { serializerFailure = false; }
  assert(f.calls.includes("authorization-event.read")); assert(!f.calls.includes("operation.cas"));
  assert.equal(f.state.operation!.state, "PREPARED"); assert.deepEqual(f.state.events, []);
}));
for (const state of ["IN_FLIGHT", "SUCCEEDED", "FAILED", "UNKNOWN", "OTHER"]) test("reserve refuses " + state + " without exposing profile", () => configured(async () => { const f = fake(state, 1); await denied(() => invoke("reserve", f), "OPERATION_STATE_CONFLICT"); assert.equal(f.calls.includes("contact"), false); assert.deepEqual(f.state.events, []); }));
test("wrong expected revision is semantic conflict before freshness/CAS", () => configured(async () => { const f = fake("PREPARED", 2); await denied(() => invoke("reserve", f), "OPERATION_REVISION_CONFLICT"); assert.equal(f.calls.includes("contact"), false); }));
test("CAS zero count fails without result/profile or event", () => configured(async () => { const f = fake("PREPARED"); f.casCount(0); await denied(() => invoke("reserve", f), "OPERATION_REVISION_CONFLICT"); assert.equal(f.state.operation!.state, "PREPARED"); assert.deepEqual(f.state.events, []); }));
test("invalid fresh profile blocks before CAS", () => configured(async () => { const f = fake("PREPARED"); f.state.contact!.name = ""; await denied(() => invoke("reserve", f), "PROFILE_INVALID"); assert.equal(f.calls.includes("operation.cas"), false); }));
test("mark UNKNOWN does not read identity/access/Contact, even when all are unusable", () => configured(async () => {
  const f = fake("IN_FLIGHT", 1); f.state.contact = null; f.state.identity = null; f.state.access = null;
  assert.deepEqual(await invoke("unknown", f), { changed: true, operationId: "synthetic-operation", state: "UNKNOWN", revision: 2 });
  assert.deepEqual(f.calls, ["actor", "company", "operation.read", "operation.cas", "event.create"]);
  assert.deepEqual(f.state.events.map(e => [e.action, e.previousState, e.nextState, e.revision]), [["MARKED_UNKNOWN", "IN_FLIGHT", "UNKNOWN", 2]]);
}));
test("repeated UNKNOWN ignores older valid revision but writes nothing", () => configured(async () => { const f = fake("UNKNOWN", 2); const before = { ...f.state.operation }; assert.deepEqual(await invoke("unknown", f, transition(0)), { changed: false, operationId: "synthetic-operation", state: "UNKNOWN", revision: 2 }); assert.deepEqual(f.state.operation, before); assert.deepEqual(f.state.events, []); }));
for (const state of ["PREPARED", "SUCCEEDED", "FAILED", "OTHER"]) test("mark UNKNOWN refuses " + state, () => configured(async () => { const f = fake(state); await denied(() => invoke("unknown", f), "OPERATION_STATE_CONFLICT"); }));
for (const mode of modes) for (const role of ["ADMIN", "SUPERVISOR", "AGENT"] as const) test(mode + " denies Company " + role, () => configured(async () => { const f = fake(); const input = mode === "prepare" ? prepare({ actor: { ...actor, companyId: "synthetic-company", role } }) : transition(0, { actor: { ...actor, companyId: "synthetic-company", role } }); await denied(() => invoke(mode, f, input), "NOT_AUTHORIZED"); assert.equal(f.attempts(), 0); }));
for (const mode of modes) for (const changed of [null, { ...actor, id: "other" }, { ...actor, companyId: "other" }, { ...actor, role: "AGENT" as const }, { ...actor, email: "other@example.invalid" }]) test(mode + " stale actor case " + (changed === null ? "removed" : Object.entries(changed).find(([k, v]) => actor[k as keyof SessionUser] !== v)?.[0]), () => configured(async () => { const f = fake(); f.state.actor = changed; await denied(() => invoke(mode, f), "NOT_AUTHORIZED"); assert.deepEqual(f.calls, ["actor"]); }));
for (const mode of modes) test(mode + " rechecks Platform Admin rule within transaction", () => configured(async () => { const f = fake(); f.onAttempt(() => { process.env.PLATFORM_COMPANY_ID = "other"; }); await denied(() => invoke(mode, f), "NOT_AUTHORIZED"); }));
for (const key of ["companyId", "contactId", "operationId"] as const) for (const value of ["", " leading", "bad/path", "bad\n", "x".repeat(129), 1, null]) test("strict id " + key + ":" + typeof value + String(value).length, () => configured(async () => {
  const f = fake(); const mode = key === "contactId" ? "prepare" : "reserve"; const supplied = mode === "prepare" ? { ...prepare(), [key]: value } : { ...transition(), [key]: value };
  await denied(() => invoke(mode, f, supplied), key === "companyId" ? "INVALID_COMPANY" : key === "contactId" ? "INVALID_CONTACT" : "INVALID_OPERATION"); assert.equal(f.attempts(), 0);
}));
for (const value of ["", "BAD", "bad_scope", "synthetic-00000000000", null, 1, {}]) test("scope syntax revalidated " + typeof value + String(value).length, () => configured(async () => { const f = fake(); await denied(() => invoke("prepare", f, { ...prepare(), providerScope: value }), "INVALID_PROVIDER_SCOPE"); assert.equal(f.attempts(), 0); }));
for (const value of ["", " "+intentKey, intentKey+"\n", intentKey.replace("4000","3000"), intentKey.replace("8000","7000"), "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", "synthetic-intent-"+intentKey, "00000000000", 1, null, {}]) test("UUID v4 strict no coercion " + typeof value + String(value).length, () => configured(async () => { const f = fake(); await denied(() => invoke("prepare", f, { ...prepare(), intentKey: value }), "INVALID_INTENT_KEY"); assert.equal(f.attempts(), 0); }));
for (const value of [-1, 0.5, NaN, Infinity, 2147483647, 2147483648, Number.MAX_SAFE_INTEGER, "0", null, true, undefined]) test("expectedRevision invalid " + typeof value + String(value), () => configured(async () => { const f = fake(); await denied(() => invoke("reserve", f, { ...transition(), expectedRevision: value }), "INVALID_REVISION"); assert.equal(f.attempts(), 0); }));
test("largest allowed increment fits PostgreSQL Int", () => configured(async () => { const f = fake("PREPARED", 2147483646); const result = await invoke("reserve", f, transition(2147483646)); assert.equal(result.revision, 2147483647); }));
for (const mode of modes) for (const key of ["operationKind", "remoteIdentityId", "cpf", "profile", "payload", "bankId", "tenantId", "partnerId", "token", "consent", "evidence", "simulationId", "proposalId"]) test(mode + " rejects extra " + key, () => configured(async () => { const f = fake(); await denied(() => invoke(mode, f, { ...(mode === "prepare" ? prepare() : transition()), [key]: true }), mode === "prepare" ? "INVALID_COMPANY" : "INVALID_OPERATION"); assert.equal(f.attempts(), 0); }));
for (const mode of modes) test(mode + " rejects getters/inheritance/symbols without invoking getters", () => configured(async () => {
  const f = fake(); const supplied = mode === "prepare" ? prepare() : transition(); const code = mode === "prepare" ? "INVALID_COMPANY" : "INVALID_OPERATION";
  for (const key of Object.keys(supplied)) { const copy = { ...supplied }; let called = false; Object.defineProperty(copy, key, { enumerable: true, get() { called = true; throw Error("private-fixture"); } }); await denied(() => invoke(mode, f, copy), code); assert.equal(called, false); }
  const accessor = prepare(); let called = false; Object.defineProperty(accessor.actor, "email", { enumerable: true, get() { called = true; throw Error("private-fixture"); } });
  await denied(() => invoke("prepare", f, accessor), "NOT_AUTHORIZED"); assert.equal(called, false);
  await denied(() => invoke(mode, f, Object.assign(Object.create({ inherited: true }), supplied)), code);
  await denied(() => invoke(mode, f, { ...supplied, [Symbol("extra")]: true }), code); assert.equal(f.attempts(), 0);
}));
for (const [label, setup, code] of [
  ["missing Company", (f: ReturnType<typeof fake>) => { f.state.company = false; }, "COMPANY_NOT_FOUND"],
  ["missing Contact", (f: ReturnType<typeof fake>) => { f.state.contact = null; }, "CONTACT_NOT_FOUND"],
  ["archived", (f: ReturnType<typeof fake>) => { f.state.contact!.archivedAt = new Date(); }, "CONTACT_ARCHIVED"],
  ["missing CPF", (f: ReturnType<typeof fake>) => { f.state.contact!.cpf = null; }, "CONTACT_CPF_MISSING"],
  ["invalid CPF", (f: ReturnType<typeof fake>) => { f.state.contact!.cpf = "bad"; }, "CONTACT_CPF_INVALID"],
  ["ambiguous", (f: ReturnType<typeof fake>) => { f.state.matches.push({ id: "other" }); }, "CONTACT_AMBIGUOUS"],
  ["missing access", (f: ReturnType<typeof fake>) => { f.state.access = null; }, "COMMERCIAL_ACCESS_MISSING"],
  ["disabled access", (f: ReturnType<typeof fake>) => { f.state.access!.enabled = false; }, "COMMERCIAL_ACCESS_DISABLED"],
  ["missing identity", (f: ReturnType<typeof fake>) => { f.state.identity = null; }, "IDENTITY_NOT_FOUND"],
  ["disabled identity", (f: ReturnType<typeof fake>) => { f.state.identity!.enabled = false; }, "IDENTITY_DISABLED"],
  ["snapshot mismatch", (f: ReturnType<typeof fake>) => { f.state.identity!.normalizedCpf = "11111111111"; }, "IDENTITY_SNAPSHOT_MISMATCH"],
  ["global ownership mismatch", (f: ReturnType<typeof fake>) => { f.state.globalIdentity = false; }, "IDENTITY_CONFLICT"],
  ["invalid profile", (f: ReturnType<typeof fake>) => { f.state.contact!.name = ""; }, "PROFILE_INVALID"]
] as const) for (const mode of ["prepare", "reserve"] as const) test(mode + " fails closed for " + label, () => configured(async () => { const f = fake(mode === "prepare" ? undefined : "PREPARED"); setup(f); await denied(() => invoke(mode, f), code); assert.equal(f.calls.some(c => ["operation.create","operation.cas","event.create"].includes(c)), false); }));
for (const target of ["OCOperation_company_scope_intent_key", ["companyId", "providerScope", "intentKey"]]) test("prepare bounded retry of expected P2002 metadata " + typeof target, () => configured(async () => { const f = fake(); f.faults.push(prismaError("P2002", { modelName: "OpenCreditCommercialOperation", target })); assert.equal((await invoke("prepare", f)).revision, 0); assert.equal(f.attempts(), 2); assert.equal(f.state.events.length, 1); }));
for (const meta of [{ target: ["id"] }, { target: "OCOperation_id_company_scope_key" }, { target: "unknown" }, { modelName: "OpenCreditCommercialOperationEvent", target: "OCOperation_company_scope_intent_key" }]) test("unexpected P2002 not retried " + JSON.stringify(meta), () => configured(async () => { const f = fake(); f.faults.push(prismaError("P2002", meta)); await denied(() => invoke("prepare", f), "STORAGE_ERROR"); assert.equal(f.attempts(), 1); }));
for (const mode of modes) test(mode + " P2034 bounded, rereads actor every attempt", () => configured(async () => { const f = fake(mode === "prepare" ? undefined : mode === "reserve" ? "PREPARED" : "IN_FLIGHT", mode === "unknown" || mode === "settle" ? 1 : 0); f.faults.push(...Array.from({ length: 3 }, () => prismaError("P2034"))); await denied(() => invoke(mode, f), "CONCURRENT_CONFLICT"); assert.equal(f.attempts(), 3); assert.equal(f.calls.filter(c => c === "actor").length, 3); assert.equal(f.state.events.length, 0); }));
test("expected prepare P2002 exhaustion is bounded", () => configured(async () => { const f = fake(); f.faults.push(...Array.from({ length: 3 }, () => prismaError("P2002", { target: "OCOperation_company_scope_intent_key" }))); await denied(() => invoke("prepare", f), "CONCURRENT_CONFLICT"); assert.equal(f.attempts(), 3); }));
test("prepare retry rereads winning intent rather than creating another", () => configured(async () => { const f = fake(); f.faults.push(prismaError("P2002", { target: "OCOperation_company_scope_intent_key" })); f.onAttempt(() => { if (f.attempts() === 2) f.state.operation = operation(); }); assert.equal((await invoke("prepare", f) as { changed: boolean }).changed, false); assert.equal(f.state.events.length, 0); }));
test("reserve loser after transactional retry never gets profile", () => configured(async () => { const f = fake("PREPARED"); f.faults.push(prismaError("P2034")); f.onAttempt(() => { if (f.attempts() === 2) f.state.operation = operation("IN_FLIGHT", 1); }); await denied(() => invoke("reserve", f), "OPERATION_STATE_CONFLICT"); assert.equal(f.calls.filter(c => c === "contact").length, 1); }));
test("retry revalidates stale actor", () => configured(async () => { const f = fake(); f.failEvent(prismaError("P2034")); f.onAttempt(() => { if (f.attempts() === 2) f.state.actor = null; }); await denied(() => invoke("prepare", f), "NOT_AUTHORIZED"); assert.equal(f.attempts(), 2); assert.equal(f.state.operation, null); }));
for (const mode of ["reserve", "unknown", "settle"] as const) test(mode + " does not retry P2002", () => configured(async () => { const f = fake(mode === "reserve" ? "PREPARED" : "IN_FLIGHT", mode !== "reserve" ? 1 : 0); f.faults.push(prismaError("P2002", { target: "OCOperation_company_scope_intent_key" })); await denied(() => invoke(mode, f), "STORAGE_ERROR"); assert.equal(f.attempts(), 1); }));
for (const mode of modes) test(mode + " Event failure rolls back mutation", () => configured(async () => { const f = fake(mode === "prepare" ? undefined : mode === "reserve" ? "PREPARED" : "IN_FLIGHT", mode === "unknown" || mode === "settle" ? 1 : 0); const before = f.state.operation && { ...f.state.operation }; f.failEvent(prismaError("P2003")); await denied(() => invoke(mode, f), "STORAGE_ERROR"); assert.deepEqual(f.state.operation, before); assert.equal(f.state.events.length, 0); }));
test("commit failure never returns the prebuilt profile", () => configured(async () => { const f = fake("PREPARED"); f.failCommit(new Error("private-fixture")); await denied(() => invoke("reserve", f), "STORAGE_ERROR"); assert.equal(f.state.operation!.state, "PREPARED"); assert.equal(f.state.events.length, 0); }));
const env = { CI: "true", GITHUB_ACTIONS: "true", OPENCREDIT_COMMERCIAL_OPERATION_SERVICE_POSTGRES_TEST: "1", DATABASE_URL: "postgresql://qevora_ci:qevora_ci_password@127.0.0.1:5432/qevora_ci?schema=public" };
test("material guard strictly limits flags, loopback, schema, credentials and ports", () => {
  for (const host of ["localhost","127.0.0.1"]) for (const port of [5432,55432]) assert.doesNotThrow(() => assertOpenCreditCommercialOperationServiceTestDatabase({ ...env, DATABASE_URL: env.DATABASE_URL.replace("127.0.0.1:5432", host+":"+port) }));
  for (const key of Object.keys(env)) for (const value of [undefined,"","false","unsafe"]) assert.throws(() => assertOpenCreditCommercialOperationServiceTestDatabase({ ...env, [key]: value }));
  for (const url of [env.DATABASE_URL.replace("127.0.0.1","production.invalid"),env.DATABASE_URL.replace(":5432",":5433"),env.DATABASE_URL.replace("schema=public","schema=other"),env.DATABASE_URL+"#fragment",env.DATABASE_URL+"&sslmode=disable",env.DATABASE_URL.replace("postgresql:","postgres:")]) assert.throws(() => assertOpenCreditCommercialOperationServiceTestDatabase({ ...env, DATABASE_URL: url }));
});
test("exact exports, server-only, no provider/reset API or unrelated runtime caller", () => {
  const source = readFileSync(new URL("./opencredit-commercial-operation.service.ts", import.meta.url), "utf8");
  assert.match(source, /^import "server-only";/);
  assert.doesNotMatch(source, /\bfetch\b|opencredit-api-client|readOpenCreditStrictJsonResponse|\.request\s*\(|console\.|process\.env|logger|\$executeRaw|\$queryRaw|setTimeout|new PrismaClient|\.delete\(|\.upsert\(|\.createMany\(/);
  assert.deepEqual(Object.keys(service).sort(), ["OpenCreditCommercialOperationServiceError", "readOpenCreditCommercialOperationServiceErrorCode", "prepareOpenCreditClientProfileOperation", "reserveOpenCreditClientProfileOperationForDispatch", "markOpenCreditCommercialOperationUnknown", "applyOpenCreditCreateClientObservation"].sort());
  assert.doesNotMatch(source, /data:\s*\{\s*state:\s*"(?:FAILED|PREPARED)"/);
  assert.match(source, /buildOpenCreditClientProfileFromContact/);
  function scan(dir: URL) { for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = new URL(e.name+(e.isDirectory()?"/":""),dir); if(e.isDirectory()) scan(path);
    else if (/\.(tsx?|m?js|cjs)$/.test(e.name) && !/\.(test|integration)\./.test(e.name) && path.href !== new URL("./opencredit-commercial-operation.service.ts", import.meta.url).href) {
      const ast = ts.createSourceFile(path.pathname, readFileSync(path,"utf8"), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isStringLiteralLike(node) && /(?:^|\/)opencredit-commercial-operation\.service(?:\.[cm]?[jt]s)?$/.test(node.text)) {
          assert.equal(path.href, new URL("./opencredit-create-client-dispatcher.ts", import.meta.url).href);
          assert(ts.isImportDeclaration(node.parent));
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
  } }
  scan(new URL("../",import.meta.url)); scan(new URL("../../scripts/",import.meta.url));
  const ci = readFileSync(new URL("../../.github/workflows/ci.yml",import.meta.url),"utf8"); assert.match(ci,/tsx@4\.20\.6 src\/lib\/opencredit-commercial-operation-service.test.ts/); assert.match(ci,/OPENCREDIT_COMMERCIAL_OPERATION_SERVICE_POSTGRES_TEST: "1"/);
  const material = readFileSync(new URL("./opencredit-commercial-operation-service-postgres.integration.ts",import.meta.url),"utf8");
  const guardAt = material.indexOf("assertOpenCreditCommercialOperationServiceTestDatabase(process.env)"); assert.ok(guardAt >= 0 && material.indexOf("new PrismaClient") > guardAt);
});

for (const created of [true, false]) test("settlement SUCCEEDED " + created + " records only exact action and safe result, without freshness", () => configured(async () => {
  const f = fake("IN_FLIGHT", 1); f.state.contact = null; f.state.identity = null; f.state.access = null; f.state.matches = [];
  const result = await service.applyOpenCreditCreateClientObservation(f.db, transition(1), observed(true, created));
  assert.deepEqual(result, { changed: true, operationId: "synthetic-operation", state: "SUCCEEDED", revision: 2 });
  assert.deepEqual(f.calls, ["actor", "company", "operation.read", "operation.cas", "event.create"]);
  assert.deepEqual(f.options, [{ isolationLevel: "Serializable", maxWait: 2000, timeout: 5000 }]);
  assert.deepEqual(f.state.events, [{ operationId: "synthetic-operation", companyId: "synthetic-company", providerScope: scope, actorUserId: actor.id,
    action: created ? "MARKED_SUCCEEDED_CREATED" : "MARKED_SUCCEEDED_UPDATED", previousState: "IN_FLIGHT", nextState: "SUCCEEDED", revision: 2 }]);
  assert.equal(f.state.operation!.createdByUserId, "synthetic-original");
}));
const unknownObservations: OpenCreditCreateClientObservation[] = [observed(false, false), observed(false, true),
  ...[200, 202, 400, 401, 403, 409, 422, 429, 500, 502, 503, 504].map(status => observed(true, true, status)),
  ...(["INVALID_CONTENT_TYPE", "TOO_LARGE", "INVALID_UTF8", "INVALID_JSON", "STREAM_ERROR"] as const).map(reason => ({ kind: "UNREADABLE_RESPONSE" as const, status: 201, reason })),
  { kind: "NO_RESPONSE", reason: "TIMEOUT" }, { kind: "NO_RESPONSE", reason: "NETWORK" }];
for (const { index, observation } of unknownObservations.map((observation, index) => ({ index, observation }))) test("outcome UNKNOWN uses identical protective transition " + index, () => configured(async () => {
  const f = fake("IN_FLIGHT", 1), original = fake("IN_FLIGHT", 1);
  f.state.contact = null; f.state.access = null; f.state.identity = null;
  assert.deepEqual(await service.applyOpenCreditCreateClientObservation(f.db, transition(1), observation), await service.markOpenCreditCommercialOperationUnknown(original.db, transition(1)));
  assert.deepEqual(f.state.events, original.state.events); assert.deepEqual(f.state.operation, original.state.operation);
  assert.deepEqual(f.calls, ["actor", "company", "operation.read", "operation.cas", "event.create"]);
}));
for (const state of ["SUCCEEDED", "UNKNOWN"] as const) test("same terminal " + state + " no-op ignores stale valid revision and preserves first history/timestamps", () => configured(async () => {
  const f = fake(state, 2); f.state.events.push({ action: state === "SUCCEEDED" ? "MARKED_SUCCEEDED_CREATED" : "MARKED_UNKNOWN" });
  const before = structuredClone(f.state.operation), events = structuredClone(f.state.events);
  const observation = state === "SUCCEEDED" ? observed(true, false) : observed(false, false);
  assert.deepEqual(await service.applyOpenCreditCreateClientObservation(f.db, transition(0), observation), { changed: false, operationId: "synthetic-operation", state, revision: 2 });
  assert.deepEqual(f.calls, ["actor", "company", "operation.read"]); assert.deepEqual(f.state.operation, before); assert.deepEqual(f.state.events, events);
}));
for (const [state, observation] of [["UNKNOWN", observed()], ["SUCCEEDED", observed(false, false)],
  ...["PREPARED", "FAILED", "UNRECOGNIZED"].flatMap(state => [[state, observed()], [state, observed(false, false)]])] as Array<[string, OpenCreditCreateClientObservation]>) {
  test("settlement rejects terminal/direct/conflicting state " + state + "/" + JSON.stringify(observation), () => configured(async () => {
    const f = fake(state, 1), before = { ...f.state.operation };
    await denied(() => service.applyOpenCreditCreateClientObservation(f.db, transition(1), observation), "OPERATION_STATE_CONFLICT");
    assert.deepEqual(f.state.operation, before); assert.deepEqual(f.state.events, []); assert.equal(f.calls.includes("operation.cas"), false);
  }));
}
for (const key of ["state", "basis", "status", "success", "created"]) test("transition caller cannot select outcome through " + key, () => configured(async () => {
  const f = fake("IN_FLIGHT", 1);
  await denied(() => service.applyOpenCreditCreateClientObservation(f.db, { ...transition(1), [key]: true }, observed()), "INVALID_OPERATION");
  assert.equal(f.attempts(), 0); assert.deepEqual(f.state.events, []);
}));
test("settlement wrong revision fails before CAS", () => configured(async () => {
  const f = fake("IN_FLIGHT", 1); await denied(() => service.applyOpenCreditCreateClientObservation(f.db, transition(0), observed()), "OPERATION_REVISION_CONFLICT");
  assert.equal(f.calls.includes("operation.cas"), false); assert.deepEqual(f.state.events, []);
}));
for (const count of [0, 2, -1, NaN]) test("settlement CAS count " + count + " fails with zero Event", () => configured(async () => {
  const f = fake("IN_FLIGHT", 1); f.casCount(count);
  await denied(() => service.applyOpenCreditCreateClientObservation(f.db, transition(1), observed()), count === 0 ? "OPERATION_REVISION_CONFLICT" : "STORAGE_ERROR");
  assert.deepEqual(f.state.operation, operation("IN_FLIGHT", 1)); assert.deepEqual(f.state.events, []); assert.equal(f.calls.includes("event.create"), false);
}));
test("settlement commit failure cannot report success", () => configured(async () => {
  const f = fake("IN_FLIGHT", 1); f.failCommit(new Error("private-fixture")); await denied(() => invoke("settle", f), "STORAGE_ERROR");
  assert.deepEqual(f.state.operation, operation("IN_FLIGHT", 1)); assert.deepEqual(f.state.events, []);
}));
test("settlement P2034 rereads actor and operation then commits one terminal event", () => configured(async () => {
  const f = fake("IN_FLIGHT", 1); f.faults.push(prismaError("P2034"));
  assert.equal((await invoke("settle", f)).state, "SUCCEEDED"); assert.equal(f.attempts(), 2);
  assert.equal(f.calls.filter(c => c === "actor").length, 2); assert.equal(f.calls.filter(c => c === "operation.read").length, 2);
  assert.equal(f.state.events.length, 1); assert.equal(f.state.operation!.revision, 2);
}));
for (const winner of ["SUCCEEDED", "UNKNOWN"] as const) test("settlement retry observes terminal winner " + winner + " without overwrite", () => configured(async () => {
  const f = fake("IN_FLIGHT", 1); f.faults.push(prismaError("P2034"));
  f.onAttempt(() => { if (f.attempts() === 2) f.state.operation = operation(winner, 2); });
  if (winner === "SUCCEEDED") assert.equal((await invoke("settle", f) as { changed: boolean }).changed, false);
  else await denied(() => invoke("settle", f), "OPERATION_STATE_CONFLICT");
  assert.deepEqual(f.state.events, []); assert.equal(f.state.operation!.state, winner); assert.equal(f.state.operation!.revision, 2);
}));
test("settlement retry cannot bypass newly stale actor", () => configured(async () => {
  const f = fake("IN_FLIGHT", 1); f.faults.push(prismaError("P2034")); f.onAttempt(() => { if (f.attempts() === 2) f.state.actor = null; });
  await denied(() => invoke("settle", f), "NOT_AUTHORIZED"); assert.deepEqual(f.state.events, []); assert.equal(f.state.operation!.state, "IN_FLIGHT");
}));
test("invalid/accessor/hostile observations reject without transaction or retained input", () => configured(async () => {
  const f = fake("IN_FLIGHT", 1); let calls = 0;
  const accessor = { kind: "PARSED_RESPONSE", status: 201, get result() { calls++; throw Error("private-fixture"); } };
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  for (const observation of [null, undefined, {}, { ...observed(), status: 99 }, { ...observed(), body: "private-fixture" },
    { kind: "PARSED_RESPONSE", status: 201, result: { success: "true", created: true } }, accessor,
    new Proxy({}, { getOwnPropertyDescriptor() { throw Error("private-fixture"); } }), proxy]) {
    await denied(() => service.applyOpenCreditCreateClientObservation(f.db, transition(1), observation as OpenCreditCreateClientObservation), "INVALID_OBSERVATION");
  }
  assert.equal(calls, 0); assert.equal(f.attempts(), 0); assert.deepEqual(f.state.events, []); assert.deepEqual(f.state.operation, operation("IN_FLIGHT", 1));
}));
for (const [label, change] of [
  ["scope", (f: ReturnType<typeof fake>) => { f.state.operation!.providerScope = "other"; }],
  ["company", (f: ReturnType<typeof fake>) => { f.state.operation!.companyId = "other"; }],
  ["kind", (f: ReturnType<typeof fake>) => { f.state.operation!.operationKind = "OTHER"; }],
  ["missing", (f: ReturnType<typeof fake>) => { f.state.operation = null; }]
] as const) test("settlement fails closed for " + label, () => configured(async () => {
  const f = fake("IN_FLIGHT", 1); change(f); await denied(() => invoke("settle", f), label === "missing" ? "OPERATION_NOT_FOUND" : "OPERATION_KIND_MISMATCH");
  assert.equal(f.calls.includes("operation.cas"), false);
}));

const corruptAuthorization: [string, string, unknown][] = [
  ["id", "id", ""], ["company", "companyId", "other"], ["scope", "providerScope", "other"],
  ["contact", "contactId", "other"], ["purpose", "purpose", "OTHER"], ["identity", "remoteIdentityId", "other"],
  ["active type", "active", "true"], ["negative revision", "revision", -1], ["fraction revision", "revision", 0.5],
  ["unsafe revision", "revision", Number.MAX_SAFE_INTEGER + 1], ["NaN revision", "revision", NaN],
  ["evidence empty", "evidenceInboundEventId", ""], ["evidence invalid", "evidenceInboundEventId", "bad/path"]
];
for (const [label, key, value] of corruptAuthorization) test("reserve blocks malformed authorization " + label, () => configured(async () => {
  const f = fake("PREPARED"); (f.state.authorization as unknown as Record<string, unknown>)[key] = value;
  await denied(() => invoke("reserve", f), "CONSUMER_AUTHORIZATION_MISMATCH");
  assert.equal(f.state.operation!.state, "PREPARED"); assert.deepEqual(f.state.events, []);
  assert.equal(f.calls.includes("operation.cas"), false);
}));
for (const active of [null, false]) test("reserve blocks authorization " + (active === null ? "missing" : "inactive"), () => configured(async () => {
  const f = fake("PREPARED");
  if (active === null) f.state.authorization = null; else f.state.authorization!.active = false;
  await denied(() => invoke("reserve", f), active === null ? "CONSUMER_AUTHORIZATION_MISSING" : "CONSUMER_AUTHORIZATION_INACTIVE");
  assert.equal(f.calls.includes("authorization-event.read"), false); assert.equal(f.calls.includes("operation.cas"), false);
  assert.equal(f.state.operation!.state, "PREPARED"); assert.deepEqual(f.state.events, []);
}));
for (const [label, key, value] of [
  ["id", "id", ""], ["parent", "authorizationId", "other"], ["company", "companyId", "other"], ["scope", "providerScope", "other"],
  ["revision", "revision", 2], ["action revoked", "action", "REVOKED"], ["action unknown", "action", "OTHER"],
  ["nextActive false", "nextActive", false], ["nextActive type", "nextActive", "true"], ["evidence", "evidenceInboundEventId", "other"]
] as [string, string, unknown][]) test("reserve blocks malformed current GRANTED event " + label, () => configured(async () => {
  const f = fake("PREPARED"); (f.state.authorizationEvent as unknown as Record<string, unknown>)[key] = value;
  await denied(() => invoke("reserve", f), "CONSUMER_AUTHORIZATION_EVENT_INVALID");
  assert.equal(f.calls.includes("operation.cas"), false); assert.deepEqual(f.state.events, []);
}));
test("reserve blocks missing current authorization event", () => configured(async () => {
  const f = fake("PREPARED"); f.state.authorizationEvent = null;
  await denied(() => invoke("reserve", f), "CONSUMER_AUTHORIZATION_EVENT_INVALID"); assert.deepEqual(f.state.events, []);
}));
test("prepare needs no authorization and never reads it", () => configured(async () => {
  const f = fake(); f.state.authorization = null; f.state.authorizationEvent = null;
  assert.equal((await invoke("prepare", f)).state, "PREPARED"); assert.equal(f.calls.some(c => c.startsWith("authorization")), false);
}));
test("reserve records current grant metadata in a fresh closed object before releasing profile", () => configured(async () => {
  const f = fake("PREPARED");
  const r = await service.reserveOpenCreditClientProfileOperationForDispatch(f.db, transition());
  assert.deepEqual(Object.keys(r).sort(), ["operationId", "state", "revision", "profile", "profileJson", "dispatchAuthorization"].sort());
  assert.deepEqual(JSON.parse(r.profileJson), r.profile);
  assert.deepEqual(Object.keys(r.dispatchAuthorization).sort(), ["authorizationId", "authorizationRevision", "authorizationEventId"].sort());
  assert.equal(r.dispatchAuthorization.authorizationEventId, f.state.events[0].dispatchAuthorizationEventId);
  assert.ok(f.calls.indexOf("authorization-event.read") < f.calls.indexOf("operation.cas"));
  assert.equal("evidenceInboundEventId" in r.dispatchAuthorization, false);
  assert.equal("body" in r, false); assert.equal("providerMessageId" in r, false);
}));
test("regrant revision2 binds current GRANTED rather than historical revision0", () => configured(async () => {
  const f = fake("PREPARED"); f.state.authorization!.revision = 2;
  f.state.authorizationEvent!.revision = 2; f.state.authorizationEvent!.id = "synthetic-granted-rev2";
  const r = await service.reserveOpenCreditClientProfileOperationForDispatch(f.db, transition());
  assert.deepEqual(r.dispatchAuthorization, { authorizationId: "synthetic-authorization", authorizationRevision: 2, authorizationEventId: "synthetic-granted-rev2" });
  assert.equal(f.state.events[0].dispatchAuthorizationEventId, "synthetic-granted-rev2");
}));
for (const mode of ["unknown", "settle"] as const) test("committed reserve then revoke cannot block " + mode, () => configured(async () => {
  const f = fake("PREPARED"); await invoke("reserve", f);
  f.state.authorization!.active = false; f.state.authorization!.revision = 1; f.state.authorizationEvent!.action = "REVOKED";
  f.calls.length = 0;
  assert.equal((await invoke(mode, f)).state, mode === "unknown" ? "UNKNOWN" : "SUCCEEDED");
  assert.equal(f.calls.some(c => c.startsWith("authorization")), false);
  assert.equal(f.state.events[0].dispatchAuthorizationEventId, "synthetic-granted");
  assert.equal("dispatchAuthorizationEventId" in f.state.events[1], false);
}));
test("authorization is reread on transaction retry and revocation blocks the loser", () => configured(async () => {
  const f = fake("PREPARED"); f.faults.push(prismaError("P2034"));
  f.onAttempt(() => { if (f.attempts() === 2) f.state.authorization!.active = false; });
  await denied(() => invoke("reserve", f), "CONSUMER_AUTHORIZATION_INACTIVE");
  assert.equal(f.state.operation!.state, "PREPARED"); assert.deepEqual(f.state.events, []);
}));
test("AST reservation-only authorization reads and audit binding; settlement/prepare remain independent", () => {
  const source = readFileSync(new URL("./opencredit-commercial-operation.service.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("service.ts", source, ts.ScriptTarget.Latest, true);
  const fn = (name: string) => ast.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === name)!.getText(ast);
  assert.doesNotMatch(source, /consumer-authorization\.service|Message|provenanceKind|authenticateMeta|\bbody\b/);
  for (const name of ["prepareOpenCreditClientProfileOperation", "settle", "markOpenCreditCommercialOperationUnknown", "applyOpenCreditCreateClientObservation"]) {
    assert.doesNotMatch(fn(name), /dispatchAuthorization|openCreditConsumerAuthorization/);
  }
  const reserve = fn("reserveOpenCreditClientProfileOperationForDispatch");
  assert.ok(reserve.indexOf("await fresh(") < reserve.indexOf("await dispatchAuthorization("));
  assert.ok(reserve.indexOf("await dispatchAuthorization(") < reserve.indexOf("openCreditCommercialOperation.updateMany"));
  assert.ok(reserve.indexOf("await dispatchAuthorization(") < reserve.indexOf("serializeOpenCreditClientProfilePayload(profile)"));
  assert.ok(reserve.indexOf("serializeOpenCreditClientProfilePayload(profile)") < reserve.indexOf("openCreditCommercialOperation.updateMany"));
  assert.match(reserve, /dispatchAuthorizationEventId: authorization.authorizationEventId/);
  assert.match(fn("dispatchAuthorization"), /authorizationId_revision/);
  let calls = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "dispatchAuthorization") {
      calls++;
      let owner: ts.Node | undefined = node;
      while (owner && !ts.isFunctionDeclaration(owner)) owner = owner.parent;
      assert.ok(owner && ts.isFunctionDeclaration(owner)); assert.equal(owner.name?.text, "reserveOpenCreditClientProfileOperationForDispatch");
    }
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.equal(calls, 1);
});
test("dispatch binding migration is additive, nullable and never backfills legacy reservations", () => {
  const sql = readFileSync("prisma/migrations/20261019200000_add_opencredit_dispatch_authorization_binding/migration.sql", "utf8");
  assert.doesNotMatch(sql, /\b(?:INSERT|DELETE(?! RESTRICT)|UPDATE(?! NO ACTION)|DROP|TRUNCATE)\b/);
  assert.match(sql, /ADD COLUMN "dispatchAuthorizationEventId" TEXT;/);
  assert.match(sql, /"dispatchAuthorizationEventId" IS NULL OR "action" = 'RESERVED_FOR_DISPATCH'/);
  assert.equal((sql.match(/CREATE UNIQUE INDEX/g) ?? []).length, 2);
  assert.match(sql, /FOREIGN KEY \("dispatchAuthorizationEventId", "companyId", "providerScope"\)/);
});
test("AST: no FAILED writer and only outcome-derived SUCCEEDED reaches private terminal CAS", () => {
  const source = readFileSync(new URL("./opencredit-commercial-operation.service.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("service.ts", source, ts.ScriptTarget.Latest, true);
  assert.deepEqual(ast.statements.filter(ts.isImportDeclaration).map(n => (n.moduleSpecifier as ts.StringLiteral).text),
    ["server-only", "@prisma/client", "./auth", "./permissions", "./opencredit-commercial-identity-policy",
      "./opencredit-contact-client-profile-adapter", "./opencredit-client-profile-contract", "./opencredit-create-client-outcome"]);
  const settle = ast.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === "settle")!;
  assert.equal(settle.typeParameters?.[0].constraint?.getText(ast), '"SUCCEEDED" | "UNKNOWN"');
  assert.equal(settle.parameters[2].name.getText(ast), "state"); assert.equal(settle.parameters[2].type?.getText(ast), "S");
  const writes: string[] = [], calls: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(ast);
      assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword); assert.notEqual(callee, "require");
      if (callee === "settle") {
        const state = node.arguments[2]; assert(ts.isStringLiteral(state)); calls.push(state.text);
        assert(["SUCCEEDED", "UNKNOWN"].includes(state.text));
      }
      if (["tx.openCreditCommercialOperation.create", "tx.openCreditCommercialOperation.updateMany"].includes(callee)) {
        const args = node.arguments[0]; assert(ts.isObjectLiteralExpression(args));
        const data = args.properties.find(p => p.name?.getText(ast) === "data"); assert(data && ts.isPropertyAssignment(data) && ts.isObjectLiteralExpression(data.initializer));
        const state = data.initializer.properties.find(p => p.name?.getText(ast) === "state"); assert(state);
        if (ts.isShorthandPropertyAssignment(state)) { assert.equal(state.name.text, "state"); assert(node.pos >= settle.pos && node.end <= settle.end); writes.push("state"); }
        else { assert(ts.isPropertyAssignment(state) && ts.isStringLiteral(state.initializer)); writes.push(state.initializer.text); }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.deepEqual(writes.sort(), ["IN_FLIGHT", "PREPARED", "state"]); assert.deepEqual(calls.sort(), ["SUCCEEDED", "UNKNOWN", "UNKNOWN"]);
  const apply = ast.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === "applyOpenCreditCreateClientObservation")!;
  assert.match(apply.getText(ast), /outcome = classifyOpenCreditCreateClientOutcome\(observation\)/);
  assert.match(apply.getText(ast), /if \(outcome.state === "UNKNOWN"\) return settle\(db, input, "UNKNOWN", "MARKED_UNKNOWN"\)/);
  assert.match(apply.getText(ast), /return settle\(db, input, "SUCCEEDED", outcome.created \? "MARKED_SUCCEEDED_CREATED" : "MARKED_SUCCEEDED_UPDATED"\)/);
  assert.doesNotMatch(source, /(?:state|nextState):\s*"FAILED"|markFailed|setFailed|markSucceeded|setSucceeded|forceSucceeded|completeSuccessfully/);
});
