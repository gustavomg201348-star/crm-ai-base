import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { createHmac } from "node:crypto";
import Module, { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
let handler: typeof import("./opencredit-passive-inbound-handler");
let contract: typeof import("./opencredit-passive-inbound-contract");
let service: typeof import("./opencredit-passive-inbound.service");
const originalFetch = globalThis.fetch;
before(async () => {
  globalThis.fetch = async () => { throw Error("REAL_HTTP_FORBIDDEN"); };
  const loader = Module as typeof Module & { _load(s: string, ...a: unknown[]): unknown }, original = loader._load;
  loader._load = (s, ...a) => s === "server-only" ? {} : original.call(loader, s, ...a);
  // Node 20/tsx can evaluate a direct dynamic import separately from a transitive
  // CJS dependency. Keep this stateful receipt boundary in one loader/cache graph.
  const require = createRequire(import.meta.url);
  try { handler = require("./opencredit-passive-inbound-handler"); contract = require("./opencredit-passive-inbound-contract"); service = require("./opencredit-passive-inbound.service"); } finally { loader._load = original; }
});
after(() => { globalThis.fetch = originalFetch; });
const secret = "synthetic-passive-inbound-secret";
const publicId = "a".repeat(48);
const binding = { id: "synthetic-integration", companyId: "synthetic-company", providerScope: "synthetic-scope", webhookSecret: "synthetic-ciphertext", passiveInboundEnabled: true };
const payload = () => ({ event: "lead.assigned", eventId: "synthetic-lead:synthetic-partner", lead: { id: "synthetic-lead" }, contractVersion: 2, client: { cpf: "00000000000", phone: "5511999999999", name: "PRIVATE_SENTINEL", email: "private@example.invalid" }, companyId: "attacker", providerScope: "attacker" });
const sign = (raw: Uint8Array) => "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
function setup(options: { binding?: unknown; secret?: string; fail?: boolean; limited?: boolean; unavailable?: boolean; hold?: () => Promise<void> } = {}) {
  let writes = 0, captured: unknown, complete = false;
  const h = handler.createPassiveInboundHandler({
    lookup: async () => Object.hasOwn(options, "binding") ? options.binding as typeof binding : binding,
    secret: () => options.secret ?? secret,
    limit: async () => options.limited ? new Response(null, { status: 429 }) : options.unavailable ? new Response(null, { status: 503 }) : null,
    persist: async receipt => { writes++; captured = contract.readPassiveReceipt(receipt); if (options.fail) throw Error(secret + " PRIVATE_SENTINEL"); if (options.hold) await options.hold(); complete = true; return { duplicate: false }; },
  });
  const send = (raw = Buffer.from(JSON.stringify(payload())), signature: string | null = sign(raw), extra: Record<string, string> = {}, method = "POST") =>
    h(new Request("https://crm.example.invalid/api/inbound", { method, headers: { "content-type": "application/json", ...(signature === null ? {} : { "x-creditcore-sig": signature }), ...extra }, ...(method === "POST" ? { body: raw } : {}) }), { params: Promise.resolve({ publicWebhookId: publicId }) });
  return { h, send, writes: () => writes, captured: () => captured, complete: () => complete };
}
test("valid RAW HMAC -> persisted metadata only, trusted binding not payload, no PII in response", async () => {
  const f = setup(), r = await f.send(); assert.equal(r.status, 200); assert.equal(f.writes(), 1); assert(f.complete());
  assert.deepEqual(await r.json(), { ok: true }); assert.equal(r.headers.get("cache-control"), "no-store");
  const captured = f.captured() as { binding: typeof binding; metadata: object }; assert.deepEqual(captured.binding, binding);
  assert.deepEqual(Object.keys(captured.metadata).sort(), ["contractVersion", "eventId", "eventType", "externalLeadId"]);
  for (const pii of ["00000000000", "5511999999999", "PRIVATE_SENTINEL", "private@example.invalid"]) assert(!JSON.stringify(captured.metadata).includes(pii));
});
test("one changed byte and reserialized JSON reject original signature", async () => {
  const raw = Buffer.from(JSON.stringify(payload(), null, 2)), signature = sign(raw); const changed = Buffer.from(raw); changed[1] = 32;
  for (const body of [changed, Buffer.from(JSON.stringify(JSON.parse(raw.toString())))]) { const f = setup(); assert.equal((await f.send(body, signature)).status, 403); assert.equal(f.writes(), 0); }
});
for (const header of [null, "", "sha256=x", "sha1=" + "a".repeat(64), "SHA256=" + "a".repeat(64), "sha256=" + "0".repeat(64), "sha256=" + "a".repeat(65)]) test("malformed/missing/wrong signature rejects: " + header, async () => { const f = setup(); assert.equal((await f.send(undefined, header)).status, 403); assert.equal(f.writes(), 0); });
for (const b of [null, { ...binding, providerScope: null }, { ...binding, providerScope: "" }, { ...binding, providerScope: "bad scope" }, { ...binding, webhookSecret: "" }, { ...binding, passiveInboundEnabled: false }, { ...binding, passiveInboundEnabled: undefined, enabled: true }, { ...binding, passiveInboundEnabled: "true" }]) test("unbound/disabled/secretless integration fails closed: " + JSON.stringify(b), async () => { const f = setup({ binding: b }); assert.equal((await f.send()).status, 403); assert.equal(f.writes(), 0); });

for (const enabled of [false, true]) test("legacy enabled=" + enabled + " does not gate explicitly enabled passive inbound", async () => {
  const f = setup({ binding: { ...binding, enabled } });
  assert.equal((await f.send()).status, 200); assert.equal(f.writes(), 1);
});
test("empty resolved secret and decryption errors fail closed", async () => { const f = setup({ secret: "" }); assert.equal((await f.send()).status, 403); assert.equal(f.writes(), 0); const h = handler.createPassiveInboundHandler({ lookup: async () => binding, secret: () => { throw Error(secret); }, limit: async () => null, persist: async () => { throw Error(); } }); const r = await h(new Request("https://crm.example.invalid", { method: "POST" }), { params: Promise.resolve({ publicWebhookId: publicId }) }); assert.equal(r.status, 403); assert(!(await r.text()).includes(secret)); });
for (const raw of ["{", '{"event":"lead.assigned","event":"other"}', '{"x":"\\ud800"}']) test("strict JSON rejects signed malformed/duplicate/unicode: " + raw, async () => { const f = setup(); assert.equal((await f.send(Buffer.from(raw))).status, 400); assert.equal(f.writes(), 0); });
test("signature is checked before parsing invalid JSON", async () => { const f = setup(); assert.equal((await f.send(Buffer.from("{"), "sha256=" + "0".repeat(64))).status, 403); });
for (const change of [{ event: "simulation.completed" }, { eventId: "" }, { eventId: "other:synthetic-partner" }, { eventId: "synthetic-lead:00000000000" }, { eventId: "synthetic-lead:partner:extra" }, { contractVersion: null }, { contractVersion: "2" }, { contractVersion: 3 }, { lead: [] }]) test("unknown/invalid metadata rejects: " + JSON.stringify(change), async () => { const f = setup(); assert.equal((await f.send(Buffer.from(JSON.stringify({ ...payload(), ...change })))).status, 422); assert.equal(f.writes(), 0); });
test("missing contractVersion remains null; unknown fields discarded", async () => { const p = payload(); Reflect.deleteProperty(p, "contractVersion"); const f = setup(); assert.equal((await f.send(Buffer.from(JSON.stringify(p)))).status, 200); assert.equal((f.captured() as { metadata: { contractVersion: unknown } }).metadata.contractVersion, null); });
test("oversize streamed or declared body rejects; media/encoding/method closed", async () => {
  for (const [body, headers, expected] of [[Buffer.alloc(65537, 32), {}, 413], [undefined, { "content-length": "65537" }, 413], [undefined, { "content-type": "text/plain" }, 415], [undefined, { "content-encoding": "gzip" }, 415]] as const) { const f = setup(); assert.equal((await f.send(body, undefined, headers)).status, expected); assert.equal(f.writes(), 0); }
  assert.equal((await setup().send(undefined, undefined, {}, "GET")).status, 405);
});
test("invalid UTF8 is rejected after authenticating RAW bytes", async () => { const f = setup(); assert.equal((await f.send(Buffer.from([0xff]))).status, 400); });
for (const option of [{ limited: true }, { unavailable: true }, { fail: true }]) test("rate/storage failure never acknowledges: " + JSON.stringify(option), async () => { const f = setup(option), r = await f.send(); assert.equal(r.status, option.limited ? 429 : 503); const text = await r.text(); assert(!text.includes(secret)); assert(!text.includes("PRIVATE_SENTINEL")); });
test("2xx waits for persistence completion", async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }), f = setup({ hold: () => gate }); let returned = false;
  const response = f.send().then(r => { returned = true; return r; }); for (let n = 0; n < 50; n++) await Promise.resolve(); assert.equal(returned, false); release(); assert.equal((await response).status, 200); assert(f.complete());
});
test("post-authentication rate limit rejects before persistence", async () => {
  let limits = 0, writes = 0;
  const h = handler.createPassiveInboundHandler({ lookup: async () => binding, secret: () => secret, limit: async () => ++limits === 2 ? new Response(null, {status:429}) : null, persist: async () => { writes++; return {duplicate:false}; } });
  const raw = Buffer.from(JSON.stringify(payload()));
  const r = await h(new Request("https://crm.example.invalid", {method:"POST",headers:{"content-type":"application/json","x-creditcore-sig":sign(raw)},body:raw}),{params:Promise.resolve({publicWebhookId:publicId})});
  assert.equal(r.status,429); assert.equal(limits,2); assert.equal(writes,0);
});
test("receipt snapshot cannot be changed through input bytes, binding or a returned copy", () => {
  const b = {...binding}, raw = Buffer.from(JSON.stringify(payload()));
  const receipt = contract.authenticatePassiveInbound(raw,sign(raw),secret,b);
  b.companyId = "other"; raw.fill(0); const copy = contract.readPassiveReceipt(receipt); copy.binding.companyId = "other"; copy.metadata.eventId = "other:partner";
  const unchanged = contract.readPassiveReceipt(receipt); assert.equal(unchanged.binding.companyId,binding.companyId); assert.equal(unchanged.metadata.eventId,payload().eventId);
});
test("caller cannot fabricate authenticated provenance", async () => { const db = { $transaction: async () => { throw Error("MUST_NOT_QUERY"); } }; await assert.rejects(() => service.persistPassiveInbound(db as never, {} as never, {} as never), /OPENCREDIT_INBOUND_INVALID_SIGNATURE/); });
test("handler receipt is accepted by the real persistence boundary in the same module graph; 200 follows commit", async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(r => { entered = r; }), gate = new Promise<void>(r => { release = r; });
  let committed = false, returned = false;
  const rows: Record<string, unknown>[] = [];
  const tx = { $queryRaw: async () => [{providerScope:binding.providerScope,webhookSecret:binding.webhookSecret,passiveInboundEnabled:true}], openCreditInboundEvent: {
    findUnique: async () => null,
    create: async ({data}: {data: Record<string, unknown>}) => { rows.push(data); return data; },
  } };
  const db = { $transaction: async (run: (t: typeof tx) => Promise<unknown>) => { const result = await run(tx); entered(); await gate; committed = true; return result; } };
  const h = handler.createPassiveInboundHandler({lookup:async () => binding,secret:() => secret,limit:async () => null,persist:(receipt,deadline) => service.persistPassiveInbound(db as never,receipt,deadline)});
  const raw = Buffer.from(JSON.stringify(payload()));
  const response = h(new Request("https://crm.example.invalid",{method:"POST",headers:{"content-type":"application/json","x-creditcore-sig":sign(raw)},body:raw}),{params:Promise.resolve({publicWebhookId:publicId})}).then(r => { returned = true; assert.equal(committed,true); return r; });
  // Do not wait for started forever if an identity failure causes an early response.
  await Promise.race([started,response]); assert.equal(rows.length,1); assert.equal(returned,false); assert.equal(committed,false);
  assert.equal(rows[0].provenanceKind,"OPENCREDIT_HMAC_SHA256_VERIFIED"); release(); assert.equal((await response).status,200);
});
test("public boundary deadline is below provider 5s; pending body cancels and returns 503", async () => {
  const { OpenCreditDeadline } = await import("./opencredit-webhook-contract");
  const h = handler.createPassiveInboundHandler({ lookup: async () => binding, secret: () => secret, limit: async () => null, persist: async () => { throw Error(); }, deadline: () => new OpenCreditDeadline(25) });
  const body = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) });
  const req = new Request("https://crm.example.invalid", { method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half" } as RequestInit);
  assert.equal((await h(req, { params: Promise.resolve({ publicWebhookId: publicId }) })).status, 503);
});
test("source boundaries have no commercial/domain consumers; legacy handler/route not reused", () => {
  const files = ["contract", "handler", "service"].map(s => "src/lib/opencredit-passive-inbound" + (s === "service" ? ".service" : "-" + s) + ".ts");
  for (const file of files) { const source = readFileSync(file, "utf8"); assert.match(source, /^import "server-only";/); assert.doesNotMatch(source, /console\.|\bfetch\(|opencredit-api-client|opencredit-lead.service|inbound-message|openai|\.contact\.|\.conversation\.|\.opportunity\.|\.openCreditLead\./); }
  const route = readFileSync("src/app/api/integrations/opencredit/inbound/[publicWebhookId]/route.ts", "utf8"); assert.match(route, /enforceRateLimits/); assert.match(route, /getRequestIpKey/); assert.doesNotMatch(route, /resolveConfiguredOpenCreditProviderScope|payload|ingestOpenCreditLead/);
  assert.match(route, /passiveInboundEnabled: true/); assert.doesNotMatch(route, /\benabled\s*:|\bpaused\b/);
  const storage = readFileSync("src/lib/opencredit-passive-inbound.service.ts", "utf8"); assert.match(storage, /row\.passiveInboundEnabled !== true/); assert.doesNotMatch(storage, /\brow\.enabled\b|"enabled"|\bpaused\b/);
  for (const file of ["src/app/api/integrations/opencredit/webhooks/[publicWebhookId]/route.ts", "src/lib/opencredit-webhook-handler.ts", "src/lib/opencredit-lead.service.ts"])
    assert.doesNotMatch(readFileSync(file, "utf8"), /passiveInboundEnabled/);
  const consumers: string[] = [];
  for (const path of readdirSync("src", { recursive: true, encoding: "utf8" })) { if (!/\.[cm]?[jt]sx?$/.test(path) || /\.(test|integration)\./.test(path)) continue; const source = readFileSync("src/" + path, "utf8"); if (/import.*persistPassiveInbound.*from/.test(source)) consumers.push(path.replace(/\\/g, "/")); }
  assert.deepEqual(consumers, ["app/api/integrations/opencredit/inbound/[publicWebhookId]/route.ts"]);
});

test("passive opt-in migration is additive/default false in both schemas, never an activation backfill", () => {
  for (const path of ["prisma/schema.prisma", "prisma/schema.postgres.prisma"]) {
    const model = readFileSync(path, "utf8").match(/model OpenCreditIntegration \{[\s\S]*?\n\}/)![0];
    assert.match(model, /passiveInboundEnabled\s+Boolean\s+@default\(false\)/);
    assert.match(model, /\benabled\s+Boolean\s+@default\(false\)/);
  }
  const migration = readFileSync("prisma/migrations/20261030150000_separate_opencredit_passive_inbound_enable/migration.sql", "utf8");
  assert.match(migration, /ADD COLUMN "passiveInboundEnabled" BOOLEAN NOT NULL DEFAULT false/);
  assert.doesNotMatch(migration.replace(/--[^\n]*/g, ""), /\b(?:UPDATE|INSERT|DELETE|DROP)\b/i);
});
