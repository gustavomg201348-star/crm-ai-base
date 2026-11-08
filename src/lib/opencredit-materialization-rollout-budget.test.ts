import assert from "node:assert/strict";
import { before, test } from "node:test";
import { createRequire } from "node:module";
import Module from "node:module";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { availableRolloutBudget, consumeRolloutAdmission, rolloutLeaseHash, validRolloutId } from "./opencredit-materialization-rollout-budget.service";
import type { SessionUser } from "./auth";

let admin: typeof import("./opencredit-materialization-rollout-admin.service");
let boundary: typeof import("./opencredit-materialization-rollout-admin-handler");
before(() => {
  const loader = Module as typeof Module & { _load(name: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (name, ...args) => name === "server-only" ? {} : name === "@/lib/db" ? { prisma: {} } : original.call(loader, name, ...args);
  try {
    const require = createRequire(import.meta.url);
    admin = require("./opencredit-materialization-rollout-admin.service");
    boundary = require("./opencredit-materialization-rollout-admin-handler");
  } finally { loader._load = original; }
});
test("absent/invalid/unavailable budget cannot fall back", async () => {
  let calls = 0;
  const db = { $queryRaw: async () => { calls++; return []; } };
  for (const id of ["", "bad id", "x\n", "x".repeat(129)]) {
    assert.equal(validRolloutId(id), false);
    assert.equal(await availableRolloutBudget(db as never, id), null);
  }
  assert.equal(calls, 0);
  assert.equal(await availableRolloutBudget(db as never, "budget"), null);
  await assert.rejects(availableRolloutBudget({ $queryRaw: async () => { throw Error("PRIVATE"); } } as never, "budget"));
});
test("budget query enforces state, expiry, binding counter and optional lock; ledger mismatch closes", async () => {
  let sql = "";
  const db = { $queryRaw: async (s: TemplateStringsArray, ...values: unknown[]) => {
    sql = Prisma.sql(s, ...values).sql;
    return [{ admittedCount: 1, ledgerCount: 0 }];
  } };
  assert.equal(await availableRolloutBudget(db as never, "budget", true), null);
  for (const fragment of ['b."state"=\'ACTIVE\'', '"expiresAt">', '"releasedAt" IS NULL', '"maxAdmitted" BETWEEN 1 AND 3', 'SKIP LOCKED']) assert(sql.includes(fragment));
});
test("admission stores only token hash and conditional count failure throws for transaction rollback", async () => {
  const actions: string[] = [];
  let data: unknown;
  const tx = { openCreditMaterializationRolloutAdmission: { create: async (q: unknown) => { data = q; actions.push("admission"); } },
    $queryRaw: async () => { actions.push("counter"); return []; } };
  await assert.rejects(consumeRolloutAdmission(tx as never, { id: "budget", admittedCount: 0 } as never,
    { id: "job", attempts: 1, leaseToken: "PRIVATE_TOKEN" }), /ROLLOUT_ADMISSION_ROLLBACK/);
  assert.deepEqual(actions, ["admission", "counter"]);
  assert(!JSON.stringify(data).includes("PRIVATE_TOKEN"));
  assert.equal(rolloutLeaseHash("PRIVATE_TOKEN").length, 64);
});
const create = { action: "CREATE", companyId: "company", integrationId: "integration", maxAdmitted: 3, expiresAt: "2030-01-01T00:00:00Z" };
test("admin command parser is closed and requires explicit reconciliation", () => {
  assert(admin.parseRolloutCommand(create));
  for (const v of [{ ...create, maxAdmitted: 0 }, { ...create, maxAdmitted: 4 }, { ...create, payload: "PRIVATE" },
    { ...create, expiresAt: "2030-02-30T00:00:00Z" }, { action: "RELEASE", companyId: "company", integrationId: "integration", rolloutId: "budget" }]) {
    assert.equal(admin.parseRolloutCommand(v), null);
  }
});
const actor: SessionUser = { id: "admin", companyId: "platform", email: "synthetic@example.invalid", name: "Synthetic", role: "ADMIN" };
function request(body: string, headers: Record<string, string> = {}) {
  return new NextRequest("https://crm.example/api/admin/integrations/opencredit/materialization/rollouts", {
    method: "POST", headers: { host: "crm.example", origin: "https://crm.example", "content-type": "application/json", ...headers }, body,
  });
}
test("admin HTTP boundary requires session, platform role, same-origin and strict bounded JSON", async () => {
  let calls = 0;
  const deps = {
    db: {} as never, getSession: async () => actor as SessionUser | null,
    requirePlatformAdmin: (a: SessionUser) => a.role === "ADMIN" ? null : new Response(null, { status: 403 }),
    enforceLimits: async () => null, resolveScope: () => "ocp-" + "a".repeat(64) as never,
    execute: async () => { calls++; return { rolloutId: "budget", state: "ACTIVE", maxAdmitted: 3, admittedCount: 0, releasedAt: null }; },
  };
  const handler = boundary.createOpenCreditMaterializationRolloutAdminHandler(deps);
  assert.equal((await handler(request(JSON.stringify(create)))).status, 200);
  for (const req of [request(JSON.stringify(create), { origin: "https://attacker.invalid" }),
    request(JSON.stringify(create), { authorization: "Bearer PRIVATE" }), request(JSON.stringify({ ...create, secret: "PRIVATE" })),
    request(" ".repeat(1025)), request('{"action":"CREATE","action":"CLOSE"}')]) {
    const response = await handler(req); assert(response.status >= 400); assert(!(await response.text()).includes("PRIVATE"));
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(calls, 1);
  deps.getSession = async () => null; assert.equal((await handler(request("{}"))).status, 401);
  deps.getSession = async () => ({ ...actor, role: "AGENT" }); assert.equal((await handler(request("{}"))).status, 403);
});
