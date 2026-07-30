import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { publicErrorResponse } from "@/lib/http-error-response";
import { requireCompanyAdmin } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";
import {
  MetaTemplateServiceError,
  uploadAndAssociateTemplateHeaderImage
} from "@/lib/meta-template-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapServiceError(error: MetaTemplateServiceError) {
  switch (error.code) {
    case "TEMPLATE_NOT_FOUND":
      return publicErrorResponse({ code: "NOT_FOUND", status: 404 });
    case "TEMPLATE_MEDIA_ALREADY_CONFIGURED":
      return publicErrorResponse({
        code: "CONFLICT",
        status: 409,
        message: "Template ja possui midia padrao configurada."
      });
    case "TEMPLATE_HEADER_UNSUPPORTED":
    case "MEDIA_ASSET_INCOMPATIBLE":
    case "MEDIA_STORAGE_FAILED":
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

function readSingleMediaFile(formData: FormData) {
  const files = formData
    .getAll("media")
    .filter((value): value is File => value instanceof File && value.size > 0);

  if (files.length !== 1) {
    return null;
  }

  return files[0];
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

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return publicErrorResponse({ code: "TEMPLATE_INVALID_INPUT", status: 400 });
    }

    const media = readSingleMediaFile(formData);
    if (!media) {
      return publicErrorResponse({
        code: "TEMPLATE_INVALID_INPUT",
        status: 400,
        message: "Envie uma imagem valida para associar ao template."
      });
    }

    const result = await uploadAndAssociateTemplateHeaderImage({
      companyId: session.companyId,
      templateId: requestedTemplateId,
      fileName: media.name,
      mimeType: media.type,
      bytes: Buffer.from(await media.arrayBuffer())
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MetaTemplateServiceError) {
      const response = mapServiceError(error);
      if (response) return response;
    }

    safeLogError("http-api", error, {
      operation: "admin-template-upload-header-media",
      route: "/api/templates/[id]/header-media",
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
