import { NextResponse, type NextRequest } from "next/server";
import { normalizeAiMode } from "@/lib/ai-attendant.service";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { requireCompanyAdmin } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }

    const company = await prisma.company.findUnique({
      where: { id: session.companyId },
      select: { aiMode: true, aiInstructions: true }
    });

    return NextResponse.json({
      settings: {
        mode: normalizeAiMode(company?.aiMode),
        instructions: company?.aiInstructions ?? ""
      }
    });
  } catch (error) {
    const session = getSessionFromRequest(request);

    safeLogError("http-api", error, {
      route: "/api/settings/ai",
      method: "GET",
      companyId: session?.companyId,
      currentUserId: session?.id,
      publicErrorCode: "INTERNAL_ERROR",
      status: 500
    });

    return publicErrorResponse({ code: "INTERNAL_ERROR", status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }

    const denied = requireCompanyAdmin(session);
    if (denied) return denied;

    const body = (await request.json().catch(() => null)) as
      | { mode?: string; instructions?: string }
      | null;

    const company = await prisma.company.update({
      where: { id: session.companyId },
      data: {
        aiMode: normalizeAiMode(body?.mode),
        aiInstructions: body?.instructions?.trim() || null
      },
      select: { aiMode: true, aiInstructions: true }
    });

    return NextResponse.json({
      settings: {
        mode: normalizeAiMode(company.aiMode),
        instructions: company.aiInstructions ?? ""
      }
    });
  } catch (error) {
    const session = getSessionFromRequest(request);

    safeLogError("http-api", error, {
      route: "/api/settings/ai",
      method: "PATCH",
      companyId: session?.companyId,
      currentUserId: session?.id,
      publicErrorCode: "USER_SETTINGS_UPDATE_FAILED",
      status: 500
    });

    return publicErrorResponse({ code: "USER_SETTINGS_UPDATE_FAILED", status: 500 });
  }
}
