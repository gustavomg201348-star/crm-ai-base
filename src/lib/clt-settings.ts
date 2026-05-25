import { cltBanks } from "@/lib/clt-integration";
import { prisma } from "@/lib/db";

export async function ensureCltIntegrations(companyId: string) {
  const existing = await prisma.cltIntegration.findMany({
    where: { companyId }
  });
  const existingIds = new Set(existing.map((item) => item.bankId));
  const missingBanks = cltBanks.filter((bank) => !existingIds.has(bank.id));

  if (missingBanks.length) {
    await Promise.all(
      missingBanks.map((bank) =>
        prisma.cltIntegration.upsert({
          where: { companyId_bankId: { companyId, bankId: bank.id } },
          update: {},
          create: {
            companyId,
            bankId: bank.id,
            bankName: bank.name,
            provider: bank.provider,
            status: bank.provider === "manual" ? "MANUAL" : "PENDING"
          }
        })
      )
    );
  }

  return prisma.cltIntegration.findMany({
    where: { companyId },
    orderBy: { bankName: "asc" }
  });
}

export function maskSecret(value?: string | null) {
  if (!value) return null;
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}

export function mapCltIntegration(integration: {
  id: string;
  bankId: string;
  bankName: string;
  provider: string;
  baseUrl?: string | null;
  authType: string;
  apiKey?: string | null;
  username?: string | null;
  password?: string | null;
  status: string;
  lastTestAt?: Date | null;
  lastTestStatus?: string | null;
  lastTestMessage?: string | null;
  updatedAt: Date;
}) {
  return {
    id: integration.id,
    bankId: integration.bankId,
    bankName: integration.bankName,
    provider: integration.provider,
    baseUrl: integration.baseUrl,
    authType: integration.authType,
    hasApiKey: Boolean(integration.apiKey),
    apiKeyPreview: maskSecret(integration.apiKey),
    username: integration.username,
    hasPassword: Boolean(integration.password),
    status: integration.status,
    lastTestAt: integration.lastTestAt,
    lastTestStatus: integration.lastTestStatus,
    lastTestMessage: integration.lastTestMessage,
    updatedAt: integration.updatedAt
  };
}
