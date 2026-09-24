import assert from "node:assert/strict";
import test from "node:test";
import { createTenantWithAdmin } from "@/lib/company-tenant.service";
import { prisma } from "@/lib/db";

type AsyncMethod = (...args: any[]) => Promise<any>;

function createTransactionDouble({ failCltProvisioning = false } = {}) {
  const calls: Array<{ model: string; args: unknown }> = [];
  const integrations = new Map<string, Record<string, unknown>>();

  const record = (model: string, result: unknown): AsyncMethod => async (args) => {
    calls.push({ model, args });
    return result;
  };

  const tx = {
    company: {
      create: record("company.create", {
        id: "company-new",
        name: "Nova Company",
        email: null,
        phone: null,
        segment: "Credito consignado",
        createdAt: new Date("2026-09-24T12:00:00.000Z")
      })
    },
    user: {
      create: record("user.create", {
        id: "admin-new",
        name: "Admin Teste",
        email: "admin-test@example.test",
        role: "ADMIN"
      })
    },
    userAvailability: { create: record("userAvailability.create", {}) },
    origin: { create: record("origin.create", {}) },
    pipelineStage: { create: record("pipelineStage.create", {}) },
    tag: { create: record("tag.create", {}) },
    channel: { create: record("channel.create", {}) },
    leadAssignmentSetting: { create: record("leadAssignmentSetting.create", {}) },
    cltIntegration: {
      findMany: async (args: unknown) => {
        calls.push({ model: "cltIntegration.findMany", args });
        return Array.from(integrations.values());
      },
      upsert: async (args: unknown) => {
        calls.push({ model: "cltIntegration.upsert", args });
        if (failCltProvisioning) throw new Error("simulated CLT provisioning failure");
        const create = (args as { create: Record<string, unknown> & { bankId: string } }).create;
        integrations.set(create.bankId, create);
        return create;
      },
      updateMany: async (args: unknown) => {
        calls.push({ model: "cltIntegration.updateMany", args });
        return { count: 0 };
      }
    }
  };

  return { tx, calls, integrations };
}

async function withTenantPrismaMock<T>(
  transaction: (callback: (tx: unknown) => Promise<unknown>) => Promise<unknown>,
  action: () => Promise<T>
) {
  const prismaDouble = prisma as unknown as {
    user: { findUnique: AsyncMethod };
    $transaction: AsyncMethod;
  };
  const originalFindUnique = prismaDouble.user.findUnique;
  const originalTransaction = prismaDouble.$transaction;
  prismaDouble.user.findUnique = async () => null;
  prismaDouble.$transaction = transaction;

  try {
    return await action();
  } finally {
    prismaDouble.user.findUnique = originalFindUnique;
    prismaDouble.$transaction = originalTransaction;
  }
}

const tenantInput = {
  companyName: "Nova Company",
  adminName: "Admin Teste",
  adminEmail: "admin-test@example.test",
  adminPassword: "safe-test-password"
};

test("createTenantWithAdmin provisions the canonical CLT catalog in the same transaction", async () => {
  const { tx, calls, integrations } = createTransactionDouble();
  let committed = false;

  const company = await withTenantPrismaMock(
    async (callback) => {
      const result = await callback(tx);
      committed = true;
      return result;
    },
    () => createTenantWithAdmin(tenantInput)
  );

  assert.equal(committed, true);
  assert.equal(company.id, "company-new");
  assert.equal(integrations.size, 4);
  assert.deepEqual(Array.from(integrations.keys()).sort(), ["3rn", "bmg", "c6-ficsa", "mercantil"]);

  const mercantil = integrations.get("mercantil");
  assert.deepEqual(mercantil, {
    companyId: "company-new",
    bankId: "mercantil",
    bankName: "Mercantil",
    provider: "newcorban",
    baseUrl: "https://viva.newcorban.com.br",
    authType: "login-sms",
    status: "ASSISTED"
  });

  for (const bankId of ["3rn", "bmg", "c6-ficsa"]) {
    const integration = integrations.get(bankId);
    assert.equal(integration?.companyId, "company-new");
    assert.equal(integration?.provider, "manual");
    assert.equal(integration?.authType, "none");
    assert.equal(integration?.status, "MANUAL");
    for (const secret of [
      "apiKey",
      "username",
      "password",
      "newcorbanIdentifier",
      "digitadorCode",
      "certifiedAgentCpf"
    ]) {
      assert.equal(secret in (integration ?? {}), false);
    }
  }

  assert.equal(calls.filter(({ model }) => model === "user.create").length, 1);
  assert.equal(calls.filter(({ model }) => model === "origin.create").length, 3);
  assert.equal(calls.filter(({ model }) => model === "pipelineStage.create").length, 3);
  assert.equal(calls.filter(({ model }) => model === "tag.create").length, 4);
  assert.equal(calls.filter(({ model }) => model === "channel.create").length, 1);
  assert.equal(calls.filter(({ model }) => model === "leadAssignmentSetting.create").length, 1);
});

test("createTenantWithAdmin rolls back the tenant when CLT provisioning fails", async () => {
  const { tx, calls } = createTransactionDouble({ failCltProvisioning: true });
  let committed = false;

  await assert.rejects(
    withTenantPrismaMock(
      async (callback) => {
        const result = await callback(tx);
        committed = true;
        return result;
      },
      () => createTenantWithAdmin(tenantInput)
    ),
    /simulated CLT provisioning failure/
  );

  assert.equal(committed, false);
  assert.equal(calls.some(({ model }) => model === "company.create"), true);
  assert.equal(calls.some(({ model }) => model === "cltIntegration.upsert"), true);
});
