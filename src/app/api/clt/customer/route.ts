import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { createCltLog } from "@/lib/clt-logs";
import { enrichCltCustomer, isValidCpfShape } from "@/lib/clt-integration";
import { publicErrorResponse } from "@/lib/http-error-response";
import { safeLogError } from "@/lib/safe-logger";

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | { cpf?: string; phone?: string }
      | null;

    if (!body?.cpf || !isValidCpfShape(body.cpf)) {
      return publicErrorResponse({ code: "CLT_INVALID_CPF", status: 400 });
    }

    const customer = enrichCltCustomer({ cpf: body.cpf, phone: body.phone });
    await createCltLog({
      companyId: session.companyId,
      userId: session.id,
      action: "CUSTOMER_LOOKUP",
      cpf: body.cpf,
      phone: body.phone,
      message: "Consulta de dados CLT realizada.",
      input: { cpf: body.cpf, phone: body.phone },
      output: { name: customer.name, registry: customer.registry }
    });

    return NextResponse.json({
      customer
    });
  } catch (error) {
    const session = getSessionFromRequest(request);

    safeLogError("http-api", error, {
      route: "/api/clt/customer",
      method: "POST",
      companyId: session?.companyId,
      currentUserId: session?.id,
      publicErrorCode: "CLT_CUSTOMER_LOOKUP_FAILED",
      status: 500
    });

    return publicErrorResponse({ code: "CLT_CUSTOMER_LOOKUP_FAILED", status: 500 });
  }
}
