import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { ensureCltIntegrations, mapCltIntegration } from "@/lib/clt-settings";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | { bankId?: string; username?: string; password?: string }
      | null;

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

    if (current.provider !== "newcorban") {
      return NextResponse.json(
        { error: "Autenticacao assistida disponivel apenas para Newcorban." },
        { status: 400 }
      );
    }

    const username = body.username?.trim() || current.username?.trim();
    const password = body.password || current.password;

    if (!username || !password) {
      return NextResponse.json(
        { error: "Informe usuario e senha para entrar no perfil." },
        { status: 400 }
      );
    }

    const updated = await prisma.cltIntegration.update({
      where: { id: current.id },
      data: {
        username,
        password,
        authType: "login-sms",
        status: "SMS_PENDING",
        smsStatus: "SMS_SENT",
        smsRequestedAt: new Date(),
        lastTestAt: new Date(),
        lastTestStatus: "PENDING",
        lastTestMessage:
          "SMS solicitado no fluxo assistido. Informe o codigo recebido para liberar as credenciais."
      }
    });

    return NextResponse.json({
      integration: mapCltIntegration(updated),
      message: "SMS solicitado. Informe o codigo recebido para concluir a autenticacao."
    });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel iniciar autenticacao Newcorban." },
      { status: 500 }
    );
  }
}
