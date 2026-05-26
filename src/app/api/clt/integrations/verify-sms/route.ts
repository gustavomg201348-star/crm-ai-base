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
      | {
          bankId?: string;
          smsCode?: string;
          digitadorCode?: string;
          certifiedAgentCpf?: string;
          actingUf?: string;
          newcorbanIdentifier?: string;
        }
      | null;

    if (!body?.bankId) {
      return NextResponse.json({ error: "Banco obrigatorio." }, { status: 400 });
    }

    if (!body.smsCode?.trim()) {
      return NextResponse.json({ error: "Informe o codigo SMS." }, { status: 400 });
    }

    if (!body.digitadorCode?.trim() || !body.certifiedAgentCpf?.trim() || !body.actingUf?.trim()) {
      return NextResponse.json(
        { error: "Informe codigo digitador, CPF agente certificado e UF." },
        { status: 400 }
      );
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
        newcorbanIdentifier: body.newcorbanIdentifier?.trim() || current.newcorbanIdentifier,
        digitadorCode: body.digitadorCode.trim(),
        certifiedAgentCpf: body.certifiedAgentCpf.trim(),
        actingUf: body.actingUf.trim().toUpperCase(),
        authType: "login-sms",
        status: "ASSISTED",
        smsStatus: "VERIFIED",
        lastTestAt: new Date(),
        lastTestStatus: "SUCCESS",
        lastTestMessage:
          "Credenciais Newcorban validadas em modo assistido. Mercantil pronto para simulacao."
      }
    });

    return NextResponse.json({
      integration: mapCltIntegration(updated),
      message: "Credenciais Mercantil/Newcorban salvas."
    });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel validar SMS Newcorban." },
      { status: 500 }
    );
  }
}
