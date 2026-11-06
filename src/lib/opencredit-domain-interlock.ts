import type { Prisma } from "@prisma/client";

export type OpenCreditDomainMode = "LEGACY" | "MATERIALIZATION";

export class OpenCreditDomainModeUnavailableError extends Error {
  constructor() {
    super("OPENCREDIT_DOMAIN_MODE_UNAVAILABLE");
  }
}

export async function lockOpenCreditDomainMode(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  { companyId, integrationId, expectedMode }: {
    companyId: string;
    integrationId: string;
    expectedMode: OpenCreditDomainMode;
  }
): Promise<{ paused: boolean }> {
  const [row] = await tx.$queryRaw<Array<{ enabled: boolean; materializationEnabled: boolean; paused: boolean }>>`
    SELECT "enabled", "materializationEnabled", "paused"
    FROM "OpenCreditIntegration"
    WHERE "companyId" = ${companyId} AND "id" = ${integrationId}
    FOR UPDATE
  `;
  if (row && (
    (expectedMode === "LEGACY" && row.enabled && !row.materializationEnabled) ||
    (expectedMode === "MATERIALIZATION" && !row.enabled && row.materializationEnabled)
  )) return { paused: row.paused };
  throw new OpenCreditDomainModeUnavailableError();
}
