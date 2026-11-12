import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { createHmac } from "node:crypto";
import Module, { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { setImmediate as nextTurn } from "node:timers/promises";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { encryptSecret } from "./secret-encryption";
let handler: typeof import("./opencredit-passive-inbound-handler");
let contract: typeof import("./opencredit-passive-inbound-contract");
let service: typeof import("./opencredit-passive-inbound.service");
let post: typeof import("../app/api/integrations/opencredit/inbound/[publicWebhookId]/route").POST;
let prepareSecret: typeof import("./opencredit-secrets").prepareOpenCreditWebhookSecret;
let OpenCreditDeadline: typeof import("./opencredit-webhook-contract").OpenCreditDeadline;
let materializationPayload: typeof import("./opencredit-lead-materialization-payload");

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
    OpenCreditDeadline = require("./opencredit-webhook-contract").OpenCreditDeadline;
    materializationPayload = require("./opencredit-lead-materialization-payload");
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
type HandlerDependencies = Parameters<typeof handler.createPassiveInboundHandler>[0];
type IngestionEvent = Parameters<NonNullable<HandlerDependencies["logIngestionUnavailable"]>>[0];
function setup(options: { binding?: unknown; secret?: string; hold?: () => Promise<void> } = {}, overrides: Partial<HandlerDependencies> = {}) {
  let writes = 0, captured: unknown, complete = false;
  const events: RateLimitEvent[] = [];
  const ingestionEvents: IngestionEvent[] = [];
  const h = handler.createPassiveInboundHandler({
    lookup: async () => Object.hasOwn(options, "binding") ? options.binding as typeof binding : binding,
    secret: () => options.secret ?? secret,
    limit: async () => ({ status: "allowed" }),
    logRateLimit: event => { events.push(event); },
    persist: async receipt => { writes++; captured = contract.readPassiveReceipt(receipt); if (options.hold) await options.hold(); complete = true; return { duplicate: false, outcome: null }; },
    ...overrides,
    logIngestionUnavailable: event => {
      ingestionEvents.push(event);
      return overrides.logIngestionUnavailable?.(event);
    },
  });
  const send = (raw = Buffer.from(JSON.stringify(payload())), signature: string | null = sign(raw), extra: Record<string, string> = {}, method = "POST") =>
    h(new Request("https://crm.example.invalid/api/inbound", { method, headers: { "content-type": "application/json", ...(signature === null ? {} : { "x-creditcore-sig": signature }), ...extra }, ...(method === "POST" ? { body: raw } : {}) }), { params: Promise.resolve({ publicWebhookId: publicId }) });
  return { h, send, events, ingestionEvents, writes: () => writes, captured: () => captured, complete: () => complete };
}
test("valid RAW HMAC -> persisted metadata only, trusted binding not payload, no PII in response", async () => {
  const f = setup(), r = await f.send(); assert.equal(r.status, 200); assert.equal(f.writes(), 1); assert(f.complete());
  assert.deepEqual(await r.json(), { ok: true }); assert.equal(r.headers.get("cache-control"), "no-store");
  await nextTurn();
  assert.equal(r.headers.get("retry-after"), null);
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.ingestionEvents, []);
  const captured = f.captured() as { binding: typeof binding; metadata: object }; assert.deepEqual(captured.binding, binding);
  assert.deepEqual(Object.keys(captured.metadata).sort(), ["contractVersion", "eventId", "eventType", "externalLeadId"]);
  for (const pii of ["00000000000", "5511999999999", "PRIVATE_SENTINEL", "private@example.invalid"]) assert(!JSON.stringify(captured.metadata).includes(pii));
});
test("shape telemetry emits only allowed keys and types after authentication, with bounded depth", async () => {
  const events: unknown[] = [];
  const f = setup({}, { logShapeDiagnostic: event => { events.push(event); } });
  const fixture = payload();
  const unknownKey = "sensitive-dynamic-key@example.invalid";
  const raw = Buffer.from(JSON.stringify({
    ...fixture, [unknownKey]: secret, providerEnvelope: { phone: fixture.client.phone },
    customer: { mobilePhone: fixture.client.phone }, data: { phoneNumber: fixture.client.phone },
    client: { ...fixture.client, [unknownKey]: binding.webhookSecret, cellphone: 123, whatsapp: false,
      realProviderPhoneField: fixture.client.phone,
      mobile: null, phones: [{ phone: fixture.client.phone }], contact: { email: fixture.client.email,
        contact: { phone: fixture.client.phone }, [unknownKey]: fixture.client.name } }
  }));
  assert.equal((await f.send(raw, "sha256=" + "0".repeat(64))).status, 403);
  assert.equal((await f.send(Buffer.from("{"))).status, 400);
  assert.equal((await f.send(Buffer.from(JSON.stringify({ ...fixture, event: "other" })))).status, 422);
  await nextTurn();
  assert.deepEqual(events, []);

  const response = await f.send(raw);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(f.writes(), 1);
  await nextTurn();
  assert.deepEqual(events, [{
    event: "opencredit_inbound_shape_diagnostic", eventType: "lead.assigned", contractVersion: 2,
    topLevelKeys: ["client", "contractVersion", "customer", "data", "event", "eventId", "lead"], unknownTopLevelKeys: true,
    unknownSafeTopLevelKeys: ["companyId", "providerEnvelope", "providerScope"],
    clientShape: { type: "object", unknownKeys: true, unknownSafeKeys: ["realProviderPhoneField"], fields: {
      cellphone: { type: "number" },
      contact: { type: "object", unknownKeys: true, unknownSafeKeys: [], fields: { contact: { type: "object" }, email: { type: "string" } } },
      cpf: { type: "string" }, email: { type: "string" }, mobile: { type: "null" },
      name: { type: "string" }, phone: { type: "string" }, phones: { type: "array" }, whatsapp: { type: "boolean" }
    }},
    customerShape: { type: "object", unknownKeys: false, fields: { mobilePhone: { type: "string" } } },
    dataShape: { type: "object", unknownKeys: false, fields: { phoneNumber: { type: "string" } } },
    phoneCandidates: { cellphone: true, contact: true, mobile: true, phone: true, phones: true, telephone: false, whatsapp: true }
  }]);
  const log = JSON.stringify(events);
  for (const value of [...Object.values(fixture.client), fixture.eventId, fixture.lead.id, secret,
    binding.webhookSecret, sign(raw), raw.toString(), unknownKey]) assert.equal(log.includes(value), false);
});

test("shape telemetry failures are best-effort", async () => {
  for (const logShapeDiagnostic of [
    () => { throw Error(secret); },
    async () => { throw Error(secret); }
  ]) {
    const f = setup({}, { logShapeDiagnostic });
    assert.equal((await f.send()).status, 200);
    await nextTurn();
    assert.equal(f.writes(), 1);
  }
});

test("inbound outcome telemetry is post-persistence, bounded and best-effort", async () => {
  const events: unknown[] = [];
  const outcomes = ["NEW_MATERIALIZATION", "DUPLICATE_EVENT", "EXISTING_LEAD", "IDENTITY_INSUFFICIENT", "IDENTITY_ENRICHED"] as const;
  for (const outcome of outcomes) {
    const f = setup({}, {
      persist: async () => ({ duplicate: outcome === "DUPLICATE_EVENT", outcome }),
      logInboundOutcome: event => { events.push(event); },
    });
    assert.equal((await f.send()).status, 200);
    await nextTurn();
  }
  assert.deepEqual(events, outcomes.map(outcome => ({ event: "opencredit_passive_inbound_outcome", outcome })));
  assert.equal(JSON.stringify(events).includes("synthetic-lead"), false);
  const f = setup({}, {
    persist: async () => ({ duplicate: false, outcome: "NEW_MATERIALIZATION" }),
    logInboundOutcome: () => { throw Error(secret); },
  });
  assert.equal((await f.send()).status, 200);
});

test("the real route emits shape telemetry only for the exact opt-in", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-05T16:32:52.150Z") });
  const flag = "OPENCREDIT_INBOUND_SHAPE_DIAGNOSTIC";
  const env = {
    RATE_LIMIT_SECRET: "synthetic-rate-limit-credential",
    QEVORA_DATA_ENCRYPTION_KEY_V1: Buffer.alloc(32, 9).toString("base64"),
    [flag]: undefined
  };
  const previous = Object.keys(env).map(key => [key, process.env[key]] as const);
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  routeBuckets.clear();
  routeIntegrations.clear();
  routeIntegrations.set(publicId, { ...binding, webhookSecret: prepareSecret(secret) });
  const events: unknown[] = [];
  t.mock.method(console, "info", (marker: string, line: string) => {
    assert.equal(marker, "opencredit_inbound_shape_diagnostic");
    events.push(JSON.parse(line));
  });
  for (const value of [undefined, "false", "TRUE", "true"]) {
    if (value === undefined) delete process.env[flag];
    else process.env[flag] = value;
    const raw = Buffer.from(JSON.stringify(payload()));
    const response = await post(new NextRequest("https://crm.example.invalid/inbound", {
      method: "POST", body: raw, headers: { "content-type": "application/json", "x-creditcore-sig": sign(raw) }
    }), { params: Promise.resolve({ publicWebhookId: publicId }) });
    assert.equal(response.status, 200);
    await nextTurn();
    assert.equal(events.length, value === "true" ? 1 : 0);
  }
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
const privateFailureDetails = [
  secret, publicId, binding.id, binding.companyId, binding.providerScope, binding.webhookSecret,
  payload().eventId, payload().lead.id, ...Object.values(payload().client),
  "SELECT private FROM secret_table", "198.51.100.42", "PRIVATE_STACK_SENTINEL",
  "PRIVATE_RATE_KEY_SENTINEL", "PRIVATE_CREDENTIAL_SENTINEL",
  sign(Buffer.from(JSON.stringify(payload()))), JSON.stringify(payload()),
];
const privateFailure = () => Error(privateFailureDetails.join(" "));
async function assertIngestionUnavailable(r: Response, events: IngestionEvent[], expected: Omit<IngestionEvent, "event" | "elapsedMs" | "remainingDeadlineMs">) {
  assert.equal(r.status, 503);
  assert.equal(await r.text(), '{"code":"INGESTION_UNAVAILABLE"}');
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(r.headers.get("retry-after"), null);
  await nextTurn();
  assert.equal(events.length, 1);
  const { elapsedMs, remainingDeadlineMs, ...event } = events[0];
  assert(Number.isInteger(elapsedMs) && elapsedMs >= 0);
  assert(Number.isInteger(remainingDeadlineMs) && remainingDeadlineMs >= 0);
  if (expected.stage === "deadline") assert.equal(remainingDeadlineMs, 0);
  assert.deepEqual(event, { event: "opencredit_passive_ingestion_unavailable", ...expected });
  const log = JSON.stringify(events[0]);
  for (const value of privateFailureDetails) assert(!log.includes(value), "sensitive value reached telemetry");
}

for (const stage of ["public_rate_limit", "authenticated_rate_limit"] as const) {
  test(`503 logs only the ${stage} stage for limiter unavailable`, async () => {
    const f = setup({}, { limit: async b => ({ status: Boolean(b) === (stage === "authenticated_rate_limit") ? "unavailable" : "allowed" }) });
    await assertIngestionUnavailable(await f.send(), f.ingestionEvents, { stage, errorClass: "limiter_unavailable" });
    assert.equal(f.writes(), 0);
    assert.deepEqual(f.events, []);
  });
}

test("503 from the route serializes only sanitized lookup telemetry", async t => {
  const previous = process.env.RATE_LIMIT_SECRET;
  process.env.RATE_LIMIT_SECRET = "synthetic-rate-limit-credential";
  t.after(() => {
    if (previous === undefined) delete process.env.RATE_LIMIT_SECRET;
    else process.env.RATE_LIMIT_SECRET = previous;
  });
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-05T16:32:52.150Z") });
  routeBuckets.clear();
  t.mock.method(routeDb.openCreditIntegration, "findUnique", async () => { throw privateFailure(); });
  const events: IngestionEvent[] = [];
  t.mock.method(console, "warn", (line: string) => { events.push(JSON.parse(line)); });
  const r = await post(new NextRequest("https://crm.example.invalid", { method: "POST" }), { params: Promise.resolve({ publicWebhookId: publicId }) });
  await assertIngestionUnavailable(r, events, { stage: "lookup", errorClass: "lookup_failed" });
});

test("503 logs a stream read failure without forwarding the error", async () => {
  const f = setup();
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(privateFailure()); } });
  const req = new Request("https://crm.example.invalid", { method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half" } as RequestInit);
  await assertIngestionUnavailable(await f.h(req, { params: Promise.resolve({ publicWebhookId: publicId }) }), f.ingestionEvents, { stage: "body", errorClass: "body_read_failed" });
});

for (const stage of ["public_rate_limit", "lookup", "authenticated_rate_limit", "persistence"] as const) {
  test(`503 records deadline while waiting for ${stage}`, async () => {
    let now = 0;
    async function expire() { now = 3000; }
    const f = setup({}, {
      deadline: () => new OpenCreditDeadline(3000, () => now),
      limit: async b => {
        if (stage === (b ? "authenticated_rate_limit" : "public_rate_limit")) await expire();
        return { status: "allowed" };
      },
      lookup: async () => {
        if (stage === "lookup") await expire();
        return binding;
      },
      persist: async () => { await expire(); return { duplicate: false, outcome: null }; },
    });
    await assertIngestionUnavailable(await f.send(), f.ingestionEvents, { stage: "deadline", waitingStage: stage, errorClass: "deadline_exceeded" });
  });
}

test("503 distinguishes a persistence rejection before the transaction callback", async () => {
  const db = { $transaction: async () => { throw privateFailure(); } };
  const f = setup({}, { persist: (receipt, deadline, onEntry) => service.persistPassiveInbound(db as never, receipt, deadline, onEntry) });
  await assertIngestionUnavailable(await f.send(), f.ingestionEvents, { stage: "persistence", errorClass: "persistence_before_transaction" });
});

for (const [failure, prismaCode] of [
  [new Prisma.PrismaClientKnownRequestError(privateFailure().message, { code: "P2028", clientVersion: "test", meta: { detail: privateFailureDetails } }), "P2028"],
  [new Prisma.PrismaClientKnownRequestError(privateFailure().message, { code: "P9999", clientVersion: "test" }), undefined],
  [Object.assign(privateFailure(), { code: "P2028" }), undefined],
] as const) {
  test(`503 reports typed allowlisted Prisma codes only (${failure.constructor.name}, ${failure.code})`, async () => {
    const db = { $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({ $queryRaw: async () => { throw failure; } }) };
    const f = setup({}, { persist: (receipt, deadline, onEntry) => service.persistPassiveInbound(db as never, receipt, deadline, onEntry) });
    await assertIngestionUnavailable(await f.send(), f.ingestionEvents, {
      stage: "persistence", errorClass: "persistence_after_transaction_entry", ...(prismaCode ? { prismaCode } : {}),
    });
  });
}

for (const recoveryCannotStart of [false, true]) {
  test(`503 classifies persistence recovery (before callback: ${recoveryCannotStart})`, async () => {
    let attempts = 0;
    const db = { $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      attempts++;
      if (attempts === 2 && recoveryCannotStart) throw privateFailure();
      return run({
        $queryRaw: async () => {
          if (attempts === 1) throw new Prisma.PrismaClientKnownRequestError(privateFailure().message, { code: "P2034", clientVersion: "test" });
          return [binding];
        },
        openCreditInboundEvent: { findUnique: async () => null },
      });
    } };
    const f = setup({}, { persist: (receipt, deadline, onEntry) => service.persistPassiveInbound(db as never, receipt, deadline, onEntry) });
    await assertIngestionUnavailable(await f.send(), f.ingestionEvents, {
      stage: "persistence",
      errorClass: recoveryCannotStart ? "persistence_before_transaction" : "persistence_after_transaction_entry",
    });
    assert.equal(attempts, 2);
  });
}

for (const logIngestionUnavailable of [() => { throw privateFailure(); }, async () => { throw privateFailure(); }]) {
  test(`unexpected 503 survives a failing ${logIngestionUnavailable.constructor.name} logger`, async () => {
    const f = setup({}, { deadline: () => { throw privateFailure(); }, logIngestionUnavailable });
    const r = await f.send();
    assert.deepEqual(f.ingestionEvents, []);
    await assertIngestionUnavailable(r, f.ingestionEvents, { stage: "internal", errorClass: "unexpected" });
  });
}
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
test("signed receipt isolates minimal normalized identity from its metadata reader", async () => {
  const client = { cpf: "123.456.789-09", phone: "(11) 98765-4321", name: " Synthetic Person ", email: "synthetic@example.invalid", balance: "PRIVATE_FINANCE" };
  const raw = Buffer.from(JSON.stringify({ ...payload(), client }));
  const receipt = contract.authenticatePassiveInbound(raw, sign(raw), secret, binding);
  assert.deepEqual(Object.keys(receipt), []);
  assert.deepEqual(Object.keys(contract.readPassiveReceipt(receipt)).sort(), ["binding", "metadata"]);
  assert.deepEqual(contract.readPassiveMaterializationInput(receipt), {
    cpf: "12345678909", phone: "5511987654321", name: "Synthetic Person", email: "synthetic@example.invalid",
  });
  assert(Object.isFrozen(contract.readPassiveMaterializationInput(receipt)));
  assert.throws(() => contract.readPassiveMaterializationInput({} as never), /INVALID_SIGNATURE/);
  const invalid = Buffer.from(JSON.stringify({ ...payload(), client: { cpf: "12345678900", phone: "+12125550199", name: 22, email: "invalid" } }));
  const partial = contract.authenticatePassiveInbound(invalid, sign(invalid), secret, binding);
  assert.deepEqual(contract.readPassiveMaterializationInput(partial), { cpf: null, phone: null, name: null, email: null });
  assert.equal((await setup().send(invalid)).status, 200);
});

test("later signed event can enrich an untouched pending materialization with a newly supplied phone", async t => {
  const oldKey = process.env.QEVORA_DATA_ENCRYPTION_KEY_V1;
  process.env.QEVORA_DATA_ENCRYPTION_KEY_V1 = Buffer.alloc(32, 17).toString("base64");
  t.after(() => {
    if (oldKey === undefined) delete process.env.QEVORA_DATA_ENCRYPTION_KEY_V1;
    else process.env.QEVORA_DATA_ENCRYPTION_KEY_V1 = oldKey;
  });

  const externalLeadId = "synthetic-lead";
  const previousEvent = {
    id: "previous-event-row", eventId: "previous-event", companyId: binding.companyId,
    integrationId: binding.id, providerScope: binding.providerScope, externalLeadId,
  };
  const previousIdentity = { cpf: "12345678909", phone: null, name: "Synthetic Person", email: null };
  const previousEnvelope = materializationPayload.protectMaterializationIdentity({
    companyId: binding.companyId, providerScope: binding.providerScope, integrationId: binding.id,
    eventId: previousEvent.eventId, externalLeadId,
  }, previousIdentity);

  const raw = Buffer.from(JSON.stringify({
    event: "lead.assigned", eventId: "new-event", lead: { id: externalLeadId }, contractVersion: 2,
    client: { cpf: "12345678909", phone: "(11) 98765-4321", name: "Replacement Name", email: "new@example.invalid" },
  }));
  const receipt = contract.authenticatePassiveInbound(raw, sign(raw), secret, binding);
  let updated: { inboundEventId?: string; protectedEnvelope?: string } | undefined;
  let rawCalls = 0;
  const tx = {
    $queryRaw: async () => {
      rawCalls++;
      return rawCalls === 1
        ? [{ providerScope: binding.providerScope, webhookSecret: binding.webhookSecret, passiveInboundEnabled: true, materializationEnabled: true }]
        : [{ autoStartEnabled: true }];
    },
    openCreditInboundEvent: {
      findUnique: async ({ where }: { where: Record<string, unknown> }) =>
        Object.hasOwn(where, "id") ? previousEvent : null,
      create: async () => ({ id: "new-event-row", receivedAt: new Date("2026-11-12T18:54:00.000Z") }),
    },
    openCreditLeadMaterialization: {
      findUnique: async () => ({
        id: "pending-job", state: "PENDING", attempts: 0, contactId: null, channelId: null, conversationId: null,
        inboundEventId: previousEvent.id, protectedEnvelope: previousEnvelope,
      }),
      updateMany: async ({ data }: { data: { inboundEventId?: string; protectedEnvelope?: string } }) => {
        updated = data; return { count: 1 };
      },
    },
  };
  const db = { $transaction: async (run: (inner: typeof tx) => Promise<unknown>) => run(tx) };
  const result = await service.persistPassiveInbound(db as never, receipt, new OpenCreditDeadline());
  assert.deepEqual(result, { duplicate: false, outcome: "IDENTITY_ENRICHED" });
  assert.equal(updated?.inboundEventId, "new-event-row");
  assert.ok(updated?.protectedEnvelope);
  assert.deepEqual(materializationPayload.openMaterializationIdentity(updated!.protectedEnvelope!, {
    companyId: binding.companyId, providerScope: binding.providerScope, integrationId: binding.id,
    eventId: "new-event", externalLeadId,
  }), { cpf: "12345678909", phone: "5511987654321", name: "Synthetic Person", email: "new@example.invalid" });
});

test("materialization envelope is authenticated and bound to all five origin values", () => {
  const options = { activeKeyId: "test", keys: { test: Buffer.alloc(32, 17) } };
  const binding = { companyId: "company", providerScope: "scope", integrationId: "integration", eventId: "lead:partner", externalLeadId: "lead" };
  const identity = { cpf: "12345678909", phone: "5511987654321", name: "Synthetic Person", email: "synthetic@example.invalid" };
  const ciphertext = materializationPayload.protectMaterializationIdentity(binding, identity, options);
  assert.match(ciphertext, /^enc:v1:aes-256-gcm:/);
  for (const value of Object.values(identity)) assert(!ciphertext.includes(value));
  assert.deepEqual(materializationPayload.openMaterializationIdentity(ciphertext, binding, options), identity);
  for (const field of Object.keys(binding)) {
    assert.throws(() => materializationPayload.openMaterializationIdentity(ciphertext, { ...binding, [field]: "mismatch" }, options), /ENVELOPE_INVALID/);
  }
  const invalid = ciphertext.replace(/:([^:])([^:]*)$/, (_part, first: string, rest: string) => ":" + (first === "a" ? "b" : "a") + rest);
  assert.throws(() => materializationPayload.openMaterializationIdentity(invalid, binding, options), /ENVELOPE_INVALID/);
  assert.throws(() => materializationPayload.protectMaterializationIdentity(binding, identity, null), /KEY_UNAVAILABLE/);
  for (const changed of [{ version: 2 }, { purpose: "wrong-purpose" }]) {
    const malformed = encryptSecret(JSON.stringify({ ...binding, ...identity, version: 1, purpose: "opencredit_lead_materialization_v1", ...changed }), options);
    assert.throws(() => materializationPayload.openMaterializationIdentity(malformed, binding, options), /ENVELOPE_INVALID/);
  }
});

for (const [target, recovers] of [
  ["OCMaterialization_company_scope_lead_key", true],
  [["companyId", "providerScope", "externalLeadId"], true],
  ["OCMaterialization_inbound_event_key", false],
] as const) {
  test("only the expected materialization unique can recover a distinct event: " + String(target), async t => {
    const oldKey = process.env.QEVORA_DATA_ENCRYPTION_KEY_V1;
    process.env.QEVORA_DATA_ENCRYPTION_KEY_V1 = Buffer.alloc(32, 17).toString("base64");
    t.after(() => {
      if (oldKey === undefined) delete process.env.QEVORA_DATA_ENCRYPTION_KEY_V1;
      else process.env.QEVORA_DATA_ENCRYPTION_KEY_V1 = oldKey;
    });
    let attempts = 0;
    const db = { $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      attempts++;
      return run({
        $queryRaw: async () => [{ ...binding, materializationEnabled: true, autoStartEnabled: true }],
        openCreditInboundEvent: { findUnique: async () => null, create: async () => ({ id: "event", receivedAt: new Date() }) },
        openCreditLeadMaterialization: {
          findUnique: async () => attempts === 1 ? null : { id: "winner" },
          create: async () => { throw new Prisma.PrismaClientKnownRequestError("synthetic unique", { code: "P2002", clientVersion: "test", meta: { target } }); },
        },
      });
    } };
    const f = setup({}, { persist: (receipt, deadline, onEntry) => service.persistPassiveInbound(db as never, receipt, deadline, onEntry) });
    const response = await f.send();
    assert.equal(response.status, recovers ? 200 : 503);
    assert.equal(attempts, recovers ? 2 : 1);
  });
}
test("caller cannot fabricate authenticated provenance", async () => { const db = { $transaction: async () => { throw Error("MUST_NOT_QUERY"); } }; await assert.rejects(() => service.persistPassiveInbound(db as never, {} as never, {} as never), /OPENCREDIT_INBOUND_INVALID_SIGNATURE/); });
test("handler receipt is accepted by the real persistence boundary in the same module graph; 200 follows commit", async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(r => { entered = r; }), gate = new Promise<void>(r => { release = r; });
  let committed = false, returned = false;
  const rows: Record<string, unknown>[] = [];
  const tx = { $queryRaw: async () => [{providerScope:binding.providerScope,webhookSecret:binding.webhookSecret,passiveInboundEnabled:true,materializationEnabled:false,autoStartEnabled:false}], openCreditInboundEvent: {
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
  const f = setup({}, { deadline: () => new OpenCreditDeadline(100) });
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}), cancel: () => { cancelled = true; } });
  const req = new Request("https://crm.example.invalid", { method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half" } as RequestInit);
  await assertIngestionUnavailable(await f.h(req, { params: Promise.resolve({ publicWebhookId: publicId }) }), f.ingestionEvents, {
    stage: "deadline", waitingStage: "body", errorClass: "deadline_exceeded",
  });
  assert.equal(cancelled, true);
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
