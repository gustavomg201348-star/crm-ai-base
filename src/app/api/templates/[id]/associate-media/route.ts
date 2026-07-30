import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { publicErrorResponse } from "@/lib/http-error-response";
import { requireCompanyAdmin } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";
import {
  associateExistingTemplateHeaderImageMediaAsset,
  MetaTemplateServiceError
} from "@/lib/meta-template-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapServiceError(error: MetaTemplateServiceError) {
  switch (error.code) {
    case "TEMPLATE_NOT_FOUND":
    case "MEDIA_ASSET_NOT_FOUND":
      return publicErrorResponse({ code: "NOT_FOUND", status: 404 });
    case "TEMPLATE_MEDIA_ALREADY_CONFIGURED":
      return publicErrorResponse({
        code: "CONFLICT",
        status: 409,
        message: "Template ja possui midia padrao configurada."
      });
    case "TEMPLATE_HEADER_UNSUPPORTED":
    case "MEDIA_ASSET_INCOMPATIBLE":
    case "INVALID_INPUT":
      return publicErrorResponse({
        code: "TEMPLATE_INVALID_INPUT",
        status: 400,
        message: error.message
      });
    default:
      return null;
  }
}

export async function POST(
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

    const body = (await request.json().catch(() => null)) as
      | { mediaAssetId?: unknown }
      | null;
    const mediaAssetId = typeof body?.mediaAssetId === "string" ? body.mediaAssetId.trim() : "";

    if (!mediaAssetId) {
      return publicErrorResponse({ code: "TEMPLATE_INVALID_INPUT", status: 400 });
    }

    const result = await associateExistingTemplateHeaderImageMediaAsset({
      companyId: session.companyId,
      templateId: requestedTemplateId,
      mediaAssetId
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MetaTemplateServiceError) {
      const response = mapServiceError(error);
      if (response) return response;
    }

    safeLogError("http-api", error, {
      operation: "admin-template-associate-media",
      route: "/api/templates/[id]/associate-media",
      publicErrorCode: "TEMPLATE_CREATE_FAILED",
      status: 500,
      templateId: requestedTemplateId
    });

    return publicErrorResponse({
      code: "TEMPLATE_CREATE_FAILED",
      status: 500,
      message: "Nao foi possivel associar a imagem ao template."
    });
  }
}
