import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { publicErrorResponse } from "@/lib/http-error-response";
import { requireCompanyAdmin } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";
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
  let requestedTemplateId: string | null = null;

  try {
    const resolvedParams = await params;
    requestedTemplateId = resolvedParams.id ?? null;
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
        return publicErrorResponse({
          code: "NOT_FOUND",
          status: 404,
          message: "Template nao encontrado."
        });
      }

      if (error.code === "INVALID_INPUT") {
        return publicErrorResponse({
          code: "TEMPLATE_INVALID_INPUT",
          status: 400
        });
      }

      if (error.code === "INVALID_STORED_JSON") {
        safeLogError("http-api", error, {
          operation: "admin-template-detail",
          route: "/api/templates/[id]",
          publicErrorCode: "TEMPLATE_FETCH_FAILED",
          status: 500,
          templateId: requestedTemplateId
        });

        return publicErrorResponse({
          code: "TEMPLATE_FETCH_FAILED",
          status: 500,
          message: "Nao foi possivel interpretar os dados do template."
        });
      }
    }

    safeLogError("http-api", error, {
      operation: "admin-template-detail",
      route: "/api/templates/[id]",
      publicErrorCode: "TEMPLATE_FETCH_FAILED",
      status: 500,
      templateId: requestedTemplateId
    });

    return publicErrorResponse({
      code: "TEMPLATE_FETCH_FAILED",
      status: 500,
      message: "Nao foi possivel carregar o template."
    });
  }
}
