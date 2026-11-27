import { NextResponse, type NextRequest } from "next/server";
import { getSessionOrUnauthorized, requireCompanyAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { readChatbotCenter } from "@/lib/chatbot-center";
import { publicErrorResponse } from "@/lib/http-error-response";
import { safeLogError } from "@/lib/safe-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { session, response } = await getSessionOrUnauthorized(request);
    if (response) return response;
    const denied = requireCompanyAdmin(session);
    if (denied) return denied;

    const center = await readChatbotCenter(prisma, session.companyId);
    return NextResponse.json(center, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    safeLogError("http-api", error, { operation: "chatbot-center-read" });
    return publicErrorResponse({ code: "INTERNAL_ERROR", status: 500 });
  }
}
