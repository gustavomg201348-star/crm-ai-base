import { NextResponse, type NextRequest } from "next/server";
import { buildContactImportPreview } from "@/lib/contact-import.service";
import { publicErrorResponse } from "@/lib/http-error-response";
import { getSessionOrUnauthorized, requireCompanyAdmin } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { session, response } = getSessionOrUnauthorized(request);
    if (response) return response;

    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: "Envie uma planilha CSV ou Excel .xlsx." },
        { status: 400 }
      );
    }

    const preview = await buildContactImportPreview({
      companyId: session.companyId,
      file
    });

    return NextResponse.json(preview);
  } catch (error) {
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
