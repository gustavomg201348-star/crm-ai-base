import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import * as ts from "typescript";
import { Prisma } from "@prisma/client";
import type { SessionUser } from "./auth";
import type { OpenCreditConsumerAuthorizationGrantInput, OpenCreditConsumerAuthorizationCode } from "./opencredit-consumer-authorization.service";
import { assertOpenCreditConsumerAuthorizationTestDatabase } from "./opencredit-consumer-authorization-postgres.guard";

let service: typeof import("./opencredit-consumer-authorization.service");
before(async () => {
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try { service = await import("./opencredit-consumer-authorization.service"); } finally { loader._load = original; }
});
const actor: SessionUser = { id: "admin", companyId: "platform", role: "ADMIN", name: "Synthetic", email: "synthetic@example.invalid" };
const scope = "synthetic-scope" as OpenCreditConsumerAuthorizationGrantInput["providerScope"];
const grantInput = (): OpenCreditConsumerAuthorizationGrantInput => ({ actor: { ...actor }, companyId: "company", contactId: "contact", providerScope: scope, inboundEventId: "evidence" });
const revokeInput = () => ({ actor: { ...actor }, companyId: "company", contactId: "contact", providerScope: scope });
type RecordState = { id: string; companyId: string; contactId: string; providerScope: string; purpose: string; remoteIdentityId: string; active: boolean; revision: number; evidenceInboundEventId: string; changedByUserId: string; updatedAt: number };
function fixture() {
  const state = {
    actor: { ...actor } as SessionUser | null, company: true,
    contact: { id: "contact", companyId: "company", cpf: "00000000000" as string | null, archivedAt: null as Date | null } as { id: string; companyId: string; cpf: string | null; archivedAt: Date | null } | null,
    matches: [{ id: "contact" }], access: { enabled: true } as { enabled: boolean } | null,
    identity: { id: "identity", companyId: "company", contactId: "contact", providerScope: scope, normalizedCpf: "00000000000", enabled: true } as { id: string; companyId: string; contactId: string; providerScope: string; normalizedCpf: string; enabled: boolean } | null,
    owner: "identity",
    evidence: {
      id: "evidence", companyId: "company", contactId: "contact", channelId: "channel" as string | null, conversationId: "conversation", messageId: "message",
      provenanceKind: "META_WEBHOOK_HMAC_SHA256_VERIFIED" as string | null, provenanceVersion: 1 as number | null,
      message: { id: "message", conversationId: "conversation", direction: "inbound", type: "text", body: "Synthetic reviewed text", providerMessageId: "synthetic-provider" as string | null },
      conversation: { id: "conversation", contactId: "contact", channelId: "channel", contact: { companyId: "company" } },
      channel: { id: "channel", companyId: "company" }
    },
    evidenceExists: true, authorization: null as RecordState | null, events: [] as Record<string, unknown>[]
  };
  const calls: { name: string; args: unknown }[] = []; const options: unknown[] = [];
  const faults: unknown[] = []; const createFaults: unknown[] = [];
  let simulateWinner = false; let eventError: unknown; let casCount: number | undefined; let attempts = 0;
  const db = { $transaction: async (run: (tx: unknown) => Promise<unknown>, opts: unknown) => {
    attempts++; options.push(opts);
    if (faults.length) throw faults.shift();
    let current = state.authorization && { ...state.authorization }; const events = [...state.events];
    function read<T>(name: string, value: () => T) { return async (args: unknown) => { calls.push({ name, args }); return value(); }; }
    const tx = {
      user: { findUnique: read("actor", () => state.actor) },
      company: { findUnique: read("company", () => state.company ? { id: "company" } : null) },
      contact: { findUnique: read("contact", () => state.contact), findMany: read("matches", () => state.matches) },
      openCreditCommercialAccess: { findUnique: read("access", () => state.access) },
      openCreditRemoteIdentity: { findUnique: async (args: { where: Record<string, unknown> }) => {
        calls.push({ name: "identity", args }); return args.where.providerScope_normalizedCpf ? { id: state.owner } : state.identity;
      } },
      conversationInboundEvent: { findUnique: read("evidence", () => state.evidenceExists ? state.evidence : null) },
      openCreditConsumerAuthorization: {
        findUnique: read("authorization", () => current),
        create: async ({ data }: { data: Omit<RecordState, "id" | "updatedAt"> }) => {
          calls.push({ name: "create", args: data });
          if (createFaults.length) {
            if (simulateWinner) {
              // Simulated OTHER transaction commit, not a write committed by the losing fake transaction.
              state.authorization = { ...data, id: "authorization", updatedAt: 1 };
              state.events.push({ action: "GRANTED", revision: 0 });
            }
            throw createFaults.shift();
          }
          current = { ...data, id: "authorization", updatedAt: 1 }; return { id: current.id };
        },
        updateMany: async (args: { where: Record<string, unknown>; data: Partial<RecordState> }) => {
          calls.push({ name: "cas", args });
          assert.deepEqual(args.where, { id: current!.id, companyId: "company", providerScope: scope, active: current!.active, revision: current!.revision });
          if (casCount !== undefined) return { count: casCount };
          current = { ...current!, ...args.data, updatedAt: current!.updatedAt + 1 }; return { count: 1 };
        }
      },
      openCreditConsumerAuthorizationEvent: { create: async ({ data }: { data: Record<string, unknown> }) => {
        calls.push({ name: "event", args: data }); if (eventError) throw eventError; events.push(data); return { id: "event" };
      } }
    };
    const result = await run(tx); state.authorization = current; state.events = events; return result;
  } } as unknown as Parameters<typeof service.grantOpenCreditConsumerAuthorizationFromInboundEvidence>[0];
  return { state, calls, options, faults, createFaults, db, attempts: () => attempts,
    winner: () => { simulateWinner = true; }, failEvent: (error: unknown) => { eventError = error; }, cas: (n: number) => { casCount = n; } };
}
type F = ReturnType<typeof fixture>;
function unit(name: string, run: (f: F) => Promise<void>) {
  test(name, async () => {
    const company = process.env.PLATFORM_COMPANY_ID; const emails = process.env.PLATFORM_ADMIN_EMAILS;
    process.env.PLATFORM_COMPANY_ID = actor.companyId; process.env.PLATFORM_ADMIN_EMAILS = actor.email;
    try { await run(fixture()); } finally {
      if (company === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = company;
      if (emails === undefined) delete process.env.PLATFORM_ADMIN_EMAILS; else process.env.PLATFORM_ADMIN_EMAILS = emails;
    }
  });
}
const grant = (f: F, i = grantInput()) => service.grantOpenCreditConsumerAuthorizationFromInboundEvidence(f.db, i);
const revoke = (f: F) => service.revokeOpenCreditConsumerAuthorization(f.db, revokeInput());
async function denied(run: () => Promise<unknown>, code: OpenCreditConsumerAuthorizationCode) {
  await assert.rejects(run, e => {
    assert.ok(e instanceof service.OpenCreditConsumerAuthorizationServiceError);
    assert.equal(e.code, code); assert.equal(e.message, "OPENCREDIT_CONSUMER_AUTHORIZATION_" + code);
    assert.equal("cause" in e, false); assert.equal("meta" in e, false); return true;
  });
}
unit("first grant creates active rev0 and exact audit fields atomically", async f => {
  assert.deepEqual(await grant(f), { changed: true, authorizationId: "authorization", active: true, revision: 0 });
  assert.deepEqual(f.state.events, [{ authorizationId: "authorization", companyId: "company", providerScope: scope, actorUserId: actor.id, action: "GRANTED", previousActive: null, nextActive: true, revision: 0, evidenceInboundEventId: "evidence" }]);
  assert.deepEqual(Object.keys(f.state.authorization!).sort(), ["id", "companyId", "contactId", "remoteIdentityId", "providerScope", "purpose", "active", "revision", "evidenceInboundEventId", "changedByUserId", "updatedAt"].sort());
  assert.equal(f.state.authorization!.purpose, "CLIENT_PROFILE_UPSERT");
});
unit("same active evidence is no-op including updatedAt/revision/event", async f => {
  await grant(f); const before = structuredClone(f.state.authorization);
  assert.equal((await grant(f)).changed, false); assert.deepEqual(f.state.authorization, before); assert.equal(f.state.events.length, 1);
});
unit("active different evidence conflicts without mutation", async f => {
  await grant(f); await denied(() => grant(f, { ...grantInput(), inboundEventId: "other-evidence" }), "AUTHORIZATION_CONFLICT"); assert.equal(f.state.events.length, 1);
});
unit("revoke has one atomic REVOKED event revision1 preserving evidence", async f => {
  await grant(f); assert.deepEqual(await revoke(f), { changed: true, authorizationId: "authorization", active: false, revision: 1 });
  assert.deepEqual(f.state.events[1], { authorizationId: "authorization", companyId: "company", providerScope: scope, actorUserId: actor.id, action: "REVOKED", previousActive: true, nextActive: false, revision: 1, evidenceInboundEventId: "evidence" });
});
unit("repeated revoke is a strict no-op", async f => {
  await grant(f); await revoke(f); const before = structuredClone(f.state.authorization);
  assert.equal((await revoke(f)).changed, false); assert.deepEqual(f.state.authorization, before); assert.equal(f.state.events.length, 2);
});
unit("absent revoke returns only safe null result", async f => {
  assert.deepEqual(await revoke(f), { changed: false, authorizationId: null, active: false, revision: null });
});
for (const next of ["evidence", "new-evidence"]) unit("regrant after revoke with " + next, async f => {
  await grant(f); await revoke(f); await grant(f, { ...grantInput(), inboundEventId: next });
  assert.equal(f.state.authorization!.revision, 2); assert.equal(f.state.authorization!.active, true);
  assert.equal(f.state.events[2].previousActive, false); assert.equal(f.state.events[2].evidenceInboundEventId, next);
});
const bad: [string, (f: F) => void, OpenCreditConsumerAuthorizationCode][] = [
  ["actor missing", f => { f.state.actor = null; }, "NOT_AUTHORIZED"],
  ["actor stale role", f => { f.state.actor!.role = "AGENT"; }, "NOT_AUTHORIZED"],
  ["actor stale company", f => { f.state.actor!.companyId = "other"; }, "NOT_AUTHORIZED"],
  ["actor stale email", f => { f.state.actor!.email = "other@example.invalid"; }, "NOT_AUTHORIZED"],
  ["company absent", f => { f.state.company = false; }, "COMPANY_NOT_FOUND"],
  ["contact absent", f => { f.state.contact = null; }, "CONTACT_NOT_FOUND"],
  ["contact archived", f => { f.state.contact!.archivedAt = new Date(); }, "CONTACT_ARCHIVED"],
  ["CPF missing", f => { f.state.contact!.cpf = null; }, "CONTACT_CPF_MISSING"],
  ["CPF empty", f => { f.state.contact!.cpf = ""; }, "CONTACT_CPF_MISSING"],
  ["CPF invalid", f => { f.state.contact!.cpf = "invalid"; }, "CONTACT_CPF_INVALID"],
  ["archived duplicate counts for ambiguity", f => { f.state.matches.push({ id: "archived" }); }, "CONTACT_AMBIGUOUS"],
  ["zero matches", f => { f.state.matches = []; }, "CONTACT_AMBIGUOUS"],
  ["access missing", f => { f.state.access = null; }, "COMMERCIAL_ACCESS_MISSING"],
  ["access disabled", f => { f.state.access!.enabled = false; }, "COMMERCIAL_ACCESS_DISABLED"],
  ["identity missing", f => { f.state.identity = null; }, "IDENTITY_NOT_FOUND"],
  ["identity disabled", f => { f.state.identity!.enabled = false; }, "IDENTITY_DISABLED"],
  ["snapshot mismatch", f => { f.state.identity!.normalizedCpf = "11111111111"; }, "IDENTITY_SNAPSHOT_MISMATCH"],
  ["ownership conflict", f => { f.state.owner = "other"; }, "IDENTITY_CONFLICT"],
  ["identity other company", f => { f.state.identity!.companyId = "other"; }, "IDENTITY_CONFLICT"],
  ["identity other contact", f => { f.state.identity!.contactId = "other"; }, "IDENTITY_CONFLICT"],
  ["evidence missing", f => { f.state.evidenceExists = false; }, "EVIDENCE_NOT_FOUND"],
  ["evidence other company", f => { f.state.evidence.companyId = "other"; }, "EVIDENCE_SCOPE_MISMATCH"],
  ["evidence other contact", f => { f.state.evidence.contactId = "other"; }, "EVIDENCE_SCOPE_MISMATCH"],
  ["provenance null", f => { f.state.evidence.provenanceKind = null; }, "EVIDENCE_NOT_VERIFIED"],
  ["provenance unknown", f => { f.state.evidence.provenanceKind = "SANDBOX"; }, "EVIDENCE_NOT_VERIFIED"],
  ["provenance version unknown", f => { f.state.evidence.provenanceVersion = 2; }, "EVIDENCE_NOT_VERIFIED"],
  ["channel null", f => { f.state.evidence.channelId = null; }, "EVIDENCE_NOT_VERIFIED"],
  ["outbound", f => { f.state.evidence.message.direction = "outbound"; }, "EVIDENCE_UNSUPPORTED"],
  ["audio", f => { f.state.evidence.message.type = "audio"; }, "EVIDENCE_UNSUPPORTED"],
  ["empty body", f => { f.state.evidence.message.body = ""; }, "EVIDENCE_UNSUPPORTED"],
  ["blank body", f => { f.state.evidence.message.body = " \t\n"; }, "EVIDENCE_UNSUPPORTED"],
  ["missing provider id", f => { f.state.evidence.message.providerMessageId = null; }, "EVIDENCE_UNSUPPORTED"],
  ["blank provider id", f => { f.state.evidence.message.providerMessageId = " "; }, "EVIDENCE_UNSUPPORTED"],
  ["message binding", f => { f.state.evidence.message.id = "other"; }, "EVIDENCE_SCOPE_MISMATCH"],
  ["conversation binding", f => { f.state.evidence.message.conversationId = "other"; }, "EVIDENCE_SCOPE_MISMATCH"],
  ["conversation contact", f => { f.state.evidence.conversation.contactId = "other"; }, "EVIDENCE_SCOPE_MISMATCH"],
  ["conversation channel", f => { f.state.evidence.conversation.channelId = "other"; }, "EVIDENCE_SCOPE_MISMATCH"],
  ["channel company", f => { f.state.evidence.channel.companyId = "other"; }, "EVIDENCE_SCOPE_MISMATCH"]
];
for (const [name, change, code] of bad) unit(name + " blocks grant without state/event writes", async f => {
  change(f); await denied(() => grant(f), code); assert.equal(f.state.authorization, null); assert.equal(f.state.events.length, 0);
});
for (const [name, change] of bad.filter(([name]) => ["contact archived", "CPF missing", "CPF invalid", "archived duplicate counts for ambiguity", "access disabled", "identity disabled", "evidence missing"].includes(name))) {
  unit("revoke remains possible after " + name, async f => {
    await grant(f); change(f); f.calls.length = 0; assert.equal((await revoke(f)).active, false);
    assert.deepEqual(f.calls.map(c => c.name), ["actor", "company", "authorization", "cas", "event"]);
  });
}
for (const text of ["sim", "não autorizo", "irrelevant text", "aceito", "autorizo"]) unit("human attestation does not interpret " + text, async f => {
  f.state.evidence.message.body = text; const result = await grant(f);
  assert.deepEqual(Object.keys(result).sort(), ["changed", "authorizationId", "active", "revision"].sort());
  assert.equal(JSON.stringify([result, f.state.authorization, f.state.events]).includes(text), false);
});
unit("scope and ambiguity queries remain tenant-scoped", async f => {
  await grant(f);
  assert.deepEqual((f.calls.find(c => c.name === "contact")!.args as { where: unknown }).where, { companyId_id: { companyId: "company", id: "contact" } });
  assert.deepEqual(f.calls.find(c => c.name === "matches")!.args, { where: { companyId: "company", cpf: { in: ["00000000000", "000.000.000-00"] } }, take: 2, select: { id: true } });
  assert.deepEqual(f.options, [{ isolationLevel: "Serializable", maxWait: 2000, timeout: 5000 }]);
});
for (const kind of ["getter", "inherited", "symbol", "hidden", "extra", "purpose", "body", "consent", "cpf"]) unit("closed input rejects " + kind, async f => {
  let invoked = 0; const i: object = grantInput();
  if (kind === "getter") Object.defineProperty(i, "inboundEventId", { enumerable: true, get() { invoked++; return "evidence"; } });
  else if (kind === "inherited") Object.setPrototypeOf(i, { inherited: true });
  else if (kind === "hidden") Object.defineProperty(i, "hidden", { value: true });
  else if (kind === "symbol") Object.defineProperty(i, Symbol("hidden"), { value: true });
  else Object.assign(i, { [kind]: true });
  await denied(() => grant(f, i as OpenCreditConsumerAuthorizationGrantInput), "INVALID_EVIDENCE"); assert.equal(invoked, 0); assert.equal(f.attempts(), 0);
});
unit("non-admin rejected before transaction", async f => {
  await denied(() => grant(f, { ...grantInput(), actor: { ...actor, role: "AGENT" } }), "NOT_AUTHORIZED"); assert.equal(f.attempts(), 0);
});
for (const phase of ["grant", "revoke", "regrant"]) unit("event failure rolls back " + phase, async f => {
  if (phase !== "grant") await grant(f);
  if (phase === "regrant") await revoke(f);
  const before = structuredClone([f.state.authorization, f.state.events]); f.failEvent(new Error("private-data"));
  await denied(() => phase === "revoke" ? revoke(f) : grant(f), "STORAGE_ERROR");
  assert.deepEqual([f.state.authorization, f.state.events], before);
});
const storageError = (code: string, meta?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError("private-data", { code, meta, clientVersion: "5.22.0" });
unit("P2034 retries transaction including all reads", async f => {
  f.faults.push(storageError("P2034"), storageError("P2034")); await grant(f); assert.equal(f.attempts(), 3); assert.equal(f.state.events.length, 1);
});
unit("P2034 bounded at three attempts", async f => {
  f.faults.push(...Array.from({ length: 4 }, () => storageError("P2034")));
  await denied(() => grant(f), "CONCURRENT_CONFLICT"); assert.equal(f.attempts(), 3);
});
unit("unrelated P2002 never retried", async f => {
  f.faults.push(storageError("P2002", { target: ["unexpected"] })); await denied(() => grant(f), "STORAGE_ERROR"); assert.equal(f.attempts(), 1);
});
for (const target of ["OCConsumerAuth_company_scope_contact_purpose_key", ["companyId", "providerScope", "contactId", "purpose"]]) {
  unit("expected create P2002 retries and rereads winner " + JSON.stringify(target), async f => {
    f.winner(); f.createFaults.push(storageError("P2002", { modelName: "OpenCreditConsumerAuthorization", target }));
    assert.equal((await grant(f)).changed, false); assert.equal(f.attempts(), 2);
    assert.equal(f.state.events.length, 1); assert.equal(f.calls.filter(c => c.name === "create").length, 1);
    assert.equal(f.calls.filter(c => c.name === "actor").length, 2);
  });
}
for (const meta of [{ target: ["id"] }, { target: ["companyId", "providerScope", "contactId"] },
  { modelName: "OpenCreditConsumerAuthorizationEvent", target: "OCConsumerAuth_company_scope_contact_purpose_key" }]) {
  unit("other create unique failure is not retryable " + JSON.stringify(meta), async f => {
    f.createFaults.push(storageError("P2002", meta)); await denied(() => grant(f), "STORAGE_ERROR"); assert.equal(f.attempts(), 1);
  });
}
unit("expected P2002 is bounded at three attempts", async f => {
  f.createFaults.push(...Array.from({ length: 3 }, () => storageError("P2002", { target: "OCConsumerAuth_company_scope_contact_purpose_key" })));
  await denied(() => grant(f), "CONCURRENT_CONFLICT"); assert.equal(f.attempts(), 3); assert.equal(f.state.authorization, null);
});
unit("Event unique failure cannot use the authorization-creation retry allowance", async f => {
  f.failEvent(storageError("P2002", { modelName: "OpenCreditConsumerAuthorizationEvent", target: ["id"] }));
  await denied(() => grant(f), "STORAGE_ERROR"); assert.equal(f.attempts(), 1); assert.equal(f.state.authorization, null);
});
unit("actor getter rejected without evaluation", async f => {
  let calls = 0; const i = grantInput();
  Object.defineProperty(i.actor, "email", { enumerable: true, get() { calls++; return actor.email; } });
  await denied(() => grant(f, i), "NOT_AUTHORIZED"); assert.equal(calls, 0); assert.equal(f.attempts(), 0);
});
for (const [field, code] of [["companyId", "INVALID_COMPANY"], ["contactId", "INVALID_CONTACT"], ["providerScope", "INVALID_PROVIDER_SCOPE"], ["inboundEventId", "INVALID_EVIDENCE"]] as const) {
  unit("invalid " + field + " rejected before DB", async f => {
    await denied(() => grant(f, { ...grantInput(), [field]: " \n" }), code); assert.equal(f.attempts(), 0);
  });
}
unit("existing active authorization still requires current freshness and evidence", async f => {
  await grant(f); f.state.evidence.provenanceKind = null;
  await denied(() => grant(f), "EVIDENCE_NOT_VERIFIED"); assert.equal(f.state.events.length, 1);
});
unit("max revision cannot overflow", async f => {
  await grant(f); f.state.authorization!.revision = 2147483647;
  await denied(() => revoke(f), "CONCURRENT_CONFLICT"); assert.equal(f.state.events.length, 1);
});
for (const count of [0, 2]) unit("CAS count " + count + " is fail closed", async f => {
  await grant(f); f.cas(count); await denied(() => revoke(f), count === 0 ? "CONCURRENT_CONFLICT" : "STORAGE_ERROR"); assert.equal(f.state.events.length, 1);
});
const source = readFileSync("src/lib/opencredit-consumer-authorization.service.ts", "utf8");
test("server-only, closed runtime exports and passive AST", () => {
  const ast = ts.createSourceFile("service.ts", source, ts.ScriptTarget.Latest, true);
  const exports: string[] = [];
  for (const node of ast.statements) {
    assert.equal(ts.isExportDeclaration(node) || ts.isExportAssignment(node), false);
    if (ts.isImportDeclaration(node)) {
      const path = (node.moduleSpecifier as ts.StringLiteral).text;
      assert.ok(["server-only", "@prisma/client", "./auth", "./permissions", "./opencredit-commercial-identity-policy"].includes(path));
    }
    if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
      && (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node))) exports.push(node.name!.text);
    if (ts.isVariableStatement(node)) assert.equal(node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false, false);
  }
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const call = node.expression;
      if (["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany", "$executeRaw", "$queryRaw", "$executeRawUnsafe", "$queryRawUnsafe"].includes(call.name.text)) {
        assert.ok(ts.isPropertyAccessExpression(call.expression));
        const delegate = call.expression.name.text;
        assert.ok(delegate === "openCreditConsumerAuthorization" && ["create", "updateMany"].includes(call.name.text)
          || delegate === "openCreditConsumerAuthorizationEvent" && call.name.text === "create");
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.match(source, /^import "server-only";/);
  assert.deepEqual(exports.sort(), ["OpenCreditConsumerAuthorizationServiceError", "grantOpenCreditConsumerAuthorizationFromInboundEvidence", "revokeOpenCreditConsumerAuthorization"].sort());
  assert.doesNotMatch(source, /\bfetch\s*\(|new PrismaClient|console\.|grantConsent|setConsent|legalBasis|https?:|opencredit-api-client|POST|strict-http/);
  assert.doesNotMatch(source, /\.body\.(?:match|includes|search|toLowerCase)|RegExp/);
});
test("only approved human admin mutation boundary; reservation only reads authorization", () => {
  function walk(dir: string) {
    for (const file of readdirSync(dir, { withFileTypes: true })) {
      const path = dir + "/" + file.name;
      if (file.isDirectory()) walk(path);
      else if (/\.[cm]?[jt]sx?$/.test(path) && !/opencredit-consumer-authorization(?:\.service\.ts|\.test\.ts|-postgres\.(?:integration|guard)\.ts)$/.test(path)) {
        if (path === "src/lib/opencredit-commercial-operation.service.ts") {
          const source = readFileSync(path, "utf8");
          assert.doesNotMatch(source, /opencredit-consumer-authorization|grantOpenCreditConsumerAuthorizationFromInboundEvidence|revokeOpenCreditConsumerAuthorization/);
          const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
          const visit = (node: ts.Node): void => {
            if (ts.isPropertyAccessExpression(node) && ["openCreditConsumerAuthorization", "openCreditConsumerAuthorizationEvent"].includes(node.name.text)) {
              assert.ok(ts.isPropertyAccessExpression(node.parent)); assert.equal(node.parent.name.text, "findUnique");
              assert.ok(ts.isCallExpression(node.parent.parent) && node.parent.parent.expression === node.parent);
              let owner: ts.Node | undefined = node; while (owner && !ts.isFunctionDeclaration(owner)) owner = owner.parent;
              assert.ok(owner && ts.isFunctionDeclaration(owner)); assert.equal(owner.name?.text, "dispatchAuthorization");
            }
            ts.forEachChild(node, visit);
          };
          visit(ast);
        } else if (path === "src/lib/opencredit-consumer-authorization-context.service.ts") {
          const source = readFileSync(path, "utf8");
          assert.doesNotMatch(source, /grantOpenCreditConsumerAuthorization|revokeOpenCreditConsumerAuthorization|consumer-authorization\.service/);
          const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
          const visit = (n: ts.Node): void => {
            if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) assert(!["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany", "$queryRaw", "$executeRaw"].includes(n.expression.name.text));
            ts.forEachChild(n, visit);
          }; visit(ast);
        } else if (path === "src/lib/opencredit-consumer-authorization-admin-handler.ts") {
          const source = readFileSync(path, "utf8");
          const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
          const imports = ast.statements.filter(ts.isImportDeclaration).filter(node => (node.moduleSpecifier as ts.StringLiteral).text === "./opencredit-consumer-authorization.service");
          assert.equal(imports.length, 1);
          assert.doesNotMatch(source, /\.openCreditConsumerAuthorization(?:Event)?\b/);
        } else if (!["src/lib/opencredit-commercial-operation-service.test.ts", "src/lib/opencredit-commercial-operation-service-postgres.integration.ts",
          "src/lib/opencredit-consumer-authorization-admin-handler.test.ts",
          "src/lib/opencredit-consumer-authorization-context.service.test.ts",
          "src/lib/opencredit-consumer-authorization-context-postgres.integration.ts",
          "src/lib/opencredit-create-client-dispatcher-postgres.integration.ts",
          "src/lib/opencredit-create-client-dispatch-admin-postgres.integration.ts",
          "src/lib/opencredit-create-client-dispatch-admin-handler.test.ts",
          "src/lib/opencredit-create-client-context-postgres.integration.ts",
          "src/lib/opencredit-create-client-ui.test.ts",
          "src/lib/opencredit-consumer-authorization-context-admin-handler.ts",
          "src/lib/opencredit-consumer-authorization-context-admin-handler.test.ts",
          "src/lib/opencredit-consumer-authorization-ui.ts", "src/lib/opencredit-consumer-authorization-ui.test.ts",
          "src/app/components/integrations/OpenCreditConsumerAuthorizationPanel.tsx",
          "src/app/api/admin/integrations/opencredit/consumer-authorization/context/route.ts",
          "src/lib/opencredit-provider-scope-resolver.test.ts", "src/lib/opencredit-strict-json.test.ts",
          "src/app/api/admin/integrations/opencredit/consumer-authorization/grant/route.ts",
          "src/app/api/admin/integrations/opencredit/consumer-authorization/revoke/route.ts"].includes(path)) {
          assert.doesNotMatch(readFileSync(path, "utf8"), /opencredit-consumer-authorization|grantOpenCreditConsumerAuthorizationFromInboundEvidence|revokeOpenCreditConsumerAuthorization|\.openCreditConsumerAuthorization(?:Event)?\b/, path);
        }
      }
    }
  }
  walk("src"); walk("scripts");
  assert.doesNotMatch(readFileSync("src/lib/opencredit-commercial-operation.service.ts", "utf8"), /consumer-authorization\.service/);
});
test("schema parity, no body/CPF snapshot, scoped FKs and additive migration", () => {
  const sqlite = readFileSync("prisma/schema.prisma", "utf8"); const pg = readFileSync("prisma/schema.postgres.prisma", "utf8");
  for (const model of ["OpenCreditConsumerAuthorization", "OpenCreditConsumerAuthorizationEvent", "ConversationInboundEvent"]) {
    const pattern = new RegExp("model " + model + " \\{[\\s\\S]*?\\n\\}");
    const normalized = (value: string | undefined) => value?.replace(/, map: "[^"]+"/g, "").replace(/\r/g, "");
    assert.ok(sqlite.match(pattern)); assert.ok(pg.match(pattern));
    assert.equal(normalized(sqlite.match(pattern)?.[0]), normalized(pg.match(pattern)?.[0]));
    if (model !== "ConversationInboundEvent") assert.doesNotMatch(sqlite.match(pattern)![0], /\b(?:body|cpf|normalizedCpf|snapshot|phone|email|notes)\b/);
  }
  assert.match(sqlite, /fields: \[evidenceInboundEventId, companyId, contactId\], references: \[id, companyId, contactId\]/);
  assert.match(sqlite, /fields: \[remoteIdentityId, companyId, providerScope\], references: \[id, companyId, providerScope\]/);
  const sql = readFileSync("prisma/migrations/20261019150000_add_opencredit_consumer_authorization_evidence/migration.sql", "utf8");
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE\s+"|DELETE\s+FROM|DROP|TRUNCATE)\b/i);
  assert.match(sql, /purpose" = 'CLIENT_PROFILE_UPSERT'/);
  assert.equal((sql.match(/ON DELETE RESTRICT ON UPDATE NO ACTION/g) ?? []).length, 8);
});
test("CI preserves dedicated unit/material gates; material guard precedes DB construction", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(ci, /tsx@4\.20\.6 --test src\/lib\/opencredit-consumer-authorization\.test\.ts/);
  assert.match(ci, /tsx@4\.20\.6 --test src\/lib\/opencredit-consumer-authorization-postgres\.integration\.ts/);
  assert.match(ci, /OPENCREDIT_CONSUMER_AUTHORIZATION_POSTGRES_TEST: "1"/);
  assert.match(ci, /run: npm run verify/);
  const material = readFileSync("src/lib/opencredit-consumer-authorization-postgres.integration.ts", "utf8");
  assert.ok(material.indexOf("assertOpenCreditConsumerAuthorizationTestDatabase(process.env)") < material.indexOf("new PrismaClient"));
});
const safeEnv = { CI: "true", GITHUB_ACTIONS: "true", OPENCREDIT_CONSUMER_AUTHORIZATION_POSTGRES_TEST: "1", DATABASE_URL: "postgresql://qevora_ci:qevora_ci_password@127.0.0.1:55432/qevora_ci?schema=public" };
test("disposable guard accepts only explicit local CI context", () => { assert.doesNotThrow(() => assertOpenCreditConsumerAuthorizationTestDatabase(safeEnv)); });
for (const change of [{ CI: "" }, { GITHUB_ACTIONS: "" }, { OPENCREDIT_CONSUMER_AUTHORIZATION_POSTGRES_TEST: "" },
  ...["https://localhost", "postgresql://qevora_ci:qevora_ci_password@external:55432/qevora_ci?schema=public", safeEnv.DATABASE_URL + "&sslmode=require", safeEnv.DATABASE_URL.replace("qevora_ci?", "production?"), safeEnv.DATABASE_URL.replace("55432", "6432")].map(DATABASE_URL => ({ DATABASE_URL }))]) {
  test("disposable guard rejects unsafe " + Object.keys(change)[0] + JSON.stringify(change).length, () => {
    assert.throws(() => assertOpenCreditConsumerAuthorizationTestDatabase({ ...safeEnv, ...change }), /REQUIRES_DISPOSABLE_CI/);
  });
}
