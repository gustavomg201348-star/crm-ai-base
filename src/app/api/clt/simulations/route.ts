import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { createCltLog } from "@/lib/clt-logs";
import {
  getCltBank,
  isValidCpfShape,
  simulateClt,
  type CltSimulationInput
} from "@/lib/clt-integration";
import { publicErrorResponse } from "@/lib/http-error-response";
import { safeLogError } from "@/lib/safe-logger";

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }

    const body = (await request.json().catch(() => null)) as CltSimulationInput | null;

    if (!body?.cpf || !isValidCpfShape(body.cpf)) {
      return publicErrorResponse({ code: "CLT_INVALID_CPF", status: 400 });
    }

    if (!body.bankId) {
      return publicErrorResponse({ code: "CLT_INVALID_REQUEST", status: 400 });
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
      mode: bank.provider === "newcorban" ? "NEWCORBAN_ASSISTED" : "LOCAL",
      nextStep:
        bank.provider === "newcorban"
          ? "Validar a margem no Newcorban com login/SMS e salvar a proposta no CRM."
          : "Oferta gerada pelo simulador local.",
      offers
    });
  } catch (error) {
    const session = getSessionFromRequest(request);

    safeLogError("http-api", error, {
      route: "/api/clt/simulations",
      method: "POST",
      companyId: session?.companyId,
      currentUserId: session?.id,
      publicErrorCode: "CLT_SIMULATION_FAILED",
      status: 500
    });

    return publicErrorResponse({ code: "CLT_SIMULATION_FAILED", status: 500 });
  }
}
