import { Prisma, type OpenCreditIntegration, type PrismaClient } from "@prisma/client";
import type { SecretEncryptionOptions } from "./secret-encryption";
import { createOpenCreditPublicWebhookId, createOpenCreditWebhookSecret, prepareOpenCreditWebhookSecret, resolveOpenCreditWebhookSecret } from "./opencredit-secrets";

export type SafeOpenCreditIntegration = {
  id: string; publicWebhookId: string; enabled: boolean;
  createdAt: string; updatedAt: string; hasWebhookSecret: boolean; webhookPath: string;
};

export function mapOpenCreditIntegration(row: OpenCreditIntegration): SafeOpenCreditIntegration {
  return {
    id: row.id, publicWebhookId: row.publicWebhookId, enabled: row.enabled,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    hasWebhookSecret: Boolean(row.webhookSecret),
    webhookPath: `/api/integrations/opencredit/webhooks/${row.publicWebhookId}`
  };
}

export class OpenCreditConfigurationError extends Error {
  constructor(readonly code: "NOT_FOUND" | "CONFLICT" | "INVALID_REQUEST", readonly status: number) {
    super(code);
  }
}

type Db = Pick<PrismaClient, "openCreditIntegration">;
export function createOpenCreditIntegrationService(db: Db, encryption?: SecretEncryptionOptions | null) {
  const encrypt = (secret: string) => prepareOpenCreditWebhookSecret(secret, encryption);
  const find = async (companyId: string, id: string) => {
    const row = await db.openCreditIntegration.findFirst({ where: { id, companyId } });
    if (!row) throw new OpenCreditConfigurationError("NOT_FOUND", 404);
    return row;
  };
  const change = async (row: OpenCreditIntegration, data: { enabled: boolean; webhookSecret?: string }) => {
    // Tenant scope is on the write itself, not only on the preceding lookup.
    // A concurrent enable/rotation must conflict rather than silently re-enable.
    try {
      // Prisma 5 extended unique filters keep scope and optimistic guard on
      // the UPDATE and return its own row, without a separate post-write read.
      const changed = await db.openCreditIntegration.update({
        where: { id: row.id, companyId: row.companyId, updatedAt: row.updatedAt,
          enabled: row.enabled, webhookSecret: row.webhookSecret }, data
      });
      return mapOpenCreditIntegration(changed);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new OpenCreditConfigurationError("CONFLICT", 409);
      }
      throw error;
    }
  };
  return {
    async list(companyId: string) {
      const rows = await db.openCreditIntegration.findMany({ where: { companyId }, orderBy: { createdAt: "desc" } });
      return rows.map(mapOpenCreditIntegration);
    },
    async create(companyId: string) {
      const setupSecret = createOpenCreditWebhookSecret();
      const webhookSecret = encrypt(setupSecret); // Must succeed before any write.
      const row = await db.openCreditIntegration.create({ data: {
        companyId, publicWebhookId: createOpenCreditPublicWebhookId(), webhookSecret, enabled: false
      } });
      return { integration: mapOpenCreditIntegration(row), setupSecret };
    },
    async setEnabled(companyId: string, id: string, enabled: boolean) {
      const row = await find(companyId, id);
      if (enabled) resolveOpenCreditWebhookSecret(row.webhookSecret, encryption);
      return { integration: await change(row, { enabled }) };
    },
    async rotate(companyId: string, id: string) {
      const row = await find(companyId, id);
      const setupSecret = createOpenCreditWebhookSecret();
      const webhookSecret = encrypt(setupSecret);
      const integration = await change(row, { webhookSecret, enabled: false });
      return { integration, setupSecret };
    }
  };
}
