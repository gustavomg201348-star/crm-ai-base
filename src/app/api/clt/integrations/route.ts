import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { cltBanks } from "@/lib/clt-integration";
import {
  ensureCltIntegrations,
  mapCltIntegration,
  resolveSensitivePasswordUpdate,
  resolveSensitiveTextUpdate
} from "@/lib/clt-settings";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { requireCompanyAdmin } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";

type IntegrationPayload = {
  bankId?: string;
  provider?: string;
  baseUrl?: string;
  authType?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  newcorbanIdentifier?: string;
  digitadorCode?: string;
  certifiedAgentCpf?: string;
  actingUf?: string;
  status?: string;
};

function fallbackIntegrations() {
  return cltBanks.map((bank) => ({
    id: bank.id,
    bankId: bank.id,
    bankName: bank.name,
    provider: bank.provider,
    baseUrl: bank.provider === "newcorban" ? "https://viva.newcorban.com.br" : null,
    authType: bank.provider === "newcorban" ? "login-sms" : "none",
    hasApiKey: false,
    apiKeyPreview: null,
    hasUsername: false,
    usernamePreview: null,
    hasPassword: false,
    hasNewcorbanIdentifier: false,
    hasDigitadorCode: false,
    hasCertifiedAgentCpf: false,
    certifiedAgentCpfPreview: null,
    actingUf: null,
    smsStatus: null,
    smsRequestedAt: null,
    status:
      bank.provider === "manual" ? "MANUAL" : bank.provider === "newcorban" ? "ASSISTED" : "PENDING",
    lastTestAt: null,
    lastTestStatus: null,
    lastTestMessage: "Tabela de integrações aguardando provisionamento.",
    updatedAt: new Date()
  }));
}

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }

    const integrations = await ensureCltIntegrations(session.companyId);

    return NextResponse.json({
      integrations: integrations.map((integration) => mapCltIntegration(integration, session.role))
    });
  } catch (error) {
    const session = getSessionFromRequest(request);

    safeLogError("http-api", error, {
      route: "/api/clt/integrations",
      method: "GET",
      companyId: session?.companyId,
      currentUserId: session?.id,
      publicErrorCode: "CLT_PROVIDER_UNAVAILABLE",
      status: 200,
      fallback: true
    });

    return NextResponse.json({ integrations: fallbackIntegrations(), fallback: true });
  }
}

export async function PATCH(request: NextRequest) {
  let fallbackBody: IntegrationPayload | null = null;

  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as IntegrationPayload | null;
    fallbackBody = body;

    if (!body?.bankId) {
      return publicErrorResponse({ code: "CLT_INVALID_REQUEST", status: 400 });
    }

    await ensureCltIntegrations(session.companyId);

    const current = await prisma.cltIntegration.findUnique({
      where: { companyId_bankId: { companyId: session.companyId, bankId: body.bankId } }
    });

    if (!current) {
      return publicErrorResponse({ code: "NOT_FOUND", status: 404 });
    }

    const updated = await prisma.cltIntegration.update({
      where: { id: current.id },
      data: {
        provider: body.provider || current.provider,
        baseUrl:
          body.baseUrl?.trim() ||
          (body.provider === "newcorban" || current.provider === "newcorban"
            ? "https://viva.newcorban.com.br"
            : null),
        authType: body.authType || current.authType,
        apiKey: resolveSensitiveTextUpdate(current.apiKey, body.apiKey),
        username: resolveSensitiveTextUpdate(current.username, body.username),
        password: resolveSensitivePasswordUpdate(current.password, body.password),
        newcorbanIdentifier:
          resolveSensitiveTextUpdate(current.newcorbanIdentifier, body.newcorbanIdentifier),
        digitadorCode: resolveSensitiveTextUpdate(current.digitadorCode, body.digitadorCode),
        certifiedAgentCpf: resolveSensitiveTextUpdate(current.certifiedAgentCpf, body.certifiedAgentCpf),
        actingUf:
          body.actingUf === undefined ? current.actingUf : body.actingUf.trim().toUpperCase() || null,
        status: body.status || (body.provider === "newcorban" ? "ASSISTED" : current.status)
      }
    });

    return NextResponse.json({ integration: mapCltIntegration(updated) });
  } catch (error) {
    const session = getSessionFromRequest(request);
    const bank = cltBanks.find((item) => item.id === fallbackBody?.bankId) ?? cltBanks[0];

    safeLogError("http-api", error, {
      route: "/api/clt/integrations",
      method: "PATCH",
      companyId: session?.companyId,
      currentUserId: session?.id,
      publicErrorCode: "CLT_PROVIDER_UNAVAILABLE",
      status: 200,
      fallback: true,
      providerCode: bank.provider
    });

    return NextResponse.json({
      integration: {
        id: bank.id,
        bankId: bank.id,
        bankName: bank.name,
        provider: fallbackBody?.provider || bank.provider,
        baseUrl:
          fallbackBody?.baseUrl ||
          (fallbackBody?.provider === "newcorban" || bank.provider === "newcorban"
            ? "https://viva.newcorban.com.br"
            : null),
        authType:
          fallbackBody?.authType ||
          (fallbackBody?.provider === "newcorban" || bank.provider === "newcorban"
            ? "login-sms"
            : "none"),
        hasApiKey: Boolean(fallbackBody?.apiKey),
        apiKeyPreview: fallbackBody?.apiKey ? "****" : null,
        hasUsername: Boolean(fallbackBody?.username),
        usernamePreview: fallbackBody?.username ? "****" : null,
        hasPassword: Boolean(fallbackBody?.password),
        hasNewcorbanIdentifier: Boolean(fallbackBody?.newcorbanIdentifier),
        hasDigitadorCode: Boolean(fallbackBody?.digitadorCode),
        hasCertifiedAgentCpf: Boolean(fallbackBody?.certifiedAgentCpf),
        certifiedAgentCpfPreview: fallbackBody?.certifiedAgentCpf ? "****" : null,
        actingUf: fallbackBody?.actingUf || null,
        smsStatus: null,
        smsRequestedAt: null,
        status:
          fallbackBody?.status ||
          (fallbackBody?.provider === "newcorban" || bank.provider === "newcorban"
            ? "ASSISTED"
            : "MANUAL"),
        lastTestAt: null,
        lastTestStatus: null,
        lastTestMessage: "Configuração recebida em modo temporário.",
        updatedAt: new Date()
      },
      fallback: true
    });
  }
}
