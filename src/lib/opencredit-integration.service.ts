import { Prisma, type OpenCreditIntegration, type PrismaClient } from "@prisma/client";
import type { SecretEncryptionOptions } from "./secret-encryption";
import { createOpenCreditPublicWebhookId, createOpenCreditWebhookSecret, prepareOpenCreditWebhookSecret, resolveOpenCreditWebhookSecret } from "./opencredit-secrets";

export type OpenCreditStatus = "ACTIVE" | "PAUSED" | "DISABLED";
export type SafeOpenCreditIntegration = {
  id: string; publicWebhookId: string; enabled: boolean; status: OpenCreditStatus;
  createdAt: string; updatedAt: string; hasWebhookSecret: boolean; webhookPath: string;
};

function statusOf(row: Pick<OpenCreditIntegration, "enabled" | "paused">): OpenCreditStatus {
  if (!row.enabled) return "DISABLED";
  return row.paused ? "PAUSED" : "ACTIVE";
}

export function mapOpenCreditIntegration(row: OpenCreditIntegration): SafeOpenCreditIntegration {
  return {
    id: row.id, publicWebhookId: row.publicWebhookId, enabled: row.enabled, status: statusOf(row),
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

type Db = Pick<PrismaClient, "$transaction" | "openCreditIntegration" | "openCreditLead">;
type IntegrationDelegate = Pick<PrismaClient["openCreditIntegration"], "update">;

export function createOpenCreditIntegrationService(db: Db, encryption?: SecretEncryptionOptions | null) {
  const encrypt = (secret: string) => prepareOpenCreditWebhookSecret(secret, encryption);
  const find = async (companyId: string, id: string) => {
    const row = await db.openCreditIntegration.findFirst({ where: { id, companyId } });
    if (!row) throw new OpenCreditConfigurationError("NOT_FOUND", 404);
    return row;
  };
  const change = async (delegate: IntegrationDelegate, row: OpenCreditIntegration,
    data: { enabled?: boolean; paused?: boolean; webhookSecret?: string }) => {
    try {
      return await delegate.update({
        where: { id: row.id, companyId: row.companyId, updatedAt: row.updatedAt,
          enabled: row.enabled, paused: row.paused, webhookSecret: row.webhookSecret }, data
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new OpenCreditConfigurationError("CONFLICT", 409);
      }
      throw error;
    }
  };

  async function setStatus(companyId: string, id: string, status: OpenCreditStatus) {
    const row = await find(companyId, id);
    if (status !== "DISABLED") resolveOpenCreditWebhookSecret(row.webhookSecret, encryption);
    const data = { enabled: status !== "DISABLED", paused: status === "PAUSED" };
    if (status === "ACTIVE") {
      const changed = await db.$transaction(async tx => {
        const integration = await change(tx.openCreditIntegration, row, data);
        await tx.openCreditLead.updateMany({
          where: { companyId, integrationId: id, held: true },
          data: { held: false }
        });
        return integration;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return { integration: mapOpenCreditIntegration(changed) };
    }
    return { integration: mapOpenCreditIntegration(await change(db.openCreditIntegration, row, data)) };
  }

  return {
    async list(companyId: string) {
      const rows = await db.openCreditIntegration.findMany({ where: { companyId }, orderBy: { createdAt: "desc" } });
      return rows.map(mapOpenCreditIntegration);
    },
    async create(companyId: string) {
      const setupSecret = createOpenCreditWebhookSecret();
      const webhookSecret = encrypt(setupSecret);
      const row = await db.openCreditIntegration.create({ data: {
        companyId, publicWebhookId: createOpenCreditPublicWebhookId(), webhookSecret,
        enabled: false, paused: false
      } });
      return { integration: mapOpenCreditIntegration(row), setupSecret };
    },
    setStatus,
    async setEnabled(companyId: string, id: string, enabled: boolean) {
      return setStatus(companyId, id, enabled ? "ACTIVE" : "DISABLED");
    },
    async rotate(companyId: string, id: string) {
      const row = await find(companyId, id);
      const setupSecret = createOpenCreditWebhookSecret();
      const webhookSecret = encrypt(setupSecret);
      const integration = await change(db.openCreditIntegration, row, {
        webhookSecret, enabled: false, paused: false
      });
      return { integration: mapOpenCreditIntegration(integration), setupSecret };
    }
  };
}
