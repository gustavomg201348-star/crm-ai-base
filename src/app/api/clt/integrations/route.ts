import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { ensureCltIntegrations, mapCltIntegration } from "@/lib/clt-settings";
import { prisma } from "@/lib/db";

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
    return NextResponse.json(
      { error: "Nao foi possivel carregar integracoes CLT." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | {
          bankId?: string;
          provider?: string;
          baseUrl?: string;
          authType?: string;
          apiKey?: string;
          username?: string;
          password?: string;
          status?: string;
        }
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
    return NextResponse.json(
      { error: "Nao foi possivel salvar integracao CLT." },
      { status: 500 }
    );
  }
}
