import { NextResponse, type NextRequest } from "next/server";
import {
  confirmContactImport,
  type ImportPreviewRow
} from "@/lib/contact-import.service";
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

    const body = (await request.json().catch(() => null)) as
      | { rows?: ImportPreviewRow[] }
      | null;

    if (!Array.isArray(body?.rows) || !body.rows.length) {
      return NextResponse.json(
        { error: "Nenhuma linha valida para confirmar." },
        { status: 400 }
      );
    }

    const result = await confirmContactImport({
      companyId: session.companyId,
      userId: session.id,
      rows: body.rows
    });

    return NextResponse.json(result);
  } catch (error) {
    safeLogError("http-api", error, {
      operation: "contact-import-confirm",
      route: "/api/imports/contacts/confirm",
      publicErrorCode: "CONTACT_IMPORT_FAILED",
      status: 500
    });

    return publicErrorResponse({
      code: "CONTACT_IMPORT_FAILED",
      status: 500,
      message: "Nao foi possivel importar os contatos."
    });
  }
}
