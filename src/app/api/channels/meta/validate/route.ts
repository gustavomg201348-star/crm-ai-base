import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { publicErrorResponse } from "@/lib/http-error-response";
import { requireCompanyAdmin } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";
import { validateMetaWhatsAppCredentials } from "@/lib/meta-whatsapp-diagnostics";
import { sanitizeMetaDiagnostics } from "@/lib/meta-diagnostics-sanitizer";

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as
      | {
          accessToken?: string;
          wabaId?: string;
          phoneNumberId?: string;
        }
      | null;

    const diagnostics = await validateMetaWhatsAppCredentials({
      accessToken: body?.accessToken,
      wabaId: body?.wabaId,
      phoneNumberId: body?.phoneNumberId
    });

    return NextResponse.json({ diagnostics: sanitizeMetaDiagnostics(diagnostics) });
  } catch (error) {
    safeLogError("http-api", error, {
      route: "/api/channels/meta/validate",
      method: "POST",
      publicErrorCode: "META_PROVIDER_ERROR",
      status: 500
    });

    return publicErrorResponse({
      code: "META_PROVIDER_ERROR",
      status: 500,
      message: "Nao foi possivel validar as credenciais Meta."
    });
  }
}
