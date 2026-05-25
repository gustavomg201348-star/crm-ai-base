import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { cltBanks } from "@/lib/clt-integration";
import { ensureCltIntegrations, mapCltIntegration } from "@/lib/clt-settings";
import { prisma } from "@/lib/db";

type IntegrationPayload = {
  bankId?: string;
  provider?: string;
  baseUrl?: string;
  authType?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  status?: string;
};

function fallbackIntegrations() {
  return cltBanks.map((bank) => ({
    id: bank.id,
    bankId: bank.id,
    bankName: bank.name,
    provider: bank.provider,
    baseUrl: null,
    authType: "none",
    hasApiKey: false,
    apiKeyPreview: null,
    username: null,
    hasPassword: false,
    status: bank.provider === "manual" ? "MANUAL" : "PENDING",
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
      integrations: integrations.map(mapCltIntegration)
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
        baseUrl: body.baseUrl?.trim() || null,
        authType: body.authType || current.authType,
        apiKey: body.apiKey === undefined ? current.apiKey : body.apiKey.trim() || null,
        username: body.username === undefined ? current.username : body.username.trim() || null,
        password: body.password === undefined ? current.password : body.password || null,
        status: body.status || current.status
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
        baseUrl: fallbackBody?.baseUrl || null,
        authType: fallbackBody?.authType || "none",
        hasApiKey: Boolean(fallbackBody?.apiKey),
        apiKeyPreview: fallbackBody?.apiKey ? "****" : null,
        username: fallbackBody?.username || null,
        hasPassword: Boolean(fallbackBody?.password),
        status: fallbackBody?.status || "MANUAL",
        lastTestAt: null,
        lastTestStatus: null,
        lastTestMessage: "Configuração recebida em modo temporário.",
        updatedAt: new Date()
      },
      fallback: true
    });
  }
}
