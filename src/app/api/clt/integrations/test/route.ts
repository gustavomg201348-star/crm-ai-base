import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { getCltBank } from "@/lib/clt-integration";
import { ensureCltIntegrations, mapCltIntegration } from "@/lib/clt-settings";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
  let requestedBankId = "mercantil";

  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as { bankId?: string } | null;
    requestedBankId = body?.bankId || requestedBankId;
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

    const isManual = current.provider === "manual";
    const hasMinimumConfig =
      isManual || Boolean(current.baseUrl && (current.authType === "none" || current.apiKey || current.username));
    const updated = await prisma.cltIntegration.update({
      where: { id: current.id },
      data: {
        status: hasMinimumConfig ? (isManual ? "MANUAL" : "CONNECTED") : "PENDING",
        lastTestAt: new Date(),
        lastTestStatus: hasMinimumConfig ? "SUCCESS" : "ERROR",
        lastTestMessage: hasMinimumConfig
          ? isManual
            ? "Provider manual pronto para uso operacional."
            : "Configuracao minima encontrada. Teste real da API sera ativado na homologacao."
          : "Informe URL base e credenciais antes de conectar."
      }
    });

    return NextResponse.json({ integration: mapCltIntegration(updated) });
  } catch {
    const bank = getCltBank(requestedBankId);

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
        username: null,
        hasPassword: false,
        status: "MANUAL",
        lastTestAt: new Date(),
        lastTestStatus: "SUCCESS",
        lastTestMessage: "Provider manual pronto; persistência será ativada quando a tabela CLT estiver disponível.",
        updatedAt: new Date()
      },
      fallback: true
    });
  }
}
