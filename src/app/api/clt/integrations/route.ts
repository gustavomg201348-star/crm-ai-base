import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { cltBanks } from "@/lib/clt-integration";
import { ensureCltIntegrations, mapCltIntegration } from "@/lib/clt-settings";
import { prisma } from "@/lib/db";
import { requireCompanyAdmin } from "@/lib/permissions";

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
    username: null,
    hasPassword: false,
    newcorbanIdentifier: null,
    digitadorCode: null,
    certifiedAgentCpf: null,
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
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const integrations = await ensureCltIntegrations(session.companyId);

    return NextResponse.json({
      integrations: integrations.map((integration) => mapCltIntegration(integration, session.role))
    });
  } catch {
    return NextResponse.json({ integrations: fallbackIntegrations(), fallback: true });
  }
}

export async function PATCH(request: NextRequest) {
  let fallbackBody: IntegrationPayload | null = null;

  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as IntegrationPayload | null;
    fallbackBody = body;

    if (!body?.bankId) {
      return NextResponse.json({ error: "Banco obrigatorio." }, { status: 400 });
    }

    await ensureCltIntegrations(session.companyId);

    const current = await prisma.cltIntegration.findUnique({
      where: { companyId_bankId: { companyId: session.companyId, bankId: body.bankId } }
    });

    if (!current) {
      return NextResponse.json({ error: "Integracao nao encontrada." }, { status: 404 });
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
        apiKey: body.apiKey === undefined ? current.apiKey : body.apiKey.trim() || null,
        username: body.username === undefined ? current.username : body.username.trim() || null,
        password: body.password === undefined ? current.password : body.password || null,
        newcorbanIdentifier:
          body.newcorbanIdentifier === undefined
            ? current.newcorbanIdentifier
            : body.newcorbanIdentifier.trim() || null,
        digitadorCode:
          body.digitadorCode === undefined ? current.digitadorCode : body.digitadorCode.trim() || null,
        certifiedAgentCpf:
          body.certifiedAgentCpf === undefined
            ? current.certifiedAgentCpf
            : body.certifiedAgentCpf.trim() || null,
        actingUf:
          body.actingUf === undefined ? current.actingUf : body.actingUf.trim().toUpperCase() || null,
        status: body.status || (body.provider === "newcorban" ? "ASSISTED" : current.status)
      }
    });

    return NextResponse.json({ integration: mapCltIntegration(updated) });
  } catch {
    const bank = cltBanks.find((item) => item.id === fallbackBody?.bankId) ?? cltBanks[0];

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
        username: fallbackBody?.username || null,
        hasPassword: Boolean(fallbackBody?.password),
        newcorbanIdentifier: fallbackBody?.newcorbanIdentifier || null,
        digitadorCode: fallbackBody?.digitadorCode || null,
        certifiedAgentCpf: fallbackBody?.certifiedAgentCpf || null,
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
