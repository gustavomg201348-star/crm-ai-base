import { cltBanks } from "@/lib/clt-integration";
import { prisma } from "@/lib/db";

type CltIntegrationViewerRole = "ADMIN" | "SUPERVISOR" | "AGENT";

async function ensureCltSchema() {
  if ((process.env.DATABASE_URL || "").startsWith("file:")) {
    return;
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CltIntegration" (
      "id" TEXT NOT NULL,
      "companyId" TEXT NOT NULL,
      "bankId" TEXT NOT NULL,
      "bankName" TEXT NOT NULL,
      "provider" TEXT NOT NULL DEFAULT 'manual',
      "baseUrl" TEXT,
      "authType" TEXT NOT NULL DEFAULT 'none',
      "apiKey" TEXT,
      "username" TEXT,
      "password" TEXT,
      "newcorbanIdentifier" TEXT,
      "digitadorCode" TEXT,
      "certifiedAgentCpf" TEXT,
      "actingUf" TEXT,
      "smsStatus" TEXT,
      "smsRequestedAt" TIMESTAMP(3),
      "status" TEXT NOT NULL DEFAULT 'MANUAL',
      "lastTestAt" TIMESTAMP(3),
      "lastTestStatus" TEXT,
      "lastTestMessage" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CltIntegration_pkey" PRIMARY KEY ("id")
    );
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CltIntegration"
      ADD COLUMN IF NOT EXISTS "newcorbanIdentifier" TEXT,
      ADD COLUMN IF NOT EXISTS "digitadorCode" TEXT,
      ADD COLUMN IF NOT EXISTS "certifiedAgentCpf" TEXT,
      ADD COLUMN IF NOT EXISTS "actingUf" TEXT,
      ADD COLUMN IF NOT EXISTS "smsStatus" TEXT,
      ADD COLUMN IF NOT EXISTS "smsRequestedAt" TIMESTAMP(3);
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "CltIntegration_companyId_bankId_key"
      ON "CltIntegration" ("companyId", "bankId");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CltIntegration_companyId_idx" ON "CltIntegration" ("companyId");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CltIntegration_status_idx" ON "CltIntegration" ("status");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CltSimulationLog" (
      "id" TEXT NOT NULL,
      "companyId" TEXT NOT NULL,
      "userId" TEXT,
      "contactId" TEXT,
      "bankId" TEXT,
      "bankName" TEXT,
      "action" TEXT NOT NULL,
      "cpf" TEXT,
      "phone" TEXT,
      "status" TEXT NOT NULL DEFAULT 'SUCCESS',
      "message" TEXT,
      "inputJson" TEXT,
      "outputJson" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CltSimulationLog_pkey" PRIMARY KEY ("id")
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CltSimulationLog_companyId_createdAt_idx"
      ON "CltSimulationLog" ("companyId", "createdAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CltSimulationLog_userId_idx" ON "CltSimulationLog" ("userId");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CltSimulationLog_contactId_idx" ON "CltSimulationLog" ("contactId");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CltSimulationLog_bankId_idx" ON "CltSimulationLog" ("bankId");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CltSimulationLog_status_idx" ON "CltSimulationLog" ("status");
  `);
}

export async function ensureCltIntegrations(companyId: string) {
  await ensureCltSchema();

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
            baseUrl: bank.provider === "newcorban" ? "https://viva.newcorban.com.br" : null,
            authType: bank.provider === "newcorban" ? "login-sms" : "none",
            status:
              bank.provider === "manual" ? "MANUAL" : bank.provider === "newcorban" ? "ASSISTED" : "PENDING"
          }
        })
      )
    );
  }

  await Promise.all(
    cltBanks
      .filter((bank) => bank.provider === "newcorban")
      .map((bank) =>
        prisma.cltIntegration.updateMany({
          where: { companyId, bankId: bank.id, provider: { not: "newcorban" } },
          data: {
            provider: "newcorban",
            baseUrl: "https://viva.newcorban.com.br",
            authType: "login-sms",
            status: "ASSISTED",
            lastTestMessage: "Fluxo assistido: login no Newcorban com validacao por SMS."
          }
        })
      )
  );

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

export function maskCpfPreview(value?: string | null) {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length < 2) return null;
  return `***.***.***-${digits.slice(-2)}`;
}

export function resolveSensitiveTextUpdate(current: string | null, next?: string) {
  if (next === undefined) return current;
  const trimmed = next.trim();
  if (trimmed.includes("****")) return current;
  return trimmed || current;
}

export function resolveSensitivePasswordUpdate(current: string | null, next?: string) {
  if (next === undefined) return current;
  if (next.includes("****")) return current;
  return next.trim() ? next : current;
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
  newcorbanIdentifier?: string | null;
  digitadorCode?: string | null;
  certifiedAgentCpf?: string | null;
  actingUf?: string | null;
  smsStatus?: string | null;
  smsRequestedAt?: Date | null;
  status: string;
  lastTestAt?: Date | null;
  lastTestStatus?: string | null;
  lastTestMessage?: string | null;
  updatedAt: Date;
}, viewerRole: CltIntegrationViewerRole = "ADMIN") {
  const shouldMaskSensitiveFields = viewerRole === "AGENT";
  const showSensitivePreviews = !shouldMaskSensitiveFields;

  return {
    id: integration.id,
    bankId: integration.bankId,
    bankName: integration.bankName,
    provider: integration.provider,
    baseUrl: integration.baseUrl,
    authType: integration.authType,
    hasApiKey: Boolean(integration.apiKey),
    apiKeyPreview: shouldMaskSensitiveFields ? null : maskSecret(integration.apiKey),
    hasUsername: Boolean(integration.username),
    usernamePreview: showSensitivePreviews ? maskSecret(integration.username) : null,
    hasPassword: Boolean(integration.password),
    hasNewcorbanIdentifier: Boolean(integration.newcorbanIdentifier),
    hasDigitadorCode: Boolean(integration.digitadorCode),
    hasCertifiedAgentCpf: Boolean(integration.certifiedAgentCpf),
    certifiedAgentCpfPreview: showSensitivePreviews ? maskCpfPreview(integration.certifiedAgentCpf) : null,
    actingUf: integration.actingUf,
    smsStatus: integration.smsStatus,
    smsRequestedAt: integration.smsRequestedAt,
    status: integration.status,
    lastTestAt: integration.lastTestAt,
    lastTestStatus: integration.lastTestStatus,
    lastTestMessage: integration.lastTestMessage,
    updatedAt: integration.updatedAt
  };
}
