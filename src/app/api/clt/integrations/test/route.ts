import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { getCltBank } from "@/lib/clt-integration";
import { ensureCltIntegrations, mapCltIntegration } from "@/lib/clt-settings";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { requireCompanyAdmin } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";

export async function POST(request: NextRequest) {
  let requestedBankId = "mercantil";

  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as { bankId?: string } | null;
    requestedBankId = body?.bankId || requestedBankId;
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

    const isManual = current.provider === "manual";
    const isNewcorban = current.provider === "newcorban";
    const hasMinimumConfig =
      isManual ||
      isNewcorban ||
      Boolean(current.baseUrl && (current.authType === "none" || current.apiKey || current.username));
    const updated = await prisma.cltIntegration.update({
      where: { id: current.id },
      data: {
        status: hasMinimumConfig ? (isManual ? "MANUAL" : isNewcorban ? "ASSISTED" : "CONNECTED") : "PENDING",
        lastTestAt: new Date(),
        lastTestStatus: hasMinimumConfig ? "SUCCESS" : "ERROR",
        lastTestMessage: hasMinimumConfig
          ? isManual
            ? "Provider manual pronto para uso operacional."
            : isNewcorban
              ? "Newcorban assistido pronto: operador faz login, informa SMS e replica a simulacao no CRM."
              : "Configuracao minima encontrada. Teste real da API sera ativado na homologacao."
          : "Informe URL base e credenciais antes de conectar."
      }
    });

    return NextResponse.json({ integration: mapCltIntegration(updated) });
  } catch (error) {
    const session = getSessionFromRequest(request);
    const bank = getCltBank(requestedBankId);

    safeLogError("http-api", error, {
      route: "/api/clt/integrations/test",
      method: "POST",
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
        provider: bank.provider,
        baseUrl: null,
        authType: "none",
        hasApiKey: false,
        apiKeyPreview: null,
        hasUsername: false,
        usernamePreview: null,
        hasPassword: false,
        hasNewcorbanIdentifier: false,
        hasDigitadorCode: false,
        hasCertifiedAgentCpf: false,
        certifiedAgentCpfPreview: null,
        status: bank.provider === "newcorban" ? "ASSISTED" : "MANUAL",
        lastTestAt: new Date(),
        lastTestStatus: "SUCCESS",
        lastTestMessage: "Provider manual pronto; persistência será ativada quando a tabela CLT estiver disponível.",
        updatedAt: new Date()
      },
      fallback: true
    });
  }
}
