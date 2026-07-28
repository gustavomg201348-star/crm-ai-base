import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { requireCompanyAdmin } from "@/lib/permissions";
import {
  getAdminTemplateDetail,
  MetaTemplateServiceError
} from "@/lib/meta-template-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readTemplateId(params: { id?: string }) {
  const id = params.id?.trim();
  return id || null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id?: string }> }
) {
  try {
    const resolvedParams = await params;
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const templateId = readTemplateId(resolvedParams);
    if (!templateId) {
      return NextResponse.json({ error: "Template invalido." }, { status: 400 });
    }

    const result = await getAdminTemplateDetail({
      companyId: session.companyId,
      templateId
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MetaTemplateServiceError) {
      if (error.code === "TEMPLATE_NOT_FOUND") {
        return NextResponse.json({ error: "Template nao encontrado." }, { status: 404 });
      }

      if (error.code === "INVALID_INPUT") {
        return NextResponse.json({ error: "Parametros invalidos." }, { status: 400 });
      }

      if (error.code === "INVALID_STORED_JSON") {
        return NextResponse.json(
          { error: "Nao foi possivel interpretar os dados do template." },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      { error: "Nao foi possivel carregar o template." },
      { status: 500 }
    );
  }
}
