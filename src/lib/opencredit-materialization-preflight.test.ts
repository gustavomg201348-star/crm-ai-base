import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module from "node:module";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { requirePlatformAdmin } from "./permissions";
import type { SessionUser } from "./auth";

let boundary: typeof import("./opencredit-materialization-preflight-admin-handler");
let service: typeof import("./opencredit-materialization-preflight.service");

before(async () => {
  const loader = Module as typeof Module & { _load(s: string, ...args: unknown[]): unknown };
  const original = loader._load;
    loader._load = (s, ...args) => s === "server-only" ? {} : s === "./opencredit-materialization-readiness" ? {
    evaluateMaterializationReadiness: async (_tx: unknown, job: { id: string }) =>
      job.id.startsWith("waiting") ? "WAITING_IDENTITY" : "READY_NEW_CONTACT",
  } : original.call(loader, s, ...args);
  try {
    boundary = await import("./opencredit-materialization-preflight-admin-handler");
    service = await import("./opencredit-materialization-preflight.service");
  } finally {
    loader._load = original;
  }
});

const actor: SessionUser = {
  id: "admin",
  companyId: "platform",
  role: "ADMIN",
  email: "synthetic@example.invalid",
  name: "Synthetic",
};
const scope = "synthetic-scope" as Parameters<typeof service.getOpenCreditMaterializationPreflight>[1]["providerScope"];

function admin(s: SessionUser) {
  const old = process.env.PLATFORM_COMPANY_ID;
  process.env.PLATFORM_COMPANY_ID = actor.companyId;
  try { return requirePlatformAdmin(s); }
  finally {
    if (old === undefined) delete process.env.PLATFORM_COMPANY_ID;
    else process.env.PLATFORM_COMPANY_ID = old;
  }
}

function request(body = '{"companyId":"company"}', headers: Record<string, string | null> = {}) {
  const h = new Headers({ origin: "https://crm.example.invalid", "content-type": "application/json" });
  for (const [key, value] of Object.entries(headers)) {
    if (value === null) h.delete(key); else h.set(key, value);
  }
  return new NextRequest("https://crm.example.invalid/api/admin/integrations/opencredit/materialization/preflight", {
    method: "POST",
    headers: h,
    body,
  });
}

test("handler requires platform admin and same origin", async () => {
  const deps = {
    db: {} as Parameters<typeof service.getOpenCreditMaterializationPreflight>[0],
    getSession: async () => actor,
    requirePlatformAdmin: (s: SessionUser) => admin(s),
    enforceLimits: async () => null,
    resolveScope: () => scope,
    read: async () => ({ ok: true as const, companyId: "company", providerScope: scope, generatedAt: "now", integrations: [] }),
  };
  assert.equal((await boundary.createOpenCreditMaterializationPreflightHandler(deps)(request())).status, 200);
  assert.equal((await boundary.createOpenCreditMaterializationPreflightHandler({
    ...deps,
    getSession: async () => null,
  })(request())).status, 401);
  assert.equal((await boundary.createOpenCreditMaterializationPreflightHandler(deps)(request(undefined, { origin: "https://evil.invalid" }))).status, 403);
});

test("service returns only sanitized queue metadata and exact readiness counts", async () => {
  const countCalls: unknown[] = [];
  let readinessPage = 0;
  const tx = {
    $executeRaw: async () => 0,
    user: { findUnique: async () => actor },
    company: { findUnique: async () => ({ id: "company" }) },
    openCreditIntegration: {
      findMany: async () => [{
        id: "integration",
        enabled: false,
        paused: false,
        passiveInboundEnabled: true,
        materializationEnabled: false,
        createdAt: new Date("2026-11-01T00:00:00Z"),
        updatedAt: new Date("2026-11-06T00:00:00Z"),
      }],
    },
    openCreditLeadMaterialization: {
      count: async (query: unknown) => {
        countCalls.push(query);
        const text = JSON.stringify(query);
        if (text.includes('"state":"PENDING"')) return 2;
        if (text.includes('"state":"RETRY"')) return 1;
        if (text.includes('"state":"PROCESSING"')) return 0;
        if (text.includes('"state":"NEEDS_REVIEW"')) return 1;
        if (text.includes('"state":"COMPLETED"')) return 3;
        if (text.includes('"state":"EXPIRED"')) return 4;
        if (text.includes('"attempts":{"lt":10}')) return 2;
        return 11;
      },
      findMany: async (q: { select?: { protectedEnvelope?: boolean } }) => q.select?.protectedEnvelope
        ? readinessPage++ === 0 ? [{ id: "ready-1" }, { id: "ready-2" }] : [] : [{
        id: "queue-1",
        externalLeadId: "lead-1",
        state: "PENDING",
        attempts: 0,
        availableAt: null,
        expiresAt: new Date("2026-11-10T00:00:00Z"),
        createdAt: new Date("2026-11-06T00:00:00Z"),
      }],
    },
  };
  const db = { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) };
  const old = process.env.PLATFORM_COMPANY_ID;
  process.env.PLATFORM_COMPANY_ID = actor.companyId;
  try {
    const result = await service.getOpenCreditMaterializationPreflight(db as never, {
      actor,
      companyId: "company",
      providerScope: scope,
    });
    assert.equal(result.integrations.length, 1);
    assert.equal(result.integrations[0].materializationEnabled, false);
    assert.equal(result.integrations[0].queue.claimableNow, 0);
    assert.equal(result.integrations[0].queue.readyIfEnabled, 2);
    assert.deepEqual(result.integrations[0].queue.candidates[0], {
      id: "queue-1",
      externalLeadId: "lead-1",
      state: "PENDING",
      attempts: 0,
      availableAt: null,
      expiresAt: "2026-11-10T00:00:00.000Z",
      createdAt: "2026-11-06T00:00:00.000Z",
    });
    assert(countCalls.length > 0);
    assert.equal("protectedEnvelope" in result.integrations[0].queue.candidates[0], false);
  } finally {
    if (old === undefined) delete process.env.PLATFORM_COMPANY_ID;
    else process.env.PLATFORM_COMPANY_ID = old;
  }
});

test("preflight source has no mutations and declares a read-only transaction", () => {
  const svc = readFileSync("src/lib/opencredit-materialization-preflight.service.ts", "utf8");
  const handler = readFileSync("src/lib/opencredit-materialization-preflight-admin-handler.ts", "utf8");
  const route = readFileSync("src/app/api/admin/integrations/opencredit/materialization/preflight/route.ts", "utf8");
  assert.match(svc, /^import "server-only"/);
  assert.doesNotMatch(svc, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|queryRaw)\b|decrypt|unprotect|opencredit-api-client|\bfetch\s*\(/i);
  assert.match(svc, /SET TRANSACTION READ ONLY/);
  assert.match(handler, /sameOrigin/);
  assert.match(handler, /requirePlatformAdmin/);
  assert.match(route, /export const POST = createOpenCreditMaterializationPreflightHandler/);
});

test("preflight caps identity reads and labels partial counts instead of claiming full readiness", async () => {
  let pages = 0;
  const tx = {
    $executeRaw: async (sql: TemplateStringsArray) => { assert.equal(sql.join(""), "SET TRANSACTION READ ONLY"); return 0; },
    user: { findUnique: async () => actor }, company: { findUnique: async () => ({ id: "company" }) },
    openCreditIntegration: { findMany: async () => [{ id: "integration", enabled: false, paused: false,
      passiveInboundEnabled: true, materializationEnabled: true, createdAt: new Date(), updatedAt: new Date() }] },
    openCreditLeadMaterialization: {
      count: async (q: { where: { state?: unknown; attempts?: unknown } }) =>
        q.where.state === "PENDING" || q.where.state === undefined || q.where.attempts ? 201 : 0,
      findMany: async (q: { take: number; select: { protectedEnvelope?: boolean }; where: { id?: { gt: string } } }) => {
        if (!q.select.protectedEnvelope) return [];
        assert.equal(q.take, 25);
        if (pages) assert.equal(q.where.id?.gt, "waiting-" + (pages * 25 - 1));
        const start = pages++ * 25;
        return Array.from({ length: 25 }, (_, index) => ({ id: "waiting-" + (start + index), protectedEnvelope: "never-return-this" }));
      },
    },
  };
  const previous = process.env.PLATFORM_COMPANY_ID;
  process.env.PLATFORM_COMPANY_ID = actor.companyId;
  try {
    const r = await service.getOpenCreditMaterializationPreflight({ $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } as never,
      { actor, companyId: "company", providerScope: scope });
    const q = r.integrations[0].queue;
    assert.equal(pages, 8);
    assert.equal(q.pendingTotal, 201);
    assert.equal(q.readiness.evaluated, 200);
    assert.equal(q.readiness.waitingIdentity, 200);
    assert.equal(q.readiness.complete, false);
    assert.equal(q.readiness.nextCursor, "waiting-199");
    assert.equal(q.claimableNow, 0);
    assert(!JSON.stringify(r).includes("never-return-this"));
  } finally {
    if (previous === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = previous;
  }
});
