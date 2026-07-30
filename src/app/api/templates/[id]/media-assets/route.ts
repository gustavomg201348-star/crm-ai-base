import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { publicErrorResponse } from "@/lib/http-error-response";
import { requireCompanyAdmin } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";
import {
  listAdminTemplateHeaderImageMediaAssets,
  MetaTemplateServiceError
} from "@/lib/meta-template-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id?: string }> }
) {
  let requestedTemplateId: string | null = null;

  try {
    const resolvedParams = await params;
    requestedTemplateId = resolvedParams.id?.trim() || null;
    const session = getSessionFromRequest(request);

    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }

    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    if (!requestedTemplateId) {
      return publicErrorResponse({ code: "TEMPLATE_INVALID_INPUT", status: 400 });
    }

    const result = await listAdminTemplateHeaderImageMediaAssets({
      companyId: session.companyId,
      templateId: requestedTemplateId
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MetaTemplateServiceError) {
      if (error.code === "TEMPLATE_NOT_FOUND") {
        return publicErrorResponse({ code: "NOT_FOUND", status: 404 });
      }

      if (
        error.code === "INVALID_INPUT" ||
        error.code === "TEMPLATE_HEADER_UNSUPPORTED" ||
        error.code === "TEMPLATE_MEDIA_ALREADY_CONFIGURED"
      ) {
        return publicErrorResponse({
          code: "TEMPLATE_INVALID_INPUT",
          status: 400,
          message: error.message
        });
      }
    }

    safeLogError("http-api", error, {
      operation: "admin-template-media-assets-list",
      route: "/api/templates/[id]/media-assets",
      publicErrorCode: "MEDIA_FETCH_FAILED",
      status: 500,
      templateId: requestedTemplateId
    });

    return publicErrorResponse({
      code: "MEDIA_FETCH_FAILED",
      status: 500,
      message: "Nao foi possivel carregar imagens elegiveis."
    });
  }
}
