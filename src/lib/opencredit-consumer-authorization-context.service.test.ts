import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module from "node:module";
import { readFileSync } from "node:fs";
import * as ts from "typescript";
import type { SessionUser } from "./auth";
let service: typeof import("./opencredit-consumer-authorization-context.service");
before(async () => {
  const loader = Module as typeof Module & { _load(name: string, ...args: unknown[]): unknown }; const original = loader._load;
  loader._load = (name, ...args) => name === "server-only" ? {} : original.call(loader, name, ...args);
  try { service = await import("./opencredit-consumer-authorization-context.service"); } finally { loader._load = original; }
});
const actor: SessionUser = { id: "admin", companyId: "platform", role: "ADMIN", email: "test@example.invalid", name: "Synthetic" };
const input = () => ({ actor: { ...actor }, companyId: "company", contactId: "contact", conversationId: "conversation", providerScope: "synthetic-scope" as Parameters<typeof service.getOpenCreditConsumerAuthorizationContext>[1]["providerScope"] });
export function syntheticContextEvidence(index = 1) {
  return { id: "evidence" + index, companyId: "company", contactId: "contact", conversationId: "conversation", messageId: "message" + index,
    channelId: "channel", provenanceKind: "META_WEBHOOK_HMAC_SHA256_VERIFIED", provenanceVersion: 1,
    conversation: { id: "conversation", contactId: "contact", channelId: "channel", contact: { companyId: "company" } },
    channel: { id: "channel", companyId: "company" }, message: { id: "message" + index, conversationId: "conversation", direction: "inbound", type: "text", body: "Synthetic arbitrary reviewed text", providerMessageId: "synthetic-provider-id" } };
}
const auth = () => ({ id: "authorization", companyId: "company", contactId: "contact", providerScope: "synthetic-scope", purpose: "CLIENT_PROFILE_UPSERT", active: true, revision: 0, evidenceInboundEventId: "evidence1" });
function fixture() {
  const state: { user: unknown; company: unknown; contact: unknown; conversation: unknown; authorization: unknown; current: unknown; events: unknown[]; failure?: unknown } = {
    user: { ...actor }, company: { id: "company" }, contact: { id: "contact", companyId: "company", archivedAt: new Date() },
    conversation: { id: "conversation", contactId: "contact", contact: { companyId: "company" } }, authorization: null, current: syntheticContextEvidence(), events: [syntheticContextEvidence()],
  };
  const calls: { table: string; args: unknown }[] = [];
  const query = (table: keyof typeof state) => async (args: unknown) => { calls.push({ table, args }); if (state.failure) throw state.failure; return state[table]; };
  const tx = { user: { findUnique: query("user") }, company: { findUnique: query("company") }, contact: { findUnique: query("contact") }, conversation: { findUnique: query("conversation") },
    openCreditConsumerAuthorization: { findUnique: query("authorization") }, conversationInboundEvent: { findUnique: query("current"), findMany: query("events") } };
  const db = { $transaction: async (run: (value: unknown) => Promise<unknown>) => run(tx) } as unknown as Parameters<typeof service.getOpenCreditConsumerAuthorizationContext>[0];
  const run = async (i = input()) => {
    const old = process.env.PLATFORM_COMPANY_ID; process.env.PLATFORM_COMPANY_ID = "platform";
    try { return await service.getOpenCreditConsumerAuthorizationContext(db, i); }
    finally { if (old === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = old; }
  };
  return { state, calls, run };
}
const denied = async (run: () => Promise<unknown>, code: string) => assert.rejects(run, error => error instanceof Error && error.message === "OPENCREDIT_CONSUMER_AUTHORIZATION_CONTEXT_" + code);
for (const user of [null, { ...actor, id: "other" }, { ...actor, role: "AGENT" }, { ...actor, companyId: "other" }, { ...actor, email: "changed@example.invalid" }]) {
  test("stale actor rejected " + JSON.stringify(user), async () => { const f = fixture(); f.state.user = user; await denied(f.run, "NOT_AUTHORIZED"); assert.equal(f.calls.length, 1); });
}
test("invalid actor cannot reach transaction", async () => { const f = fixture(); await denied(() => f.run({ ...input(), actor: { ...actor, role: "AGENT" } }), "NOT_AUTHORIZED"); assert.equal(f.calls.length, 0); });
for (const [field, code] of [["company", "COMPANY_NOT_FOUND"], ["contact", "CONTACT_NOT_FOUND"], ["conversation", "CONVERSATION_NOT_FOUND"]] as const) {
  test("missing target " + field, async () => { const f = fixture(); f.state[field] = null; await denied(f.run, code); });
}
for (const conversation of [{ id: "conversation", contactId: "other", contact: { companyId: "company" } }, { id: "conversation", contactId: "contact", contact: { companyId: "other" } }]) {
  test("conversation target scope rejected " + conversation.contactId + conversation.contact.companyId, async () => { const f = fixture(); f.state.conversation = conversation; await denied(f.run, "CONVERSATION_NOT_FOUND"); });
}
test("absent authorization, archived contact and only closed candidates", async () => {
  const f = fixture(); assert.deepEqual(await f.run(), { ok: true, authorization: { exists: false, active: false, revision: null, evidenceInboundEventId: null, evidenceMessageId: null }, evidenceCandidates: [{ inboundEventId: "evidence1", messageId: "message1" }] });
  assert.deepEqual((f.calls.find(c => c.table === "contact")!.args as { select: unknown }).select, { id: true, companyId: true });
});
for (const active of [true, false]) test("existing active/revoked current evidence " + active, async () => {
  const f = fixture(); f.state.authorization = { ...auth(), active }; const r = await f.run(); assert.deepEqual(r.authorization, { exists: true, active, revision: 0, evidenceInboundEventId: "evidence1", evidenceMessageId: "message1" });
});
for (const [key, value] of [["id", ""], ["companyId", "other"], ["contactId", "other"], ["providerScope", "other"], ["purpose", "other"], ["active", 1], ["revision", -1], ["revision", 1.5], ["revision", Number.MAX_SAFE_INTEGER + 1], ["evidenceInboundEventId", "x\n"]]) {
  test("corrupt authorization rejected " + key + value, async () => { const f = fixture(); f.state.authorization = { ...auth(), [key as string]: value }; await denied(f.run, "STORAGE_ERROR"); });
}
test("current evidence in another valid conversation is not invented locally", async () => {
  const f = fixture(); f.state.authorization = auth(); const e = syntheticContextEvidence(); e.conversationId = e.conversation.id = e.message.conversationId = "otherConversation"; f.state.current = e;
  const r = await f.run(); assert.equal(r.authorization.evidenceMessageId, null); assert.equal(r.authorization.evidenceInboundEventId, "evidence1");
});
test("missing or cross-scope current evidence fails closed", async () => {
  for (const current of [null, { ...syntheticContextEvidence(), companyId: "other" }]) { const f = fixture(); f.state.authorization = auth(); f.state.current = current; await denied(f.run, "STORAGE_ERROR"); }
});
const mutations: [string, (e: ReturnType<typeof syntheticContextEvidence>) => void][] = [
  ["provenance kind", e => { e.provenanceKind = "OTHER"; }], ["provenance version", e => { e.provenanceVersion = 2; }],
  ["null channel", e => { Object.assign(e, { channelId: null }); }], ["company", e => { e.companyId = "other"; }], ["contact", e => { e.contactId = "other"; }],
  ["conversation", e => { e.conversationId = "other"; }], ["conversation contact", e => { e.conversation.contactId = "other"; }],
  ["conversation company", e => { e.conversation.contact.companyId = "other"; }], ["conversation channel", e => { e.conversation.channelId = "other"; }],
  ["channel company", e => { e.channel.companyId = "other"; }], ["channel id", e => { e.channel.id = "other"; }],
  ["message id", e => { e.message.id = "other"; }], ["message conversation", e => { e.message.conversationId = "other"; }],
  ["outbound", e => { e.message.direction = "outbound"; }], ...["audio", "image", "document"].map(type => [type, (e: ReturnType<typeof syntheticContextEvidence>) => { e.message.type = type; }] as [string, (e: ReturnType<typeof syntheticContextEvidence>) => void]),
  ["empty body", e => { e.message.body = ""; }], ["whitespace body", e => { e.message.body = " \n"; }], ["empty provider id", e => { e.message.providerMessageId = " "; }],
];
for (const [label, change] of mutations) test("technical filtering " + label, async () => { const f = fixture(); const e = syntheticContextEvidence(); change(e); f.state.events = [e]; assert.deepEqual((await f.run()).evidenceCandidates, []); });
test("bounded 100 newest sequence DESC and max50; current old evidence independent", async () => {
  const f = fixture(); f.state.authorization = auth(); f.state.events = Array.from({ length: 100 }, (_, i) => syntheticContextEvidence(101 - i));
  const r = await f.run(); assert.equal(r.evidenceCandidates.length, 50); assert.equal(r.evidenceCandidates[0].inboundEventId, "evidence101"); assert.equal(r.authorization.evidenceMessageId, "message1");
  assert.deepEqual(f.calls.find(c => c.table === "events")!.args && { ...(f.calls.find(c => c.table === "events")!.args as object), select: undefined }, { where: { companyId: "company", contactId: "contact", conversationId: "conversation" }, orderBy: { sequence: "desc" }, take: 100, select: undefined });
});
for (const body of ["sim", "não autorizo", "aceito", "ok", "texto sem significado contratual"]) test("no semantic interpretation " + body, async () => { const f = fixture(); const e = syntheticContextEvidence(); e.message.body = body; f.state.events = [e]; assert.equal((await f.run()).evidenceCandidates.length, 1); });
test("raw storage errors are sanitized", async () => { const f = fixture(); f.state.failure = new Error("sensitive raw Prisma data"); await denied(f.run, "STORAGE_ERROR"); });
test("read-only AST and exact minimal imports", () => {
  const source = readFileSync("src/lib/opencredit-consumer-authorization-context.service.ts", "utf8"); const ast = ts.createSourceFile("s.ts", source, ts.ScriptTarget.Latest, true);
  assert.match(source, /^import "server-only"/); assert.doesNotMatch(source, /fetch|opencredit-api-client|console\.|\.body\.(?:match|includes|search|toLowerCase)|\.create\(|\.update\(|\.upsert\(|\.delete\(|openCreditCommercialOperation/);
  const visit = (n: ts.Node) => { if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) assert(!["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany", "$executeRaw", "$queryRaw"].includes(n.expression.name.text)); ts.forEachChild(n, visit); }; visit(ast);
});
