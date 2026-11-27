import { NextResponse, type NextRequest } from "next/server";
import { normalizeAiMode } from "@/lib/ai-attendant.service";
import { getSessionOrUnauthorized, isCompanyAdmin, requireCompanyAdmin } from "@/lib/permissions";
import { parseCompanyAiSettingsUpdate, resolveCltCheckAutoReply, type CompanyAiSettings } from "@/lib/company-ai-settings";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { safeLogError } from "@/lib/safe-logger";

export const dynamic = "force-dynamic";

const adminFields = { aiMode: true, aiInstructions: true, cltCheckAutoReplyEnabled: true } as const;
const options = { headers: { "Cache-Control": "private, no-store" } };

function adminSettings(company: { aiMode: string; aiInstructions: string | null; cltCheckAutoReplyEnabled: boolean | null }): CompanyAiSettings {
  return {
    mode: normalizeAiMode(company.aiMode),
    instructions: company.aiInstructions ?? "",
    checkAutoReplyOverride: company.cltCheckAutoReplyEnabled,
    checkAutoReplyEnabled: resolveCltCheckAutoReply(company.cltCheckAutoReplyEnabled, process.env.CLT_CHECK_AUTO_REPLY_ENABLED),
    providerConfigured: Boolean(process.env.OPENAI_API_KEY)
  };
}

export async function GET(request: NextRequest) {
  try {
    const { session, response } = await getSessionOrUnauthorized(request);
    if (response) return response;

    const where = { id: session.companyId };
    if (!isCompanyAdmin(session)) {
      const company = await prisma.company.findUniqueOrThrow({ where, select: { aiMode: true } });
      return NextResponse.json({ settings: { mode: normalizeAiMode(company.aiMode) } }, options);
    }

    const company = await prisma.company.findUniqueOrThrow({ where, select: adminFields });
    return NextResponse.json({ settings: adminSettings(company) }, options);
  } catch (error) {
    safeLogError("http-api", error, { operation: "company-ai-settings-read" });
    return publicErrorResponse({ code: "INTERNAL_ERROR", status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { session, response } = await getSessionOrUnauthorized(request);
    if (response) return response;
    const denied = requireCompanyAdmin(session);
    if (denied) return denied;

    const data = parseCompanyAiSettingsUpdate(await request.json().catch(() => null));
    if (!data) return publicErrorResponse({ code: "INVALID_REQUEST", status: 400, message: "Configuração inválida." });

    const company = await prisma.company.update({
      where: { id: session.companyId },
      data,
      select: adminFields
    });
    return NextResponse.json({ settings: adminSettings(company) }, options);
  } catch (error) {
    safeLogError("http-api", error, { operation: "company-ai-settings-update" });
    return publicErrorResponse({ code: "USER_SETTINGS_UPDATE_FAILED", status: 500 });
  }
}
