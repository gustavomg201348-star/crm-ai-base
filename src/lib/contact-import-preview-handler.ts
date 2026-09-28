import { NextResponse, type NextRequest } from "next/server";
import type { SessionUser } from "@/lib/auth";
import { buildContactImportPreview } from "@/lib/contact-import.service";
import {
  CONTACT_IMPORT_MAX_REQUEST_BYTES,
  ContactImportUploadError
} from "@/lib/contact-import-upload";
import { publicErrorResponse } from "@/lib/http-error-response";
import { getSessionOrUnauthorized, requireCompanyAdmin } from "@/lib/permissions";
import { enforceRateLimits, getRequestIpKey } from "@/lib/rate-limit";
import { safeLogError, safeLogWarn } from "@/lib/safe-logger";

const CONTACT_IMPORT_PREVIEW_USER_LIMIT = { limit: 10, windowMs: 60_000 } as const;
const CONTACT_IMPORT_PREVIEW_IP_LIMIT = { limit: 20, windowMs: 60_000 } as const;

type PreviewRouteDependencies = {
  getSession: typeof getSessionOrUnauthorized;
  requireAdmin: typeof requireCompanyAdmin;
  enforceLimits: typeof enforceRateLimits;
  buildPreview: typeof buildContactImportPreview;
};

const defaultDependencies: PreviewRouteDependencies = {
  getSession: getSessionOrUnauthorized,
  requireAdmin: requireCompanyAdmin,
  enforceLimits: enforceRateLimits,
  buildPreview: buildContactImportPreview
};

function readContentLength(request: NextRequest) {
  const raw = request.headers.get("content-length");
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export async function handleContactImportPreview(
  request: NextRequest,
  dependencies: PreviewRouteDependencies = defaultDependencies
) {
  let sessionMetadata: Pick<SessionUser, "id" | "companyId"> | null = null;

  try {
    const { session, response } = await dependencies.getSession(request);
    if (response) return response;
    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }
    sessionMetadata = { id: session.id, companyId: session.companyId };

    const blocked = dependencies.requireAdmin(session);
    if (blocked) return blocked;

    const limited = await dependencies.enforceLimits([
      {
        category: "contact-import-preview-user",
        identifiers: [session.companyId, session.id],
        ...CONTACT_IMPORT_PREVIEW_USER_LIMIT
      },
      {
        category: "contact-import-preview-ip",
        identifiers: [session.companyId, getRequestIpKey(request)],
        ...CONTACT_IMPORT_PREVIEW_IP_LIMIT
      }
    ]);
    if (limited) return limited;

    const contentLength = readContentLength(request);
    if (contentLength !== null && contentLength > CONTACT_IMPORT_MAX_REQUEST_BYTES) {
      safeLogWarn("http-api", "contact import preview rejected", {
        operation: "contact-import-preview",
        reason: "request_too_large",
        size: contentLength,
        companyId: session.companyId,
        userId: session.id
      });
      return publicErrorResponse({
        code: "CONTACT_IMPORT_FILE_TOO_LARGE",
        status: 413,
        message: "O arquivo excede o tamanho máximo permitido."
      });
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: "Envie uma planilha CSV ou Excel .xlsx." },
        { status: 400 }
      );
    }

    const preview = await dependencies.buildPreview({
      companyId: session.companyId,
      file
    });

    return NextResponse.json(preview);
  } catch (error) {
    if (error instanceof ContactImportUploadError) {
      safeLogWarn("http-api", "contact import preview rejected", {
        operation: "contact-import-preview",
        reason: error.reason,
        status: error.status,
        companyId: sessionMetadata?.companyId,
        userId: sessionMetadata?.id
      });
      return publicErrorResponse({
        code:
          error.status === 413
            ? "CONTACT_IMPORT_FILE_TOO_LARGE"
            : "CONTACT_IMPORT_INVALID_FILE",
        status: error.status,
        message: error.message
      });
    }

    safeLogError("http-api", error, {
      operation: "contact-import-preview",
      route: "/api/imports/contacts/preview",
      publicErrorCode: "CONTACT_IMPORT_INVALID_FILE",
      status: 400
    });

    return publicErrorResponse({
      code: "CONTACT_IMPORT_INVALID_FILE",
      status: 400,
      message: "Nao foi possivel validar a planilha."
    });
  }
}
