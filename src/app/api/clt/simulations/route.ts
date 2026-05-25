import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { createCltLog } from "@/lib/clt-logs";
import {
  getCltBank,
  isValidCpfShape,
  simulateClt,
  type CltSimulationInput
} from "@/lib/clt-integration";

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as CltSimulationInput | null;

    if (!body?.cpf || !isValidCpfShape(body.cpf)) {
      return NextResponse.json({ error: "Informe um CPF valido." }, { status: 400 });
    }

    if (!body.bankId) {
      return NextResponse.json({ error: "Banco obrigatorio." }, { status: 400 });
    }

    const bank = getCltBank(body.bankId);
    const offers = simulateClt(body);
    await createCltLog({
      companyId: session.companyId,
      userId: session.id,
      bankId: bank.id,
      bankName: bank.name,
      action: "SIMULATION",
      cpf: body.cpf,
      phone: body.phone,
      message: `Simulacao CLT gerada com ${offers.length} oferta(s).`,
      input: body,
      output: offers.map((offer) => ({
        tableCode: offer.tableCode,
        releasedAmount: offer.releasedAmount,
        installmentAmount: offer.installmentAmount
      }))
    });

    return NextResponse.json({
      provider: bank.provider,
      offers
    });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel simular CLT." },
      { status: 500 }
    );
  }
}
