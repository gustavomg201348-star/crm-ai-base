import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { createHmac } from "node:crypto";
import Module, { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { setImmediate as nextTurn } from "node:timers/promises";
import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
let handler: typeof import("./opencredit-passive-inbound-handler");
let contract: typeof import("./opencredit-passive-inbound-contract");
let service: typeof import("./opencredit-passive-inbound.service");
let post: typeof import("../app/api/integrations/opencredit/inbound/[publicWebhookId]/route").POST;
let prepareSecret: typeof import("./opencredit-secrets").prepareOpenCreditWebhookSecret;

// Replace only the database boundary. The route still runs its real policy,
// counter decisions, binding lookup, signature checks and response handling.
const routeIntegrations = new Map<string, typeof binding>();
const routeBuckets = new Map<string, number>();
const secondPublicId = "b".repeat(48);
const windowStart = "2026-11-05T16:32:00.000Z";
const expiresAt = "2026-11-05T16:33:00.000Z";
let routeLookups = 0;
let routeWrites = 0;

const routeDb = {
  async $queryRaw(query: Prisma.Sql) {
    assert.match(query.sql, /INSERT INTO "RateLimitBucket"/);
    const [key, start, expiry] = query.values as [string, Date, Date];
    assert.equal(start.toISOString(), windowStart);
    assert.equal(expiry.toISOString(), expiresAt);
    const count = (routeBuckets.get(key) ?? 0) + 1;
    routeBuckets.set(key, count);
    return [{ count, expiresAt: expiry }];
  },
  async $executeRaw() { return 0; },
  openCreditIntegration: {
    async findUnique({ where }: { where: { publicWebhookId: string } }) {
      routeLookups++;
      return routeIntegrations.get(where.publicWebhookId);
    },
  },
  async $transaction(run: (tx: {
    $queryRaw: (_query: TemplateStringsArray, id: string, companyId: string) => Promise<(typeof binding)[]>;
    openCreditInboundEvent: { findUnique: () => Promise<null>; create: () => Promise<void> };
  }) => Promise<unknown>) {
    return run({
      $queryRaw: async (_query, id, companyId) =>
        Array.from(routeIntegrations.values()).filter(row => row.id === id && row.companyId === companyId),
      openCreditInboundEvent: {
        findUnique: async () => null,
        create: async () => { routeWrites++; },
      },
    });
  },
};

const originalFetch = globalThis.fetch;
before(async () => {
  globalThis.fetch = async () => { throw Error("REAL_HTTP_FORBIDDEN"); };
  const loader = Module as typeof Module & { _load(s: string, ...a: unknown[]): unknown }, original = loader._load;
  loader._load = (s, ...a) => {
    if (s === "server-only") return {};
    if (s === "@/lib/db") return { prisma: routeDb };
    return original.call(loader, s, ...a);
  };
  // Node 20/tsx can evaluate a direct dynamic import separately from a transitive
  // CJS dependency. Keep this stateful receipt boundary in one loader/cache graph.
  const require = createRequire(import.meta.url);
  try {
    handler = require("./opencredit-passive-inbound-handler");
    contract = require("./opencredit-passive-inbound-contract");
    service = require("./opencredit-passive-inbound.service");
    post = require("../app/api/integrations/opencredit/inbound/[publicWebhookId]/route").POST;
    prepareSecret = require("./opencredit-secrets").prepareOpenCreditWebhookSecret;
  } finally {
    loader._load = original;
  }
});
after(() => { globalThis.fetch = originalFetch; });
const secret = "synthetic-passive-inbound-secret";
const publicId = "a".repeat(48);
const binding = { id: "synthetic-integration", companyId: "synthetic-company", providerScope: "synthetic-scope", webhookSecret: "synthetic-ciphertext", passiveInboundEnabled: true };
const payload = () => ({ event: "lead.assigned", eventId: "synthetic-lead:synthetic-partner", lead: { id: "synthetic-lead" }, contractVersion: 2, client: { cpf: "00000000000", phone: "5511999999999", name: "PRIVATE_SENTINEL", email: "private@example.invalid" }, companyId: "attacker", providerScope: "attacker" });
const sign = (raw: Uint8Array) => "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
type RateLimitEvent = Parameters<NonNullable<Parameters<typeof handler.createPassiveInboundHandler>[0]["logRateLimit"]>>[0];
function setup(options: { binding?: unknown; secret?: string; fail?: boolean; unavailable?: boolean; hold?: () => Promise<void> } = {}) {
  let writes = 0, captured: unknown, complete = false;
  const events: RateLimitEvent[] = [];
  const h = handler.createPassiveInboundHandler({
    lookup: async () => Object.hasOwn(options, "binding") ? options.binding as typeof binding : binding,
    secret: () => options.secret ?? secret,
    limit: async () => ({ status: options.unavailable ? "unavailable" : "allowed" }),
    logRateLimit: event => { events.push(event); },
    persist: async receipt => { writes++; captured = contract.readPassiveReceipt(receipt); if (options.fail) throw Error(secret + " PRIVATE_SENTINEL"); if (options.hold) await options.hold(); complete = true; return { duplicate: false }; },
  });
  const send = (raw = Buffer.from(JSON.stringify(payload())), signature: string | null = sign(raw), extra: Record<string, string> = {}, method = "POST") =>
    h(new Request("https://crm.example.invalid/api/inbound", { method, headers: { "content-type": "application/json", ...(signature === null ? {} : { "x-creditcore-sig": signature }), ...extra }, ...(method === "POST" ? { body: raw } : {}) }), { params: Promise.resolve({ publicWebhookId: publicId }) });
  return { h, send, events, writes: () => writes, captured: () => captured, complete: () => complete };
}
test("valid RAW HMAC -> persisted metadata only, trusted binding not payload, no PII in response", async () => {
  const f = setup(), r = await f.send(); assert.equal(r.status, 200); assert.equal(f.writes(), 1); assert(f.complete());
  assert.deepEqual(await r.json(), { ok: true }); assert.equal(r.headers.get("cache-control"), "no-store");
  await nextTurn();
  assert.equal(r.headers.get("retry-after"), null);
  assert.deepEqual(f.events, []);
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
test("empty resolved secret and decryption errors fail closed", async () => { const f = setup({ secret: "" }); assert.equal((await f.send()).status, 403); assert.equal(f.writes(), 0); const h = handler.createPassiveInboundHandler({ lookup: async () => binding, secret: () => { throw Error(secret); }, limit: async () => ({ status: "allowed" }), persist: async () => { throw Error(); } }); const r = await h(new Request("https://crm.example.invalid", { method: "POST" }), { params: Promise.resolve({ publicWebhookId: publicId }) }); assert.equal(r.status, 403); assert(!(await r.text()).includes(secret)); });
for (const raw of ["{", '{"event":"lead.assigned","event":"other"}', '{"x":"\\ud800"}']) test("strict JSON rejects signed malformed/duplicate/unicode: " + raw, async () => { const f = setup(); assert.equal((await f.send(Buffer.from(raw))).status, 400); assert.equal(f.writes(), 0); });
test("signature is checked before parsing invalid JSON", async () => { const f = setup(); assert.equal((await f.send(Buffer.from("{"), "sha256=" + "0".repeat(64))).status, 403); });
for (const change of [{ event: "simulation.completed" }, { eventId: "" }, { eventId: "other:synthetic-partner" }, { eventId: "synthetic-lead:00000000000" }, { eventId: "synthetic-lead:partner:extra" }, { contractVersion: null }, { contractVersion: "2" }, { contractVersion: 3 }, { lead: [] }]) test("unknown/invalid metadata rejects: " + JSON.stringify(change), async () => { const f = setup(); assert.equal((await f.send(Buffer.from(JSON.stringify({ ...payload(), ...change })))).status, 422); assert.equal(f.writes(), 0); });
test("missing contractVersion remains null; unknown fields discarded", async () => { const p = payload(); Reflect.deleteProperty(p, "contractVersion"); const f = setup(); assert.equal((await f.send(Buffer.from(JSON.stringify(p)))).status, 200); assert.equal((f.captured() as { metadata: { contractVersion: unknown } }).metadata.contractVersion, null); });
test("oversize streamed or declared body rejects; media/encoding/method closed", async () => {
  for (const [body, headers, expected] of [[Buffer.alloc(65537, 32), {}, 413], [undefined, { "content-length": "65537" }, 413], [undefined, { "content-type": "text/plain" }, 415], [undefined, { "content-encoding": "gzip" }, 415]] as const) { const f = setup(); assert.equal((await f.send(body, undefined, headers)).status, expected); assert.equal(f.writes(), 0); }
  assert.equal((await setup().send(undefined, undefined, {}, "GET")).status, 405);
});
test("invalid UTF8 is rejected after authenticating RAW bytes", async () => { const f = setup(); assert.equal((await f.send(Buffer.from([0xff]))).status, 400); });
for (const option of [{ unavailable: true }, { fail: true }]) test("rate/storage failure never acknowledges: " + JSON.stringify(option), async () => {
  const f = setup(option), r = await f.send();
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { code: "INGESTION_UNAVAILABLE" });
  assert.equal(r.headers.get("retry-after"), null);
  await nextTurn();
  assert.deepEqual(f.events, []);
});
test("2xx waits for persistence completion", async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }), f = setup({ hold: () => gate }); let returned = false;
  const response = f.send().then(r => { returned = true; return r; }); for (let n = 0; n < 50; n++) await Promise.resolve(); assert.equal(returned, false); release(); assert.equal((await response).status, 200); assert(f.complete());
});
const rateLimitScenarios = [
  { winner: "ip", limit: 400, checkpoints: [182, 364, 399, 400], alternateIp: false, alternateIntegration: false, counters: [400, 401, 401] },
  { winner: "authenticated", limit: 400, checkpoints: [399, 400], alternateIp: true, alternateIntegration: false, counters: [200, 201, 401, 401] },
  { winner: "global", limit: 600, checkpoints: [599, 600], alternateIp: true, alternateIntegration: true, counters: [300, 300, 300, 300, 601] },
] as const;

for (const scenario of rateLimitScenarios) test(`passive route hits the ${scenario.winner} limit at ${scenario.limit + 1}`, async t => {
  const { winner, limit, checkpoints, alternateIp, alternateIntegration, counters } = scenario;
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-05T16:32:52.150Z") });
  const env = {
    RATE_LIMIT_SECRET: "synthetic-rate-limit-credential",
    AUTH_SECRET: "synthetic-auth-credential",
    QEVORA_DATA_ENCRYPTION_KEY_V1: Buffer.alloc(32, 23).toString("base64"),
  };
  const previous = Object.keys(env).map(key => [key, process.env[key]] as const);
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  routeBuckets.clear();
  routeIntegrations.clear();
  routeLookups = 0;
  routeWrites = 0;
  const webhookSecret = prepareSecret(secret);
  const secondId = "synthetic-integration-two";
  routeIntegrations.set(publicId, { ...binding, webhookSecret });
  routeIntegrations.set(secondPublicId, { ...binding, id: secondId, webhookSecret });

  const events: RateLimitEvent[] = [];
  t.mock.method(console, "warn", (line: string) => {
    events.push(JSON.parse(line));
    throw Error("synthetic logger failure");
  });
  const ips = ["192.0.2.42", "192.0.2.43"];
  let lastSignature = "";
  async function send(n: number, validSignature = true) {
    const index = n % 2;
    const ip = ips[alternateIp ? index : 0];
    const target = alternateIntegration && index ? secondPublicId : publicId;
    const leadId = `synthetic-lead-${n}`;
    const raw = Buffer.from(JSON.stringify({ ...payload(), lead: { id: leadId }, eventId: `${leadId}:synthetic-partner` }));
    lastSignature = validSignature ? sign(raw) : "invalid-signature";
    const request = new NextRequest(`https://crm.example.invalid/api/integrations/opencredit/inbound/${target}`, {
      method: "POST",
      body: raw,
      headers: {
        "content-type": "application/json",
        "x-creditcore-sig": lastSignature,
        "x-forwarded-for": ip,
        "x-railway-request-id": "untrusted-request-id",
      },
    });
    return post(request, { params: Promise.resolve({ publicWebhookId: target }) });
  }

  for (let n = 1; n <= limit; n++) {
    const response = await send(n);
    assert.equal(response.status, 200, `request ${n}`);
    assert.equal(response.headers.get("retry-after"), null);
    if ((checkpoints as readonly number[]).includes(n)) {
      assert.equal(routeWrites, n);
      assert.deepEqual(await response.json(), { ok: true });
    }
  }
  assert.equal(events.length, 0);
  const r = await send(limit + 1);
  assert.equal(r.status, 429);
  assert.equal(events.length, 0);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(r.headers.get("retry-after"), "8");
  assert.deepEqual(Array.from(r.headers.keys()).sort(), ["cache-control", "content-type", "retry-after"]);
  assert.equal(await r.text(), '{"code":"RATE_LIMITED"}');
  assert.equal(routeWrites, limit);
  assert.equal(routeLookups, winner === "authenticated" ? limit + 1 : limit);
  assert.deepEqual(Array.from(routeBuckets.values()).sort((a, b) => a - b), counters);

  await nextTurn();
  assert.equal(events.length, 1);
  const event = events[0];
  assert.match(event.bucketRef, /^[a-f0-9]{24}$/);
  assert.deepEqual(event, {
    event: "opencredit_passive_rate_limited",
    category: `opencredit-passive-${winner}`,
    stage: winner === "authenticated" ? "authenticated" : "public/global-ip",
    limit,
    count: limit + 1,
    windowStart,
    expiresAt,
    retryAfterSeconds: 8,
    bucketRef: event.bucketRef,
  });
  const log = JSON.stringify(event);
  for (const value of [secret, lastSignature, webhookSecret, binding.id, secondId, binding.companyId, binding.providerScope,
    publicId, secondPublicId, ...ips, ...Object.values(env), "untrusted-request-id", "00000000000", "5511999999999",
    "PRIVATE_SENTINEL", "private@example.invalid", ...Array.from(routeBuckets.keys())]) {
    assert(!log.includes(value), "sensitive value reached telemetry");
  }

  if (winner === "authenticated") {
    const invalid = await send(limit + 2, false);
    assert.equal(invalid.status, 403);
    assert.equal(routeWrites, limit);
    await nextTurn();
    assert.equal(events.length, 1);
  }
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
  const h = handler.createPassiveInboundHandler({lookup:async () => binding,secret:() => secret,limit:async () => ({ status: "allowed" }),persist:(receipt,deadline) => service.persistPassiveInbound(db as never,receipt,deadline)});
  const raw = Buffer.from(JSON.stringify(payload()));
  const response = h(new Request("https://crm.example.invalid",{method:"POST",headers:{"content-type":"application/json","x-creditcore-sig":sign(raw)},body:raw}),{params:Promise.resolve({publicWebhookId:publicId})}).then(r => { returned = true; assert.equal(committed,true); return r; });
  // Do not wait for started forever if an identity failure causes an early response.
  await Promise.race([started,response]); assert.equal(rows.length,1); assert.equal(returned,false); assert.equal(committed,false);
  assert.equal(rows[0].provenanceKind,"OPENCREDIT_HMAC_SHA256_VERIFIED"); release(); assert.equal((await response).status,200);
});
test("public boundary deadline is below provider 5s; pending body cancels and returns 503", async () => {
  const { OpenCreditDeadline } = await import("./opencredit-webhook-contract");
  const h = handler.createPassiveInboundHandler({ lookup: async () => binding, secret: () => secret, limit: async () => ({ status: "allowed" }), persist: async () => { throw Error(); }, deadline: () => new OpenCreditDeadline(25) });
  const body = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) });
  const req = new Request("https://crm.example.invalid", { method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half" } as RequestInit);
  assert.equal((await h(req, { params: Promise.resolve({ publicWebhookId: publicId }) })).status, 503);
});
test("source boundaries have no commercial/domain consumers; legacy handler/route not reused", () => {
  const files = ["contract", "handler", "service"].map(s => "src/lib/opencredit-passive-inbound" + (s === "service" ? ".service" : "-" + s) + ".ts");
  for (const file of files) { const source = readFileSync(file, "utf8"); assert.match(source, /^import "server-only";/); assert.doesNotMatch(source, /console\.|\bfetch\(|opencredit-api-client|opencredit-lead.service|inbound-message|openai|\.contact\.|\.conversation\.|\.opportunity\.|\.openCreditLead\./); }
  const route = readFileSync("src/app/api/integrations/opencredit/inbound/[publicWebhookId]/route.ts", "utf8"); assert.match(route, /consumeRateLimits/); assert.match(route, /getRequestIpKey/); assert.doesNotMatch(route, /resolveConfiguredOpenCreditProviderScope|payload|ingestOpenCreditLead/);
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
