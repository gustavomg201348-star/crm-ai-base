import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { Prisma, type OpenCreditIntegration, type PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import { createOpenCreditWebhookSecret, prepareOpenCreditWebhookSecret, resolveOpenCreditWebhookSecret } from "./opencredit-secrets";
import { verifyOpenCreditSignature } from "./opencredit-webhook-contract";
import { createOpenCreditIntegrationService, mapOpenCreditIntegration } from "./opencredit-integration.service";
import { createOpenCreditManagementHandlers } from "./opencredit-management-handler";

const encryption = { activeKeyId: "v1", keys: { v1: Buffer.alloc(32, 7) } };
const admin: SessionUser = { id: "synthetic-admin", companyId: "synthetic-company-a", name: "Synthetic", email: "admin@example.test", role: "ADMIN" };
function fixture(options: typeof encryption | null = encryption, session: SessionUser | null = admin) {
  const rows: OpenCreditIntegration[] = [];
  const calls: Array<{ method: string; args: unknown }> = [];
  let counter = 0;
  let conflict = false;
  let createError: string | null = null;
  type Args = { where?: Record<string, unknown>; data?: Record<string, unknown>; orderBy?: unknown };
  const matches = (row: OpenCreditIntegration, where: Record<string, unknown> = {}) => Object.entries(where).every(([key, value]) => {
    const actual = row[key as keyof OpenCreditIntegration];
    return actual instanceof Date && value instanceof Date ? actual.getTime() === value.getTime() : actual === value;
  });
  const db = { openCreditIntegration: {
    async findMany(args: Args) { calls.push({ method: "findMany", args }); return rows.filter(row => matches(row, args.where)).map(row => ({ ...row })); },
    async findFirst(args: Args) { calls.push({ method: "findFirst", args }); const row = rows.find(row => matches(row, args.where)); return row ? { ...row } : null; },
    async create(args: Args) {
      if (createError) throw new Error(createError);
      calls.push({ method: "create", args });
      const row = { ...args.data, id: `integration-${++counter}`, createdAt: new Date(counter), updatedAt: new Date(counter) } as OpenCreditIntegration;
      rows.push(row); return { ...row };
    },
    async update(args: Args) {
      calls.push({ method: "update", args });
      const row = rows.find(row => matches(row, args.where));
      if (conflict || !row) throw new Prisma.PrismaClientKnownRequestError("synthetic conflict", { code: "P2025", clientVersion: "5.22.0" });
      Object.assign(row, args.data, { updatedAt: new Date(++counter) });
      return { ...row };
    }
  } } as unknown as Pick<PrismaClient, "openCreditIntegration">;
  const service = createOpenCreditIntegrationService(db, options);
  const handlers = createOpenCreditManagementHandlers({ getSession: async () => session, service });
  return { rows, calls, db, service, handlers, conflict: () => { conflict = true; }, failCreate: (marker: string) => { createError = marker; } };
}
function request(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/integrations/opencredit", {
    method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  });
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });
function assertNoStore(response: Response) { assert.equal(response.headers.get("Cache-Control"), "no-store"); }

test("server secrets use 32 random bytes, hex encoding and distinct CSPRNG samples", () => {
  const samples = Array.from({ length: 100 }, () => createOpenCreditWebhookSecret());
  assert.ok(samples.every(secret => /^[a-f0-9]{64}$/.test(secret) && Buffer.from(secret, "hex").length === 32));
  assert.equal(new Set(samples).size, 100);
});
test("create encrypts at rest, returns secret once, uses session tenant and starts disabled", async () => {
  const f = fixture(); const response = await f.handlers.POST(request("POST", {}));
  assert.equal(response.status, 201); assertNoStore(response);
  const data = await response.json();
  assert.equal(f.rows.length, 1); assert.equal(f.rows[0].companyId, admin.companyId);
  assert.equal(f.rows[0].enabled, false); assert.equal(data.integration.enabled, false);
  assert.ok(f.rows[0].webhookSecret.startsWith("enc:v1:"));
  assert.ok(f.rows[0].webhookSecret !== data.setupSecret);
  assert.ok(resolveOpenCreditWebhookSecret(f.rows[0].webhookSecret, encryption) === data.setupSecret);
});
test("GET is tenant scoped/read only and never returns plaintext or ciphertext", async () => {
  const f = fixture(); const a = await f.service.create(admin.companyId); await f.service.create("synthetic-company-b");
  f.calls.length = 0;
  const response = await f.handlers.GET(request("GET")); assertNoStore(response);
  const text = await response.text(); const data = JSON.parse(text);
  assert.equal(data.integrations.length, 1); assert.equal(data.integrations[0].id, a.integration.id);
  assert.ok(!text.includes(a.setupSecret) && !text.includes("enc:v1:") && !text.includes('"webhookSecret"'));
  assert.deepEqual(f.calls.map(call => call.method), ["findMany"]);
  assert.deepEqual(f.calls[0].args, { where: { companyId: admin.companyId }, orderBy: { createdAt: "desc" } });
});
test("mapper uses an exact whitelist, including legacy dates and secret-presence boolean", async () => {
  const f = fixture(); await f.service.create(admin.companyId);
  assert.deepEqual(Object.keys(mapOpenCreditIntegration(f.rows[0])).sort(),
    ["id", "publicWebhookId", "enabled", "createdAt", "updatedAt", "hasWebhookSecret", "webhookPath"].sort());
  const mapped = mapOpenCreditIntegration({ ...f.rows[0], webhookSecret: "" });
  assert.equal(mapped.hasWebhookSecret, false);
  assert.equal(mapped.webhookPath, `/api/integrations/opencredit/webhooks/${mapped.publicWebhookId}`);
});
test("multiple integrations per company remain independent", async () => {
  const f = fixture(); const a = await f.service.create(admin.companyId); const b = await f.service.create(admin.companyId);
  assert.equal((await f.service.list(admin.companyId)).length, 2);
  assert.ok(a.integration.publicWebhookId !== b.integration.publicWebhookId && a.setupSecret !== b.setupSecret);
});
for (const role of ["AGENT", "SUPERVISOR"] as const) {
  for (const action of ["GET", "POST", "PATCH", "ROTATE"] as const) {
    test(`${role} cannot perform configuration ${action}`, async () => {
      const f = fixture(encryption, { ...admin, role });
      const response = await f.handlers[action](request(action === "GET" ? "GET" : action === "PATCH" ? "PATCH" : "POST", action === "GET" ? undefined : {}), context("integration-b"));
      assert.equal(response.status, 403); assertNoStore(response); assert.equal(f.calls.length, 0);
    });
  }
}
for (const action of ["GET", "POST", "PATCH", "ROTATE"] as const) {
  test(`unauthenticated configuration ${action} rejects before DB access`, async () => {
    const f = fixture(encryption, null);
    const response = await f.handlers[action](request(action === "GET" ? "GET" : "POST"), context("integration-b"));
    assert.equal(response.status, 401); assertNoStore(response); assert.equal(f.calls.length, 0);
  });
}
for (const enabled of [true, false]) {
  test(`tenant A cannot set tenant B enabled=${enabled}`, async () => {
    const f = fixture(); const b = await f.service.create("synthetic-company-b"); f.calls.length = 0;
    const before = { ...f.rows[0] };
    const response = await f.handlers.PATCH(request("PATCH", { enabled }), context(b.integration.id));
    assert.equal(response.status, 404); assertNoStore(response); assert.deepEqual(f.rows[0], before);
    assert.deepEqual(f.calls.map(call => call.method), ["findFirst"]);
    assert.deepEqual(f.calls[0].args, { where: { id: b.integration.id, companyId: admin.companyId } });
  });
}
test("tenant A cannot rotate tenant B secret", async () => {
  const f = fixture(); const b = await f.service.create("synthetic-company-b"); f.calls.length = 0;
  const before = { ...f.rows[0] };
  const response = await f.handlers.ROTATE(request("POST", {}), context(b.integration.id));
  assert.equal(response.status, 404); assert.deepEqual(f.rows[0], before);
  assert.deepEqual(f.calls.map(call => call.method), ["findFirst"]);
});
for (const body of [{}, { enabled: "true" }, { enabled: true, companyId: "other" }, { enabled: true, webhookSecret: "synthetic-secret" },
  { enabled: true, publicWebhookId: "other" }, { enabled: true, createdAt: "other" }, [], null]) {
  test(`PATCH rejects non-whitelisted body ${JSON.stringify(Object.keys(body ?? {}))}`, async () => {
    const f = fixture(); const response = await f.handlers.PATCH(request("PATCH", body), context("integration-a"));
    assert.equal(response.status, 400); assert.equal(f.calls.length, 0);
  });
}
for (const action of ["POST", "ROTATE"] as const) {
  test(`${action} rejects client companyId, enabled or secret`, async () => {
    for (const body of [{ companyId: "other" }, { enabled: true }, { setupSecret: "synthetic" }]) {
      const f = fixture(); const response = await f.handlers[action](request("POST", body), context("integration-a"));
      assert.equal(response.status, 400); assert.equal(f.calls.length, 0);
    }
  });
}
test("PATCH only changes enabled and never returns setupSecret", async () => {
  const f = fixture(); const created = await f.service.create(admin.companyId);
  for (const enabled of [true, false]) {
    const response = await f.handlers.PATCH(request("PATCH", { enabled }), context(created.integration.id));
    assert.equal(response.status, 200); assertNoStore(response);
    const text = await response.text();
    assert.ok(!text.includes("setupSecret") && !text.includes("webhookSecret") && !text.includes("enc:v1:") && !text.includes(created.setupSecret));
    assert.equal(f.rows[0].enabled, enabled);
    const write = f.calls.filter(call => call.method === "update").at(-1)!.args as { where: { companyId: string }; data: unknown };
    assert.equal(write.where.companyId, admin.companyId); assert.deepEqual(write.data, { enabled });
  }
});
test("rotation changes encrypted secret and disables atomically; old signature fails and public ID is stable", async () => {
  const f = fixture(); const created = await f.service.create(admin.companyId);
  await f.service.setEnabled(admin.companyId, created.integration.id, true);
  const oldCiphertext = f.rows[0].webhookSecret;
  const response = await f.handlers.ROTATE(request("POST", {}), context(created.integration.id));
  assert.equal(response.status, 200); assertNoStore(response);
  const data = await response.json();
  assert.ok(data.setupSecret !== created.setupSecret && f.rows[0].webhookSecret !== oldCiphertext);
  assert.equal(data.integration.enabled, false); assert.equal(f.rows[0].enabled, false);
  assert.equal(data.integration.publicWebhookId, created.integration.publicWebhookId);
  const resolved = resolveOpenCreditWebhookSecret(f.rows[0].webhookSecret, encryption);
  assert.ok(resolved === data.setupSecret && resolved !== created.setupSecret);
  const raw = Buffer.from("synthetic payload");
  const signature = (secret: string) => "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(verifyOpenCreditSignature(raw, signature(created.setupSecret), resolved), false);
  assert.equal(verifyOpenCreditSignature(raw, signature(data.setupSecret), resolved), true);
  const write = f.calls.filter(call => call.method === "update").at(-1)!.args as { where: { companyId: string }; data: Record<string, unknown> };
  assert.equal(write.where.companyId, admin.companyId);
  assert.deepEqual(Object.keys(write.data).sort(), ["enabled", "webhookSecret"]); assert.equal(write.data.enabled, false);
});
test("missing encryption fails create and rotation closed without writes", async () => {
  const f = fixture(null);
  await assert.rejects(() => f.service.create(admin.companyId)); assert.equal(f.calls.length, 0);
  f.rows.push({ id: "existing", companyId: admin.companyId, publicWebhookId: "a".repeat(48), enabled: true,
    webhookSecret: prepareOpenCreditWebhookSecret("synthetic", encryption), createdAt: new Date(), updatedAt: new Date() });
  await assert.rejects(() => f.service.rotate(admin.companyId, "existing"));
  assert.equal(f.rows[0].enabled, true); assert.equal(f.calls.filter(call => call.method === "update").length, 0);
});
test("enable fails closed if the stored encrypted secret cannot be resolved", async () => {
  const f = fixture(); const created = await f.service.create(admin.companyId); f.rows[0].webhookSecret = "invalid-envelope";
  await assert.rejects(() => f.service.setEnabled(admin.companyId, created.integration.id, true));
  assert.equal(f.rows[0].enabled, false); assert.equal(f.calls.filter(call => call.method === "update").length, 0);
});
test("concurrent configuration conflict does not retry or return a setupSecret", async () => {
  const f = fixture(); const created = await f.service.create(admin.companyId); f.conflict();
  const response = await f.handlers.ROTATE(request("POST", {}), context(created.integration.id));
  assert.equal(response.status, 409); assertNoStore(response);
  assert.ok(!(await response.text()).includes("setupSecret"));
  assert.equal(f.calls.filter(call => call.method === "update").length, 1);
});
test("unexpected DB errors never appear in the public response or safe logs", async () => {
  const f = fixture(); const marker = "synthetic-do-not-log-credential";
  f.failCreate(marker);
  const output: unknown[] = []; const original = console.error;
  console.error = (...args) => { output.push(args); };
  try {
    const response = await f.handlers.POST(request("POST", {})); assert.equal(response.status, 500); assertNoStore(response);
    assert.ok(!(await response.text()).includes(marker)); assert.ok(!JSON.stringify(output).includes(marker));
  } finally { console.error = original; }
});
test("routes use the official session resolver and UI keeps one-time secret only in React state", () => {
  const wiring = readFileSync("src/lib/opencredit-management.ts", "utf8");
  assert.ok(wiring.includes("getSession: getSessionFromRequest"));
  const ui = readFileSync("src/app/components/integrations/OpenCreditSettingsCard.tsx", "utf8");
  assert.ok(ui.includes("setSetup(null)") && ui.includes("window.location.origin"));
  assert.ok(!/localStorage|sessionStorage|document\.cookie|console\./.test(ui));
  for (const path of ["src/app/api/integrations/opencredit/route.ts", "src/app/api/integrations/opencredit/[id]/route.ts",
    "src/app/api/integrations/opencredit/[id]/rotate-secret/route.ts"]) {
    assert.ok(!readFileSync(path, "utf8").includes("export const DELETE"));
  }
});
