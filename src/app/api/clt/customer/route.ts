import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { createCltLog } from "@/lib/clt-logs";
import { enrichCltCustomer, isValidCpfShape } from "@/lib/clt-integration";

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | { cpf?: string; phone?: string }
      | null;

    if (!body?.cpf || !isValidCpfShape(body.cpf)) {
      return NextResponse.json({ error: "Informe um CPF valido." }, { status: 400 });
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
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel consultar dados CLT." },
      { status: 500 }
    );
  }
}
