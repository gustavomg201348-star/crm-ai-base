import { cltBanks } from "@/lib/clt-integration";
import {
  resolveCltApiKey,
  resolveCltCertifiedAgentCpf,
  resolveCltDigitadorCode,
  resolveCltNewcorbanIdentifier,
  resolveCltPassword,
  resolveCltUsername
} from "@/lib/clt-secrets";
import { prisma } from "@/lib/db";

type CltIntegrationViewerRole = "ADMIN" | "SUPERVISOR" | "AGENT";

export async function listCltIntegrations(companyId: string) {
  return prisma.cltIntegration.findMany({
    where: { companyId },
    orderBy: { bankName: "asc" }
  });
}

export async function provisionCltIntegrations(companyId: string) {
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

  return listCltIntegrations(companyId);
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

export function resolveCltIntegrationSecrets(integration: {
  apiKey?: string | null;
  username?: string | null;
  password?: string | null;
  newcorbanIdentifier?: string | null;
  digitadorCode?: string | null;
  certifiedAgentCpf?: string | null;
}) {
  return {
    apiKey: resolveCltApiKey(integration.apiKey),
    username: resolveCltUsername(integration.username),
    password: resolveCltPassword(integration.password),
    newcorbanIdentifier: resolveCltNewcorbanIdentifier(integration.newcorbanIdentifier),
    digitadorCode: resolveCltDigitadorCode(integration.digitadorCode),
    certifiedAgentCpf: resolveCltCertifiedAgentCpf(integration.certifiedAgentCpf)
  };
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
  const resolvedSecrets = resolveCltIntegrationSecrets(integration);

  return {
    id: integration.id,
    bankId: integration.bankId,
    bankName: integration.bankName,
    provider: integration.provider,
    baseUrl: integration.baseUrl,
    authType: integration.authType,
    hasApiKey: Boolean(resolvedSecrets.apiKey),
    apiKeyPreview: shouldMaskSensitiveFields ? null : maskSecret(resolvedSecrets.apiKey),
    hasUsername: Boolean(resolvedSecrets.username),
    usernamePreview: showSensitivePreviews ? maskSecret(resolvedSecrets.username) : null,
    hasPassword: Boolean(resolvedSecrets.password),
    hasNewcorbanIdentifier: Boolean(resolvedSecrets.newcorbanIdentifier),
    hasDigitadorCode: Boolean(resolvedSecrets.digitadorCode),
    hasCertifiedAgentCpf: Boolean(resolvedSecrets.certifiedAgentCpf),
    certifiedAgentCpfPreview: showSensitivePreviews ? maskCpfPreview(resolvedSecrets.certifiedAgentCpf) : null,
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
