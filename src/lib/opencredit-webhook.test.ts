import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createOpenCreditWebhookHandler } from "./opencredit-webhook-handler";
import { ingestOpenCreditLead } from "./opencredit-lead.service";
import { OpenCreditDeadline, parseOpenCreditAssignedLead, verifyOpenCreditSignature } from "./opencredit-webhook-contract";
import { createOpenCreditPublicWebhookId, prepareOpenCreditWebhookSecret, resolveOpenCreditWebhookSecret } from "./opencredit-secrets";

const secret = "synthetic-opencredit-test-secret";
const options = { activeKeyId: "v1", keys: { v1: Buffer.alloc(32, 7) } };
const publicId = "a".repeat(48);
const binding = { id: "integration-a", companyId: "company-a" };
const validPayload = () => ({
  event: "lead.assigned", eventId: "external-lead:partner",
  contractVersion: 2, assignedAt: "2026-10-09T17:00:00Z",
  lead: { id: "external-lead" },
  client: { cpf: "12345678909", name: "Synthetic Lead", phone: "11987654321", email: "test@example.invalid" }
});
function signature(body: Uint8Array) {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}
function request(body = JSON.stringify(validPayload()), sig: string | null = signature(Buffer.from(body))) {
  return new Request("http://localhost/webhook", {
    method: "POST", headers: { "content-type": "application/json", ...(sig ? { "x-creditcore-sig": sig } : {}) }, body
  });
}
function handlerFixture(overrides: Record<string, unknown> = {}) {
  let writes = 0;
  let captured: unknown = null;
  const resolvedIds: string[] = [];
  const handler = createOpenCreditWebhookHandler({
    resolveIntegration: async (id) => {
      resolvedIds.push(id);
      return id === publicId ? { ...binding, enabled: true, webhookSecret: "encrypted" } : null;
    },
    resolveSecret: () => secret,
    ingest: async (resolved, payload) => { writes++; captured = { resolved, payload }; return { duplicate: false }; },
    ...overrides
  });
  return { call: (req: Request, id = publicId) => handler(req, { params: Promise.resolve({ publicWebhookId: id }) }),
    writes: () => writes, captured: () => captured, resolvedIds };
}

test("HMAC validates exact raw bytes, not reserialized JSON", () => {
  const raw = Buffer.from('{ "event": "lead.assigned" }');
  assert.equal(verifyOpenCreditSignature(raw, signature(raw), secret), true);
  assert.equal(verifyOpenCreditSignature(Buffer.from('{"event":"lead.assigned"}'), signature(raw), secret), false);
});
for (const [label, sig] of [["missing", null], ["invalid", "sha256=" + "0".repeat(64)], ["malformed", "sha256=xyz"]] as const) {
  test("signature " + label + " rejects before functional writes", async () => {
    const f = handlerFixture();
    assert.equal((await f.call(request(undefined, sig))).status, 403);
    assert.equal(f.writes(), 0);
  });
}
for (const [label, resolve] of [
  ["missing integration", async () => null],
  ["disabled integration", async () => ({ ...binding, enabled: false, webhookSecret: "x" })]
] as const) {
  test(label + " is fail closed", async () => {
    const f = handlerFixture({ resolveIntegration: resolve });
    assert.equal((await f.call(request())).status, 403);
    assert.equal(f.writes(), 0);
  });
}
test("secret decryption failure is fail closed", async () => {
  const f = handlerFixture({ resolveSecret: () => { throw new Error("sensitive"); } });
  const response = await f.call(request());
  assert.equal(response.status, 403);
  assert.equal((await response.text()).includes("sensitive"), false);
  assert.equal(f.writes(), 0);
});
test("valid event is ingested using binding; payload cannot choose company", async () => {
  const f = handlerFixture();
  const body = JSON.stringify({ ...validPayload(), companyId: "company-b", integrationId: "integration-b" });
  assert.equal((await f.call(request(body))).status, 200);
  const captured = f.captured() as { resolved: typeof binding; payload: { externalLeadId: string } };
  assert.deepEqual(captured.resolved, binding);
  assert.equal(captured.payload.externalLeadId, "external-lead");
  assert.equal(f.writes(), 1);
});
for (const [label, body] of [
  ["unknown event", JSON.stringify({ ...validPayload(), event: "message.received" })],
  ["unknown version", JSON.stringify({ ...validPayload(), contractVersion: 3 })],
  ["missing lead", JSON.stringify({ ...validPayload(), lead: {} })],
  ["invalid payload", "[]"],
  ["invalid JSON", "{"],
  ["oversized payload", "x".repeat(65537)]
]) {
  test(label + " produces no domain writes", async () => {
    const f = handlerFixture();
    assert.ok((await f.call(request(body))).status >= 400);
    assert.equal(f.writes(), 0);
  });
}
test("secrets use official encryption, reject plaintext/missing key, opaque IDs", () => {
  const stored = prepareOpenCreditWebhookSecret(secret, options);
  assert.ok(stored.startsWith("enc:v1:"));
  assert.equal(resolveOpenCreditWebhookSecret(stored, options), secret);
  assert.throws(() => resolveOpenCreditWebhookSecret(secret, options));
  assert.throws(() => resolveOpenCreditWebhookSecret(stored, null));
  assert.throws(() => prepareOpenCreditWebhookSecret(secret, null));
  assert.throws(() => prepareOpenCreditWebhookSecret(stored, options));
  assert.match(createOpenCreditPublicWebhookId(), /^[a-f0-9]{48}$/);
  assert.notEqual(createOpenCreditPublicWebhookId(), createOpenCreditPublicWebhookId());
});

type FakeContact = { id: string; companyId: string; cpf: string | null; normalizedPhone: string | null; phone: string; name: string; email?: string | null };
function databaseFixture(initial: FakeContact[] = []) {
  const state = { contacts: [...initial], leads: [] as Array<Record<string, unknown>>, events: [] as Array<Record<string, unknown>>,
    attempts: 0, queries: [] as Array<{ text: string; values: unknown[] }> };
  let failEvent = false;
  let transient = 0;
  let transientCode = "P2034";
  let integrationEnabled = true;
  let transientMeta: Record<string, unknown> | undefined;
  const same = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => row[key] === value);
  const tx = {
    openCreditIntegration: { findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      assert.equal(where.enabled, true);
      assert.ok(where.companyId);
      return integrationEnabled ? { id: where.id } : null;
    } },
    contact: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => state.contacts.filter(c => same(c, where)).slice(0, 2),
      findFirst: async ({ where }: { where: Record<string, unknown> }) => state.contacts.find(c => same(c, where)) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) => state.contacts.find(c => c.id === where.id) ?? null,
      create: async ({ data }: { data: Omit<FakeContact, "id"> }) => {
        const contact = { id: "contact-" + state.contacts.length, ...data };
        state.contacts.push(contact); return contact;
      }
    },
    origin: { findFirst: async () => null },
    pipelineStage: { findFirst: async () => null },
    openCreditLead: {
      findUnique: async ({ where }: { where: { companyId_integrationId_externalLeadId: Record<string, unknown> } }) =>
        state.leads.find(l => same(l, where.companyId_integrationId_externalLeadId)) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { const lead = { id: "lead-" + state.leads.length, ...data }; state.leads.push(lead); return lead; },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(state.leads.find(l => l.id === where.id)!, data)
    },
    openCreditEvent: {
      findUnique: async ({ where }: { where: { integrationId_eventId: Record<string, unknown> } }) =>
        state.events.find(e => same(e, where.integrationId_eventId)) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (failEvent) throw new Error("synthetic failure");
        state.events.push({ id: "event-" + state.events.length, ...data }); return data;
      }
    },
    $queryRaw: async (strings: TemplateStringsArray, ...params: unknown[]) => {
      const query = Prisma.sql(strings, ...params);
      assert.match(query.text, /WHERE "companyId" = \$1/);
      assert.equal(typeof query.values[0], "string");
      const phones = query.values.slice(1).filter(v => typeof v === "string" && /^\d{10,13}$/.test(v));
      assert.ok(phones.length > 0);
      state.queries.push({ text: query.text, values: [...query.values] });
      // Small fixture filter, not a PostgreSQL emulator. Constraints/isolation
      // must still be tested against disposable PostgreSQL before merge.
      return state.contacts.filter(c => c.companyId === query.values[0] &&
        phones.includes(c.phone.replace(/\D/g, "")))
        .slice(0, query.text.includes("LIMIT 1") ? 1 : 2).map(c => ({ id: c.id }));
    }
  };
  const db = {
    openCreditEvent: tx.openCreditEvent,
    $transaction: async (run: (tx: unknown) => Promise<unknown>, options: { isolationLevel: string }) => {
      assert.equal(options.isolationLevel, "Serializable");
      state.attempts++;
      if (transient-- > 0) throw new Prisma.PrismaClientKnownRequestError("synthetic", {
        code: transientCode, clientVersion: "5.22.0", meta: transientMeta
      });
      const snapshot = structuredClone(state);
      try { return await run(tx); }
      catch (error) { Object.assign(state, snapshot); throw error; }
    }
  } as unknown as Pick<PrismaClient, "$transaction" | "openCreditEvent">;
  return { db, state, fail: () => { failEvent = true; }, transient: (n: number) => { transient = n; },
    uniqueConflict: (meta: Record<string, unknown> = {
      modelName: "OpenCreditEvent", target: ["integrationId", "eventId"]
    }) => { transient = 1; transientCode = "P2002"; transientMeta = meta; },
    disable: () => { integrationEnabled = false; } };
}
test("retry deduplicates event and Contact; another event reuses external lead", async () => {
  const f = databaseFixture();
  const payload = parseOpenCreditAssignedLead(validPayload());
  assert.equal((await ingestOpenCreditLead(f.db, binding, payload)).duplicate, false);
  assert.equal((await ingestOpenCreditLead(f.db, binding, payload)).duplicate, true);
  await ingestOpenCreditLead(f.db, binding, { ...payload, eventId: "event-2" });
  assert.equal(f.state.contacts.length, 1);
  assert.equal(f.state.leads.length, 1);
  assert.equal(f.state.events.length, 2);
  assert.equal(f.state.leads[0].externalLeadId, "external-lead");
  assert.equal(f.state.events[0].companyId, binding.companyId);
});
test("eventId cannot be rebound to another external lead", async () => {
  const f = databaseFixture();
  const payload = parseOpenCreditAssignedLead(validPayload());
  await ingestOpenCreditLead(f.db, binding, payload);
  await assert.rejects(ingestOpenCreditLead(f.db, binding, { ...payload, externalLeadId: "another" }), /EVENT_ID_CONFLICT/);
  assert.equal(f.state.contacts.length, 1);
});
test("event insertion failure rolls back Contact and external identity", async () => {
  const f = databaseFixture(); f.fail();
  await assert.rejects(ingestOpenCreditLead(f.db, binding, parseOpenCreditAssignedLead(validPayload())));
  assert.equal(f.state.contacts.length, 0);
  assert.equal(f.state.leads.length, 0);
});
test("serialization conflict retries boundedly", async () => {
  const f = databaseFixture(); f.transient(1);
  await ingestOpenCreditLead(f.db, binding, parseOpenCreditAssignedLead(validPayload()));
  assert.equal(f.state.attempts, 2);
  assert.equal(f.state.contacts.length, 1);
});
test("serialization exhaustion returns retryable sanitized failure", async () => {
  const f = databaseFixture(); f.transient(3);
  await assert.rejects(ingestOpenCreditLead(f.db, binding, parseOpenCreditAssignedLead(validPayload())), /INGESTION_BUSY/);
  assert.equal(f.state.attempts, 3);
  assert.equal(f.state.contacts.length, 0);
});
test("existing Contact is preserved; another company's Contact is never selected", async () => {
  const existing = { id: "existing", companyId: "company-a", cpf: "12345678909", normalizedPhone: "5511987654321", phone: "5511987654321", name: "Trusted Local", email: "local@example.invalid" };
  const f = databaseFixture([existing, { ...existing, id: "other", companyId: "company-b" }]);
  await ingestOpenCreditLead(f.db, binding, parseOpenCreditAssignedLead(validPayload()));
  assert.deepEqual(f.state.contacts[0], existing);
  assert.equal(f.state.leads[0].contactId, existing.id);
  const separate = databaseFixture([{ ...existing, companyId: "company-b" }]);
  await ingestOpenCreditLead(separate.db, binding, parseOpenCreditAssignedLead(validPayload()));
  assert.equal(separate.state.contacts.length, 2);
  assert.equal(separate.state.contacts[1].companyId, "company-a");
});
test("CPF/phone conflict is recorded for review without overwriting contacts", async () => {
  const contacts = [
    { id: "cpf", companyId: "company-a", cpf: "12345678909", normalizedPhone: "5511999999999", phone: "5511999999999", name: "Local A" },
    { id: "phone", companyId: "company-a", cpf: "98765432100", normalizedPhone: "5511987654321", phone: "5511987654321", name: "Local B" }
  ];
  const f = databaseFixture(contacts);
  await ingestOpenCreditLead(f.db, binding, parseOpenCreditAssignedLead(validPayload()));
  assert.deepEqual(f.state.contacts, contacts);
  assert.equal(f.state.leads[0].contactId, null);
  assert.equal(f.state.events[0].processingStatus, "NEEDS_REVIEW");
});
test("lead without phone remains recorded without artificial Contact or financial PII", async () => {
  const f = databaseFixture();
  const raw = { ...validPayload(), client: {}, creditProfile: { availableMarginCents: 999 }, lead: { id: "external-lead", offer: { amount: 999 } } };
  await ingestOpenCreditLead(f.db, binding, parseOpenCreditAssignedLead(raw));
  assert.equal(f.state.contacts.length, 0);
  assert.equal(f.state.events[0].errorCode, "CONTACT_DATA_INCOMPLETE");
  assert.equal(JSON.stringify(f.state.events).includes("availableMargin"), false);
  assert.equal(JSON.stringify(f.state.leads).includes("offer"), false);
});
test("ingestion dependency surface cannot send outbound, AI or credit; unexpected errors are sanitized", async () => {
  // The service fake exposes only persistence/identity delegates. No fetch,
  // Meta, Message, Conversation, Campaign, Proposal or IA delegate exists.
  const f = databaseFixture();
  await ingestOpenCreditLead(f.db, binding, parseOpenCreditAssignedLead(validPayload()));
  const handler = handlerFixture({ ingest: async () => { throw new Error("sensitive payload"); } });
  const response = await handler.call(request());
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes("sensitive"), false);
});

test("ambiguous legacy phone identities require review", async () => {
  const f = databaseFixture(["legacy-a", "legacy-b"].map(id => ({
    id, companyId: binding.companyId, name: "Synthetic", cpf: null,
    normalizedPhone: null, phone: "(11) 98765-4321"
  })));
  await ingestOpenCreditLead(f.db, binding, parseOpenCreditAssignedLead(validPayload()));
  assert.equal(f.state.contacts.length, 2);
  assert.equal(f.state.events[0].errorCode, "CONTACT_IDENTITY_CONFLICT");
});

test("same eventId in another integration is independent and tenant scoped", async () => {
  const f = databaseFixture();
  const payload = parseOpenCreditAssignedLead(validPayload());
  await ingestOpenCreditLead(f.db, binding, payload);
  await ingestOpenCreditLead(f.db, { id: "integration-b", companyId: "company-b" }, payload);
  assert.equal(f.state.events.length, 2);
  assert.equal(f.state.contacts.length, 2);
  assert.equal(f.state.leads[1].companyId, "company-b");
});

test("functional ingestion never invokes fetch", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("external calls prohibited"); };
  try {
    const f = databaseFixture();
    await ingestOpenCreditLead(f.db, binding, parseOpenCreditAssignedLead(validPayload()));
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test("invalid identity fields are not silently stripped into valid identifiers", () => {
  assert.throws(() => parseOpenCreditAssignedLead({ ...validPayload(), client: { cpf: "abc12345678909" } }));
  assert.throws(() => parseOpenCreditAssignedLead({ ...validPayload(), client: { phone: "abc11987654321" } }));
});

test("integration is rechecked inside transaction before any domain writes", async () => {
  const f = databaseFixture(); f.disable();
  await assert.rejects(ingestOpenCreditLead(f.db, binding, parseOpenCreditAssignedLead(validPayload())), /INTEGRATION_UNAVAILABLE/);
  assert.equal(f.state.contacts.length, 0);
  assert.equal(f.state.leads.length, 0);
  assert.equal(f.state.events.length, 0);
});

test("unique conflict recovers a committed duplicate without repeating Contact creation", async () => {
  const f = databaseFixture();
  const payload = parseOpenCreditAssignedLead(validPayload());
  await ingestOpenCreditLead(f.db, binding, payload);
  f.uniqueConflict();
  assert.equal((await ingestOpenCreditLead(f.db, binding, payload)).duplicate, true);
  assert.equal(f.state.contacts.length, 1);
  assert.equal(f.state.events.length, 1);
});

for (const phone of ["11987654321", "+55 (11) 98765-4321"]) {
  test("Brazilian phone remains usable: " + phone, () => {
    assert.equal(parseOpenCreditAssignedLead({ ...validPayload(), client: { phone } }).client.phone, "5511987654321");
  });
}
for (const phone of ["+12125550199", "+351912345678"]) {
  test("foreign explicit DDI is unusable, never linked to a Brazilian Contact: " + phone, async () => {
    const digits = phone.replace(/\D/g, "");
    const existing = { id: "br", companyId: binding.companyId, name: "Synthetic local", cpf: null,
      normalizedPhone: "55" + digits, phone: "55" + digits };
    const f = databaseFixture([existing]);
    const payload = parseOpenCreditAssignedLead({ ...validPayload(), client: { phone } });
    assert.equal(payload.client.phone, null);
    await ingestOpenCreditLead(f.db, binding, payload);
    assert.equal(f.state.contacts.length, 1);
    assert.equal(f.state.leads[0].externalLeadId, "external-lead");
    assert.equal(f.state.leads[0].contactId, null);
    assert.equal(f.state.events[0].errorCode, "CONTACT_DATA_INCOMPLETE");
    assert.equal(f.state.queries.length, 0);
  });
}
test("foreign phone does not prevent CPF-only identity resolution", async () => {
  const existing = { id: "cpf-local", companyId: binding.companyId, name: "Synthetic local", cpf: "12345678909",
    normalizedPhone: "5511987654321", phone: "5511987654321" };
  const f = databaseFixture([existing]);
  const payload = parseOpenCreditAssignedLead({ ...validPayload(), client: { phone: "+12125550199", cpf: existing.cpf } });
  await ingestOpenCreditLead(f.db, binding, payload);
  assert.equal(f.state.leads[0].contactId, existing.id);
  assert.deepEqual(f.state.contacts, [existing]);
});
test("invalid explicit Brazilian DDI is not treated as a local phone", () => {
  assert.throws(() => parseOpenCreditAssignedLead({ ...validPayload(), client: { phone: "+5512345678" } }));
});

for (const assignedAt of ["2026-10-09T17:00:00Z", "2024-02-29T23:59:59Z", "2026-10-09T17:00:00-03:00", "2026-10-09T00:00:00.123456+02:00"]) {
  test("valid calendar/RFC3339 timestamp accepted: " + assignedAt, () => {
    assert.equal(parseOpenCreditAssignedLead({ ...validPayload(), assignedAt }).assignedAt.getTime(), new Date(assignedAt).getTime());
  });
}
for (const assignedAt of ["2026-02-29T17:00:00Z", "2026-02-30T17:00:00Z", "2026-13-01T17:00:00Z", "2026-04-31T17:00:00Z", "2026-10-09T24:00:00Z", "2026-10-09T17:00:00+24:00"]) {
  test("impossible calendar/time rejected: " + assignedAt, async () => {
    const f = handlerFixture();
    assert.equal((await f.call(request(JSON.stringify({ ...validPayload(), assignedAt })))).status, 422);
    assert.equal(f.writes(), 0);
  });
}
test("route resolver receives public ID; another valid opaque ID is fail closed", async () => {
  const f = handlerFixture();
  assert.equal((await f.call(request())).status, 200);
  assert.equal((await f.call(request(), "b".repeat(48))).status, 403);
  assert.deepEqual(f.resolvedIds, [publicId, "b".repeat(48)]);
  assert.equal(f.writes(), 1);
});
test("invalid public ID never invokes resolver", async () => {
  const f = handlerFixture();
  assert.equal((await f.call(request(), "company-a")).status, 403);
  assert.deepEqual(f.resolvedIds, []);
  assert.equal(f.writes(), 0);
});
test("legacy SQL binds only resolved tenant and exact phone identifiers", async () => {
  const base = { name: "Synthetic", cpf: null, phone: "(11) 98765-4321", normalizedPhone: null };
  const f = databaseFixture([
    { ...base, id: "local", companyId: binding.companyId },
    { ...base, id: "foreign", companyId: "company-b" }
  ]);
  const payload = parseOpenCreditAssignedLead({ ...validPayload(), companyId: "company-b", client: { phone: "11987654321" } });
  await ingestOpenCreditLead(f.db, binding, payload);
  assert.equal(f.state.leads[0].contactId, "local");
  assert.equal(f.state.queries.length, 2);
  for (const query of f.state.queries) {
    assert.match(query.text, /WHERE "companyId" = \$1/);
    assert.deepEqual(query.values, query.text.includes("LIMIT 1")
      ? [binding.companyId, "5511987654321", "11987654321", "5511987654321"]
      : [binding.companyId, "5511987654321", "11987654321"]);
    assert.equal(query.values.includes("company-b"), false);
  }
});

test("unexpected or unidentified P2002 does not recover as success or retry", async () => {
  for (const meta of [{ target: ["id"], modelName: "Contact" }, {},
    { target: ["integrationId", "eventId"], modelName: "OtherModel" }]) {
    const f = databaseFixture();
    const payload = parseOpenCreditAssignedLead(validPayload());
    await ingestOpenCreditLead(f.db, binding, payload);
    f.uniqueConflict(meta);
    await assert.rejects(ingestOpenCreditLead(f.db, binding, payload), (error: unknown) =>
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002");
    assert.equal(f.state.attempts, 2);
    assert.equal(f.state.events.length, 1);
  }
});
test("expected lead unique/index conflict retries boundedly", async () => {
  for (const target of [["companyId", "integrationId", "externalLeadId"], "OpenCreditLead_companyId_integrationId_externalLeadId_key"]) {
    const f = databaseFixture();
    f.uniqueConflict({ modelName: "OpenCreditLead", target });
    await ingestOpenCreditLead(f.db, binding, parseOpenCreditAssignedLead(validPayload()));
    assert.equal(f.state.attempts, 2);
    assert.equal(f.state.contacts.length, 1);
  }
});
test("deadline expiry prevents starting new work", async () => {
  let now = 0;
  const deadline = new OpenCreditDeadline(8000, () => now);
  assert.equal(deadline.remainingMs(), 8000);
  now = 8000;
  let called = false;
  await assert.rejects(deadline.wait(async () => { called = true; }), /REQUEST_DEADLINE_EXCEEDED/);
  const f = databaseFixture();
  await assert.rejects(ingestOpenCreditLead(f.db, binding, parseOpenCreditAssignedLead(validPayload()), deadline), /REQUEST_DEADLINE_EXCEEDED/);
  assert.equal(called, false);
  assert.equal(f.state.attempts, 0);
});
test("deadline times out a pending operation without claiming cancellation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const deadline = new OpenCreditDeadline(8000, () => 0);
    const checked = assert.rejects(deadline.wait(() => new Promise(() => {})), /REQUEST_DEADLINE_EXCEEDED/);
    t.mock.timers.tick(8000);
    await checked;
  } finally { t.mock.timers.reset(); }
});
test("body stalled mid-stream hits deadline and cancels reader before ingestion", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let pulled!: () => void;
    const started = new Promise<void>(resolve => { pulled = resolve; });
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ pull: () => { pulled(); }, cancel: () => { cancelled = true; } }, { highWaterMark: 0 });
    const f = handlerFixture({ createDeadline: () => new OpenCreditDeadline(8000, () => 0) });
    const pending = f.call(new Request("http://localhost/webhook", {
      method: "POST", headers: { "content-type": "application/json", "x-creditcore-sig": signature(Buffer.from("{}")) },
      body: stream, duplex: "half"
    } as RequestInit));
    await started;
    t.mock.timers.tick(8000);
    const response = await pending;
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { code: "REQUEST_DEADLINE_EXCEEDED" });
    assert.equal(cancelled, true);
    assert.equal(f.writes(), 0);
  } finally { t.mock.timers.reset(); }
});
test("expired budget after conflict does not start recovery lookup or another attempt", async () => {
  let now = 0, lookups = 0, attempts = 0;
  const deadline = new OpenCreditDeadline(8000, () => now);
  const db = {
    $transaction: async () => { attempts++; now = 8000; throw new Prisma.PrismaClientKnownRequestError("synthetic", { code: "P2034", clientVersion: "5.22.0" }); },
    openCreditEvent: { findUnique: async () => { lookups++; return null; } }
  } as unknown as Pick<PrismaClient, "$transaction" | "openCreditEvent">;
  await assert.rejects(ingestOpenCreditLead(db, binding, parseOpenCreditAssignedLead(validPayload()), deadline), /REQUEST_DEADLINE_EXCEEDED/);
  assert.equal(lookups, 0);
  assert.equal(attempts, 1);
});
